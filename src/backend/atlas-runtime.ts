import { join } from 'node:path'
import { ChatOpenAI } from '@langchain/openai'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { createDeepAgent, registerHarnessProfile } from 'deepagents'
import { todoListMiddleware } from 'langchain'
import { AtlasStore } from './atlas-store.ts'
import { createWorkspace, workspaceEntries, workspaceText, type AtlasFilesystem } from './atlas-workspace.ts'
import type { Connection, StreamDelta } from '../shared/chat.ts'

registerHarnessProfile('openai', { excludedTools: ['task', 'execute', 'delete_file'], generalPurposeSubagent: { enabled: false } })

const instructions = `You are Atlas, a personal agent with a persistent workspace. Be concise.
Your only filesystem is the workspace root /. Use /notes/ for notes and /projects/ for projects.
Use /memory.md to remember explicit user preferences across conversations. Read existing content before editing it. Update it when the user asks you to remember something. Do not store secrets or speculative facts.
Your identity and user memory are loaded below. Identity is read-only. Notes and other files can be written with the file tools.
For a simple question or a quote, answer directly. Do not make a plan or use a tool unless needed.
For requested file changes, actually call the tools and report their outcome. Do not invent tool results.
There is no terminal or delegation in this version. A stopped run may leave completed file changes in place.`

class AtlasRunError extends Error { }

