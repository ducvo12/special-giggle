import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { ChatOpenAI } from '@langchain/openai'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { createDeepAgent, registerHarnessProfile } from 'deepagents'
import { todoListMiddleware } from 'langchain'
import type { Connection, StreamDelta } from '../../shared/chat.ts'
import { observeModelStream } from '../models/observed-fetch.ts'
import { workspaceEntries, workspaceText } from '../workspace/workspace.ts'
import { AgentStore } from './store.ts'
import { AgentRegistry } from './registry.ts'

registerHarnessProfile('openai', {
  excludedTools: ['task', 'execute', 'delete_file'],
  generalPurposeSubagent: { enabled: false }
})

const instructions = `You are a personal agent with a persistent workspace. Your name and personality come from the agent profile and identity below. Follow the identity’s communication style.
Your only filesystem is the workspace root /. Use /notes/ for notes and /projects/ for projects.
Use /memory.md to remember explicit user preferences across conversations. Read existing content before editing it. Update it when the user asks you to remember something. Do not store secrets or speculative facts.
Your identity and user memory are loaded below. Identity and /agent.json are read-only to the agent; the user can edit identity in the application. Notes and other files can be written with the file tools.
For a simple question or a quote, answer directly. Do not make a plan or use a tool unless needed.
For requested file changes, actually call the tools and report their outcome. Do not invent tool results.
There is no terminal or delegation in this version. A stopped run may leave completed file changes in place.`

class AgentRunError extends Error {}

export class AgentRuntime {
  store: AgentStore
  registry: AgentRegistry
  active: { id: string; controller: AbortController } | null = null
  private editingIdentity = false
  private changingAgents = false

  private constructor(store: AgentStore, registry: AgentRegistry) {
    this.store = store
    this.registry = registry
  }

  static async open(directory: string) {
    const registry = await AgentRegistry.open(directory)

    // Retain the original database filename, including existing WAL/checkpoints.
    return new AgentRuntime(new AgentStore(join(directory, 'atlas.sqlite')), registry)
  }

  async entries(agentId: string, path: string) {
    return workspaceEntries(await this.registry.workspace(agentId), path)
  }

  async read(agentId: string, path: string) {
    return workspaceText(await this.registry.workspace(agentId), path)
  }

