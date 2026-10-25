import { isAbsolute, join } from 'node:path'
import { rmSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Connection, StreamDelta } from '../../shared/chat.ts'
import type { HarnessSettings } from '../../shared/harness.ts'
import { ensureOrganizationStorage, workspaceEntries, workspaceText } from '../workspace/workspace.ts'
import { AgentFilesystem } from '../workspace/filesystem.ts'
import type { ConversationLocation, SectionMode } from '../../shared/organization.ts'
import { AgentStore } from './store.ts'
import { AgentRegistry } from './registry.ts'
import { ApprovalQueue } from '../harness/approvals.ts'
import { runHarness } from '../harness/loop.ts'
import { HarnessError } from '../harness/types.ts'
import {
  readHarnessSettings,
  saveHarnessSettings,
  listSkills,
  saveSkill
} from '../harness/settings.ts'

const instructions = `You are a personal agent running in Granite. Your name and personality come from the agent profile and identity below.
Your file tools use a virtual workspace rooted at /. Use /notes/ for notes and /projects/ for projects.
Use /memory.md for explicit user preferences across conversations. Read existing content before editing. Never store secrets or guesses as facts.
Identity, agent configuration, harness settings, and skills are read-only to tools; the user manages them in the application.
For a simple question, answer directly. Use plans and tools only when they help complete the user's request. For file changes, actually call tools and report their outcome.
Load a relevant skill from the available catalog before applying its instructions. MCP and terminal tools are available only if the user enabled them.
Granite enforces permissions independently of your instructions. Respect a denied action; do not attempt a different tool to bypass it.
Completed actions remain after Stop or a failed run. Inspect current files before continuing interrupted work; never assume unfinished actions succeeded.`

export class AgentRuntime {
  store: AgentStore
  registry: AgentRegistry
  active: { id: string; controller: AbortController } | null = null
  approvals = new ApprovalQueue()
  private editingIdentity = false
  private changingAgents = false

  private constructor(store: AgentStore, registry: AgentRegistry) {
    this.store = store
    this.registry = registry
  }

  static async open(directory: string) {
    const registry = await AgentRegistry.open(directory)

    // Retain the original database filename, including existing WAL/checkpoints.
    const runtime = new AgentRuntime(new AgentStore(join(directory, 'atlas.sqlite')), registry)
    try {
      for (const agent of await registry.list()) {
        runtime.store.organization.ensureGeneral(agent.id)
        const workspace = await registry.workspace(agent.id)
        ensureOrganizationStorage(workspace.root, runtime.store.organization.snapshot(agent.id))
      }
      return runtime
    } catch (error) {
      runtime.close()
      throw error
    }
  }

  async entries(agentId: string, path: string) {
    return workspaceEntries(await this.registry.workspace(agentId), path)
  }

  async read(agentId: string, path: string) {
    return workspaceText(await this.registry.workspace(agentId), path)
  }