export class AtlasRuntime {
  store: AtlasStore
  workspace: AtlasFilesystem
  active: { id: string; controller: AbortController } | null = null
  private constructor(store: AtlasStore, workspace: AtlasFilesystem) { this.store = store; this.workspace = workspace }
  static async open(directory: string) {
    const workspace = await createWorkspace(directory)
    return new AtlasRuntime(new AtlasStore(join(directory, 'atlas.sqlite')), workspace)
  }
  entries(path: string) { return workspaceEntries(this.workspace, path) }
  read(path: string) { return workspaceText(this.workspace, path) }
  stop(id: string) { if (this.active?.id === id) this.active.controller.abort() }
  async run(requestId: string, conversationId: string, connection: Connection, text: string, emit: (delta: StreamDelta) => void) {
    if (this.active) throw new Error('Atlas is already working. Stop the current reply first.')
    if (typeof text !== 'string' || !text.trim() || text.length > 32_000 || typeof requestId !== 'string' || requestId.length > 100) throw new Error('Invalid or oversized message.')
    const controller = new AbortController()
    this.active = { id: requestId, controller }
    let turn: ReturnType<AtlasStore['begin']> | undefined
    let lastSave = 0
    const activity = { reasoningCharacters: 0, answerCharacters: 0 }
    let budgetExceeded = false
    // Observe provider reasoning even when the SDK omits nonstandard fields.
    // Forward original bytes unchanged; never persist reasoning text or keys.
    const observedFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, { ...init, redirect: 'error' })
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response
      let pending = ''
      const decoder = new TextDecoder()
      return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, output) {
          output.enqueue(chunk)
          pending += decoder.decode(chunk, { stream: true })
          const lines = pending.split('\n'); pending = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            try {
              const data = JSON.parse(line.slice(5))
              const delta = data.choices?.[0]?.delta
              const reasoning = delta?.reasoning_content ?? delta?.reasoning
              if (typeof reasoning === 'string') {
                activity.reasoningCharacters += reasoning.length
                emit({ requestId, text: '', activity: { ...activity } })
              }
              if (data.choices?.[0]?.finish_reason === 'length') budgetExceeded = true
            } catch { /* SSE includes [DONE] and provider keepalives */ }
          }
        }
      })), { status: response.status, headers: response.headers })
    }
    try {
      const [identity, memory] = await Promise.all([this.read('/identity.md'), this.read('/memory.md')])
      turn = this.store.begin(conversationId, text.trim(), connection.model)
      const persist = () => { if (turn) this.store.saveMessage(conversationId, turn.message) }
      const model = new ChatOpenAI({
        model: connection.model, apiKey: connection.apiKey || 'local-no-key',
        configuration: { baseURL: connection.baseUrl, fetch: observedFetch },
        streaming: true, useResponsesApi: false, maxRetries: 0, timeout: 120_000,
        maxTokens: 4096
      })
      const agent = createDeepAgent({
        name: 'Atlas', model, backend: this.workspace, checkpointer: this.store.saver,
        middleware: [todoListMiddleware()],
        systemPrompt: `${instructions}\n\n<identity>\n${identity}\n</identity>\n<user_memory>\n${memory}\n</user_memory>`,
        permissions: [{ operations: ['write'], paths: ['/identity.md'], mode: 'deny' }]
      })
      const history = turn.recovered ? turn.history.filter(m => m.content).map(m => m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)) : []
      if (turn.recovered) history.push(new HumanMessage('The previous run was interrupted. Completed file changes remain. Inspect the current files before continuing unfinished work; do not assume unfinished actions succeeded.'))
      const stream = agent.streamEvents({ messages: [...history, new HumanMessage(text.trim())] }, {
        version: 'v2', configurable: { thread_id: turn.graphId },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]), recursionLimit: 40
      })
      for await (const event of stream) {
        if (controller.signal.aborted) break
        if (event.event === 'on_chat_model_stream') {
          const content = event.data.chunk?.content
          const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text).join('') : ''
          if (text) {
            turn.message.content += text; activity.answerCharacters += text.length
            emit({ requestId, text, activity: { ...activity } })
          }
        } else if (event.event === 'on_tool_start') {
          const tool = { id: event.run_id, name: event.name, input: preview(event.data.input), status: 'running' as const }
          turn.message.tools!.push(tool)
          persist(); emit({ requestId, text: '', tool })
        } else if (event.event === 'on_tool_end' || event.event === 'on_tool_error') {
          const tool = turn.message.tools!.find(tool => tool.id === event.run_id)
          if (tool) {
            tool.output = preview(event.data.output?.content ?? event.data.output ?? 'Tool failed.')
            tool.status = event.event === 'on_tool_error' || /^(Error|Permission denied)/i.test(tool.output) || event.data.output?.status === 'error' ? 'error' : 'complete'
            persist(); emit({ requestId, text: '', tool: { ...tool } })
          }
        }
        if (Date.now() - lastSave > 150) { persist(); lastSave = Date.now() }
      }
      if (!controller.signal.aborted && budgetExceeded) throw new AtlasRunError('The model reached its output limit. Try a shorter request or another model.')
      if (!controller.signal.aborted && !turn.message.content.trim()) {
        const tools = turn.message.tools ?? []
        if (tools.length && tools.every(tool => tool.status === 'complete')) {
          // Some local models send a valid empty `stop` after successful tools.
          // Preserve verified outcomes without inventing an assistant reply or
          // retrying side effects merely to obtain a verbal confirmation.
          turn.message.notice = 'The model ended without a final message. Completed tool results are shown above.'
        } else throw new AtlasRunError(tools.length ? 'The model ended after a tool error. Review tool activity; completed changes are kept.' : 'The model returned no answer. Try another model or a shorter request.')
      }
      this.store.finish(conversationId, turn.message, controller.signal.aborted ? 'stopped' : 'complete')
      return { stopped: controller.signal.aborted }
    } catch (error) {
      // Provider errors can echo request bodies or credentials. Keep them out of
      // renderer events and persistent conversations.
      const safe = error instanceof AtlasRunError ? error.message : 'Atlas could not finish this reply. Check the connection and model, then try again.'
      if (turn) { if (!controller.signal.aborted) turn.message.error = safe; this.store.finish(conversationId, turn.message, controller.signal.aborted ? 'stopped' : 'error') }
      if (controller.signal.aborted) return { stopped: true }
      throw new Error(safe)
    } finally { this.active = null }
  }
  close() { if (this.active) throw new Error('Stop Atlas before closing the runtime.'); this.store.close() }
}
function preview(value: unknown): string { return (typeof value === 'string' ? value : JSON.stringify(value) ?? '').slice(0, 4000) }