  async saveIdentity(agentId: string, identity: string, expected: string) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before editing an identity.')
    }

    this.editingIdentity = true

    try {
      return await this.registry.saveIdentity(agentId, identity, expected)
    } finally {
      this.editingIdentity = false
    }
  }

  async createAgent(name: string) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before creating an agent.')
    }

    this.changingAgents = true

    try {
      return await this.registry.create(name)
    } finally {
      this.changingAgents = false
    }
  }

  async deleteAgent(agentId: string) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before deleting an agent.')
    }

    this.changingAgents = true

    try {
      const workspace = await this.registry.workspace(agentId)

      // Run in the worker, synchronously inside the transaction: a filesystem
      // failure rolls back database deletion, and no other request interleaves.
      this.store.saver.db.transaction(() => {
        this.store.deleteAgent(agentId)
        rmSync(workspace.root, { recursive: true })
      })()
    } finally {
      this.changingAgents = false
    }
  }

  async createConversation(agentId: string) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before creating a conversation.')
    }

    // Hold the same guard while validating the folder and inserting the row,
    // so an in-flight request cannot recreate records after agent deletion.
    this.changingAgents = true

    try {
      await this.registry.get(agentId)
      return this.store.create(agentId)
    } finally {
      this.changingAgents = false
    }
  }

  stop(id: string) {
    if (this.active?.id === id) {
      this.active.controller.abort()
    }
  }

  async run(
    requestId: string,
    agentId: string,
    conversationId: string,
    connection: Connection,
    text: string,
    emit: (delta: StreamDelta) => void
  ) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error(
        'An agent is already working or its identity is being saved. Finish the current operation first.'
      )
    }

    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 32_000 ||
      typeof requestId !== 'string' ||
      requestId.length > 100
    ) {
      throw new Error('Invalid or oversized message.')
    }

    const controller = new AbortController()
    this.active = { id: requestId, controller }
    let turn: ReturnType<AgentStore['begin']> | undefined
    let lastSave = 0
    const observation = observeModelStream(requestId, emit)
    const { activity } = observation

    try {
      const profile = await this.registry.get(agentId)
      const workspace = await this.registry.workspace(agentId)
      const [identity, memory] = await Promise.all([
        workspaceText(workspace, '/identity.md'),
        workspaceText(workspace, '/memory.md')
      ])

      turn = this.store.begin(agentId, conversationId, text.trim(), connection.model)
      const persist = () => {
        if (turn) {
          this.store.saveMessage(conversationId, turn.message)
        }
      }

      const model = new ChatOpenAI({
        model: connection.model,
        apiKey: connection.apiKey || 'local-no-key',
        configuration: { baseURL: connection.baseUrl, fetch: observation.fetch },
        streaming: true,
        useResponsesApi: false,
        maxRetries: 0,
        timeout: 120_000,
        maxTokens: 4096
      })

      const agent = createDeepAgent({
        name: profile.id,
        model,
        backend: workspace,
        checkpointer: this.store.saver,
        middleware: [todoListMiddleware()],
        systemPrompt: [
          instructions,
          '',
          '<agent_profile>',
          JSON.stringify(profile),
          '</agent_profile>',
          '<identity>',
          identity,
          '</identity>',
          '<user_memory>',
          memory,
          '</user_memory>'
        ].join('\n'),
        permissions: [
          { operations: ['write'], paths: ['/identity.md', '/agent.json'], mode: 'deny' }
        ]
      })

      const history = turn.recovered
        ? turn.history
            .filter(m => m.content)
            .map(m => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)))
        : []

      if (turn.recovered) {
        history.push(
          new HumanMessage(
            'The previous run was interrupted. Completed file changes remain. Inspect the current files before continuing unfinished work; do not assume unfinished actions succeeded.'
          )
        )
      }

      const stream = agent.streamEvents(
        { messages: [...history, new HumanMessage(text.trim())] },
        {
          version: 'v2',
          configurable: { thread_id: turn.graphId },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]),
          recursionLimit: 40
        }
      )

      for await (const event of stream) {
        if (controller.signal.aborted) {
          break
        }

        if (event.event === 'on_chat_model_stream') {
          const content = event.data.chunk?.content
          const text =
            typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? content
                    .filter(b => b.type === 'text')
                    .map(b => b.text)
                    .join('')
                : ''

          if (text) {
            turn.message.content += text
            activity.answerCharacters += text.length
            emit({ requestId, text, activity: { ...activity } })
          }
        } else if (event.event === 'on_tool_start') {
          const tool = {
            id: event.run_id,
            name: event.name,
            input: preview(event.data.input),
            status: 'running' as const
          }
          turn.message.tools!.push(tool)
          persist()
          emit({ requestId, text: '', tool })
        } else if (event.event === 'on_tool_end' || event.event === 'on_tool_error') {
          const tool = turn.message.tools!.find(tool => tool.id === event.run_id)

          if (tool) {
            tool.output = preview(event.data.output?.content ?? event.data.output ?? 'Tool failed.')
            tool.status =
              event.event === 'on_tool_error' ||
              /^(Error|Permission denied)/i.test(tool.output) ||
              event.data.output?.status === 'error'
                ? 'error'
                : 'complete'
            persist()
            emit({ requestId, text: '', tool: { ...tool } })
          }
        }

        if (Date.now() - lastSave > 150) {
          persist()
          lastSave = Date.now()
        }
      }

      if (!controller.signal.aborted && observation.budgetExceeded) {
        throw new AgentRunError(
          'The model reached its output limit. Try a shorter request or another model.'
        )
      }

      if (!controller.signal.aborted && !turn.message.content.trim()) {
        const tools = turn.message.tools ?? []

        if (tools.length && tools.every(tool => tool.status === 'complete')) {
          // Some local models send a valid empty `stop` after successful tools.
          // Preserve verified outcomes without inventing an assistant reply or
          // retrying side effects merely to obtain a verbal confirmation.
          turn.message.notice =
            'The model ended without a final message. Completed tool results are shown above.'
        } else {
          throw new AgentRunError(
            tools.length
              ? 'The model ended after a tool error. Review tool activity; completed changes are kept.'
              : 'The model returned no answer. Try another model or a shorter request.'
          )
        }
      }

      this.store.finish(
        conversationId,
        turn.message,
        controller.signal.aborted ? 'stopped' : 'complete'
      )

      return { stopped: controller.signal.aborted }
    } catch (error) {
      // Provider errors can echo request bodies or credentials. Keep them out of
      // renderer events and persistent conversations.
      const safe =
        error instanceof AgentRunError
          ? error.message
          : 'The agent could not finish this reply. Check the connection and model, then try again.'

      if (turn) {
        if (!controller.signal.aborted) {
          turn.message.error = safe
        }

        this.store.finish(
          conversationId,
          turn.message,
          controller.signal.aborted ? 'stopped' : 'error'
        )
      }

      if (controller.signal.aborted) {
        return { stopped: true }
      }

      throw new Error(safe)
    } finally {
      this.active = null
    }
  }

  close() {
    if (this.active) {
      throw new Error('Stop the agent before closing the runtime.')
    }

    this.store.close()
  }
}

function preview(value: unknown): string {
  return (typeof value === 'string' ? value : (JSON.stringify(value) ?? '')).slice(0, 4000)
}
