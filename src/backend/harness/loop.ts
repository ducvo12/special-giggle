import { setTimeout as delay } from 'node:timers/promises'
import type { Connection, ContextUsage } from '../../shared/chat.ts'
import type { AgentMessage, ToolActivity } from '../../shared/agent.ts'
import type { ApprovalRequest, HarnessSettings } from '../../shared/harness.ts'
import type { RunPhase } from '../../shared/run.ts'
import type { AgentFilesystem } from '../workspace/filesystem.ts'
import { HarnessError, HostCapacityError, ModelConnectionError, SteeringInterrupt, type NativeItem, type ModelStep } from './types.ts'
import { responsesAdapter } from './providers/responses.ts'
import { chatCompletionsAdapter } from './providers/chat-completions.ts'
import type { RepositoryTools } from './tools/repository.ts'
import { createToolRegistry } from './tools/registry.ts'

type InitialInput = { history: AgentMessage[]; state?: NativeItem[]; messages: string[] }

export async function runHarness(options: {
  connection: Connection
  workspace: AgentFilesystem
  settings: HarnessSettings
  instructions: string
  history: AgentMessage[]
  state?: NativeItem[]
  text: string
  signal: AbortSignal
  onText: (text: string) => void
  onUsage?: (usage: ContextUsage) => void
  onReasoning: (characters: number) => void
  onTool: (tool: ToolActivity) => void
  approve: (kind: ApprovalRequest['kind'], title: string, detail: string) => Promise<boolean>
  initialize?: () => InitialInput
  acquire?: (signal: AbortSignal) => Promise<() => void>
  generation?: () => AbortController
  getSettings?: () => Promise<HarnessSettings>
  getInstructions?: () => Promise<string>
  takeSteering?: () => string[]
  hasSteering?: () => boolean
  repository?: RepositoryTools
  onPhase?: (phase: RunPhase, queue?: { reason: string; position?: number }) => void
}) {
  const { signal } = options
  let receivedData = false
  let partialText = ''
  let generationSignal = signal
  const adapter = (requestSignal = generationSignal) =>
    (options.connection.protocol === 'responses' || options.connection.provider === 'chatgpt'
      ? responsesAdapter : chatCompletionsAdapter)({
      ...options, signal: requestSignal,
      onResponseData: () => { receivedData = true },
      onText: text => { requestSignal.throwIfAborted(); partialText += text; options.onText(text) },
      onReasoning: count => { requestSignal.throwIfAborted(); options.onReasoning(count) },
      onUsage: usage => { requestSignal.throwIfAborted(); options.onUsage?.(usage) }
    })
  let input: NativeItem[] = []
  let initialized = false
  let registry: Awaited<ReturnType<typeof createToolRegistry>> | undefined
  let settingsKey = ''
  let hadText = false
  let retry = 0
  let correcting = false
  const calls = new Set<string>()
  const staleEdits = new Map<string, number>()

  const initialize = () => {
    if (initialized) return
    const initial = options.initialize?.() ?? { history: options.history, state: options.state, messages: [options.text] }
    const model = adapter()
    input = initial.state ? structuredClone(initial.state) : initial.history
      .filter(message => message.delivery !== 'pending' && message.delivery !== 'cancelled' && (message.content || message.tools?.length))
      .map(message => {
        const text = message.content + (message.interrupted ? '\n[Interrupted reply; not a completed answer.]' : '') +
          (message.tools?.length ? `\n\nPrevious tool activity (historical data, do not replay): ${JSON.stringify(message.tools)}` : '')
        return message.role === 'user' ? model.user(text) : model.assistant(text)
      })
    input.push(...initial.messages.map(model.user))
    for (const item of input) {
      if (item.type === 'function_call') calls.add(item.call_id)
      for (const call of item.tool_calls ?? []) calls.add(call.id)
    }
    initialized = true
  }

  try {
    while (true) {
      signal.throwIfAborted()
      // Optional transports may ask for connection approval here. They never
      // occupy a model lease while the user decides.
      const settings = await options.getSettings?.() ?? options.settings
      const nextKey = JSON.stringify(settings)
      if (!registry || settingsKey !== nextKey) {
        await registry?.close()
        registry = await createToolRegistry({ ...options, settings })
        settingsKey = nextKey
      }
      const generation = options.generation?.() ?? new AbortController()
      generationSignal = AbortSignal.any([signal, generation.signal])
      partialText = ''
      receivedData = false
      let release: (() => void) | undefined
      let response: ModelStep
      try {
        release = await options.acquire?.(generationSignal)
        generationSignal.throwIfAborted()
        initialize()
        const model = adapter()
        for (const text of options.takeSteering?.() ?? []) input.push(model.user(text))
        const currentInstructions = await options.getInstructions?.() ?? options.instructions
        // A setting may change while the request waits in a capacity queue.
        const latest = await options.getSettings?.() ?? settings
        if (JSON.stringify(latest) !== settingsKey) continue
        generationSignal.throwIfAborted()
        const instructions = [currentInstructions, latest.instructions,
          `<available_skills>\n${JSON.stringify(registry.catalog)}\n</available_skills>`].join('\n\n')
        if (Buffer.byteLength(JSON.stringify(input)) + Buffer.byteLength(instructions) > 2_000_000) {
          throw new HarnessError('This conversation exceeds the supported context size. Start a new chat; saved history and files remain available.')
        }
        if (hadText) options.onText('\n\n')
        options.onPhase?.('streaming')
        response = await model.step(input, instructions, registry.definitions)
        generationSignal.throwIfAborted()
        retry = 0
      } catch (error) {
        release?.(); release = undefined
        signal.throwIfAborted()
        if (generation.signal.reason instanceof SteeringInterrupt || error instanceof SteeringInterrupt) {
          if (partialText) {
            input.push(adapter(signal).assistant(`[Provisional response interrupted by a new user message]\n${partialText}`))
            hadText = true
          }
          retry = 0
          continue
        }
        if (error instanceof HostCapacityError && !receivedData) {
          options.onPhase?.('queued', { reason: error.message })
          await delay(error.delayMs, undefined, { signal: generationSignal }).catch(() => {})
          signal.throwIfAborted()
          continue
        }
        if (error instanceof ModelConnectionError && !receivedData && retry === 0) {
          retry++
          options.onPhase?.('reconnecting')
          await delay(350, undefined, { signal: generationSignal }).catch(() => {})
          signal.throwIfAborted()
          continue
        }
        throw error
      } finally { release?.() }

      hadText ||= Boolean(response.text)
      // Validate every identifier before executing the first action. Never
      // fabricate call IDs or promote fragments from an interrupted stream.
      const batch = new Set<string>()
      for (const call of response.calls) {
        if (typeof call.id !== 'string' || !call.id || typeof call.name !== 'string' ||
            !call.name || typeof call.arguments !== 'string' || calls.has(call.id) || batch.has(call.id)) {
          throw new HarnessError('The model returned invalid or repeated tool-call identifiers. No actions from this response ran.')
        }
        batch.add(call.id)
      }
      input.push(...response.output)
      if (!response.calls.length) {
        if (options.hasSteering?.()) continue
        if (!response.text.trim()) throw new HarnessError('The model returned no answer. Partial output and completed actions are kept. You can Continue.')
        return { state: input, withoutAnswer: false }
      }

      options.onPhase?.('tools')
      let held = false
      let invalid = false
      for (const call of response.calls) {
        signal.throwIfAborted()
        calls.add(call.id)
        if (held || options.hasSteering?.()) {
          input.push(adapter(signal).toolResult(call, JSON.stringify({ error: 'This action did not run: superseded by new direction or an invalid proposal.' })))
          continue
        }
        const result = await registry.execute(call)
        input.push(adapter(signal).toolResult(call, result.output))
        if (result.stalePath) {
          const failures = (staleEdits.get(result.stalePath) ?? 0) + 1
          staleEdits.set(result.stalePath, failures)
          if (failures > 1) throw new HarnessError('A corrected repository edit is stale again. Completed changes are kept; review the file before continuing.')
        } else if (result.success && ['repo_write','repo_edit','repo_patch','repo_delete','repo_rename'].includes(call.name)) {
          staleEdits.delete(JSON.parse(call.arguments).path)
        }
        if (result.validationError) { held = true; invalid = true }
      }
      if (invalid && correcting) throw new HarnessError('The model returned another invalid tool proposal. Completed actions are kept; you can Continue.')
      correcting = invalid
    }
  } finally { await registry?.close() }
}