  async saveMarkdown(agentId: string, path: string, content: string, expected: string | null) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before editing files.')
    }
    this.editingIdentity = true
    try { return await this.registry.saveMarkdown(agentId, path, content, expected) }
    finally { this.editingIdentity = false }
  }

  async renameNote(agentId: string, path: string, name: string) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before renaming notes.')
    }
    this.editingIdentity = true
    try { return await this.registry.renameNote(agentId, path, name) }
    finally { this.editingIdentity = false }
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
      const agent = await this.registry.create(name)
      this.store.organization.ensureGeneral(agent.id)
      const workspace = await this.registry.workspace(agent.id)
      ensureOrganizationStorage(workspace.root, this.store.organization.snapshot(agent.id))
      return agent
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

  async createConversation(agentId: string, location?: Partial<ConversationLocation>) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before creating a conversation.')
    }

    // Hold the same guard while validating the folder and inserting the row,
    // so an in-flight request cannot recreate records after agent deletion.
    this.changingAgents = true

    try {
      await this.registry.get(agentId)

      return this.store.create(agentId, location)
    } finally {
      this.changingAgents = false
    }
  }

  async organization(agentId: string) {
    await this.registry.get(agentId)
    return this.store.organization.snapshot(agentId)
  }

  private async changeOrganization<T>(agentId: string, change: () => T) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before changing sections, projects or chat locations.')
    }
    this.changingAgents = true
    try {
      const workspace = await this.registry.workspace(agentId)
      return this.store.saver.db.transaction(() => {
        const result = change()
        ensureOrganizationStorage(workspace.root, this.store.organization.snapshot(agentId))
        return result
      })()
    } finally {
      this.changingAgents = false
    }
  }

  createSection(agentId: string, name: string, mode: SectionMode) {
    return this.changeOrganization(agentId, () => this.store.organization.createSection(agentId, name, mode))
  }

  renameSection(agentId: string, id: string, name: string) {
    return this.changeOrganization(agentId, () => this.store.organization.renameSection(agentId, id, name))
  }

  shareSection(agentId: string, id: string) {
    return this.changeOrganization(agentId, () => this.store.organization.shareSection(agentId, id))
  }

  createProject(agentId: string, sectionId: string, name: string) {
    return this.changeOrganization(agentId, () => this.store.organization.createProject(agentId, sectionId, name))
  }

  renameProject(agentId: string, id: string, name: string) {
    return this.changeOrganization(agentId, () => this.store.organization.renameProject(agentId, id, name))
  }

  async attachRepository(agentId: string, projectId: string, path: string) {
    // Resolve the selected directory before publishing the reference. No copying,
    // symlinking or modification of the selected codebase is performed here.
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error('Choose an existing repository folder.')
    const canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) throw new Error('Choose a repository folder, not a file.')
    return this.changeOrganization(agentId, () => this.store.organization.attachRepository(agentId, projectId, canonical))
  }

  moveConversation(agentId: string, id: string, location: ConversationLocation) {
    return this.changeOrganization(agentId, () => {
      this.store.organization.move(agentId, id, location)
      return this.store.get(agentId, id)
    })
  }

  async renameConversation(agentId: string, id: string, title: string) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before renaming a conversation.')
    }
    this.changingAgents = true
    try {
      await this.registry.get(agentId)
      this.store.renameConversation(agentId, id, title)
    } finally {
      this.changingAgents = false
    }
  }

  async deleteConversation(agentId: string, id: string) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before deleting a conversation.')
    }

    this.changingAgents = true

    try {
      await this.registry.get(agentId)
      this.store.deleteConversation(agentId, id)
    } finally {
      this.changingAgents = false
    }
  }

  stop(id: string) {
    if (this.active?.id === id) {
      this.active.controller.abort()
    }
  }

  async settings(agentId: string) {
    return readHarnessSettings(await this.registry.workspace(agentId))
  }

  async skills(agentId: string) {
    return listSkills(await this.registry.workspace(agentId))
  }

  async saveSettings(agentId: string, settings: HarnessSettings) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before changing agent tools.')
    }

    this.editingIdentity = true

    try {
      return await saveHarnessSettings(await this.registry.workspace(agentId), settings)
    } finally {
      this.editingIdentity = false
    }
  }

  async saveSkill(agentId: string, name: string, content: string) {
    if (this.active || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before saving a skill.')
    }

    this.editingIdentity = true

    try {
      await saveSkill(await this.registry.workspace(agentId), name, content)
    } finally {
      this.editingIdentity = false
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
        'An agent is already working or its settings are being saved. Finish the current operation first.'
      )
    }

    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 32_000 ||
      typeof requestId !== 'string' ||
      !requestId ||
      requestId.length > 100
    ) {
      throw new Error('Invalid or oversized message.')
    }

    if (connection.provider === 'codex') {
      throw new Error(
        'This connection uses the previous Codex runtime. Reconnect with ChatGPT or a Responses API connection in Settings.'
      )
    }

    const conversation = this.store.get(agentId, conversationId)
    const section = this.store.organization.section(agentId, conversation.sectionId)
    if (section.mode === 'closed') throw new Error('Closed-section runs will be available after isolated context is implemented. You can organize chats here now.')
    if (conversation.retention === 'temporary') throw new Error('Temporary-chat runs are not available until expiry and memory isolation are implemented.')
    if (conversation.projectId && this.store.organization.project(agentId, conversation.projectId).repositoryPath) {
      throw new Error('Repository-project runs will be available when repository tools and permissions are implemented.')
    }
    const locked = conversation.messages.find(message => message.role === 'assistant' && message.model)
    if (locked && (locked.model !== connection.model || (locked.connectionId && locked.connectionId !== connection.connectionId))) {
      throw new Error('The model is fixed for this conversation. Start a new chat to choose another model.')
    }

    const controller = new AbortController()
    const signal = controller.signal
    this.active = { id: requestId, controller }
    let turn: ReturnType<AgentStore['begin']> | undefined
    let lastSave = 0
    const activity = { reasoningCharacters: 0, answerCharacters: 0 }

    try {
      const profile = await this.registry.get(agentId)
      const humanWorkspace = await this.registry.workspace(agentId)
      const workspace = new AgentFilesystem(humanWorkspace.root, { excludeOrganization: true })
      const [identity, memory, settings] = await Promise.all([
        workspaceText(workspace, '/identity.md'),
        workspaceText(workspace, '/memory.md'),
        readHarnessSettings(workspace)
      ])
      const modelKey = createHash('sha256')
        .update(
          JSON.stringify([
            connection.provider ?? 'openai',
            connection.protocol ?? 'chat-completions',
            connection.baseUrl,
            connection.model,
            connection.accountId ?? ''
          ])
        )
        .digest('hex')
      turn = this.store.begin(agentId, conversationId, text.trim(), connection.model, modelKey)
      turn.message.connectionId = connection.connectionId
      turn.message.effort = connection.effort
      this.store.saveMessage(conversationId, turn.message)
      const persist = () => this.store.saveMessage(conversationId, turn!.message)
      const previous = turn.recovered ? undefined : this.store.modelState(conversationId, modelKey)
      // The existing unscoped MCP transport must not read Closed files via the
      // agent root. Scoped connector integration belongs to pass 5.
      const hasClosed = this.store.organization.snapshot(agentId).sections.some(item => item.mode === 'closed')
      if (hasClosed && settings.mcpServers.some(server => server.enabled)) {
        turn.message.notice = 'Connected integrations are paused while this agent has Closed sections. Section-aware integrations are not available yet.'
      }
      const result = await runHarness({
        connection,
        workspace,
        settings: hasClosed ? { ...settings, mcpServers: [] } : settings,
        instructions: [
          instructions,
          turn.interrupted
            ? 'The previous run was interrupted. Completed file changes remain. Inspect current files before continuing unfinished work.'
            : '',
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
        history: turn.history,
        state: previous,
        text: text.trim(),
        signal,
        onText: text => {
          turn!.message.content += text
          activity.answerCharacters += text.length
          emit({ requestId, text, activity: { ...activity } })

          if (Date.now() - lastSave > 150) {
            persist()
            lastSave = Date.now()
          }
        },
        onUsage: usage => {
          turn!.message.contextUsage = usage
          persist()
          emit({ requestId, text: '', contextUsage: usage })
        },
        onReasoning: characters => {
          activity.reasoningCharacters += characters
          emit({ requestId, text: '', activity: { ...activity } })
        },
        onTool: tool => {
          const index = turn!.message.tools!.findIndex(item => item.id === tool.id)

          if (index < 0) {
            turn!.message.tools!.push(tool)
          } else {
            turn!.message.tools![index] = tool
          }

          persist()
          emit({ requestId, text: '', tool })
        },
        approve: (kind, title, detail) =>
          this.approvals.ask({ requestId, agentId, kind, title, detail }, signal, approval =>
            emit({ requestId, text: '', approval })
          )
      })
      signal.throwIfAborted()

      if (result.withoutAnswer) {
        turn.message.notice = [turn.message.notice,
          'The model ended without a final message. Completed tool results are shown above.'
        ].filter(Boolean).join(' ')
      }

      this.store.saver.db.transaction(() => {
        this.store.saveModelState(conversationId, modelKey, result.state)
        this.store.finish(conversationId, turn!.message, 'complete')
      })()

      return { stopped: false }
    } catch (error) {
      const safe =
        error instanceof HarnessError
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
