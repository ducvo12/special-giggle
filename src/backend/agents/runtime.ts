import { isAbsolute, join } from 'node:path'
import { rmSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isLiveRun, locksChat, type RunIntent, type RunPhase, type RunSnapshot } from '../../shared/run.ts'
import type { AgentMessage } from '../../shared/agent.ts'
import { ModelScheduler } from '../harness/scheduler.ts'
import { sessionKey } from './runs.ts'
import type { Connection, StreamDelta } from '../../shared/chat.ts'
import type { HarnessSettings } from '../../shared/harness.ts'
import { ensureOrganizationStorage, workspaceEntries, workspaceText } from '../workspace/workspace.ts'
import { AgentFilesystem } from '../workspace/filesystem.ts'
import type { ConversationLocation, SectionMode } from '../../shared/organization.ts'
import { AgentStore } from './store.ts'
import { AgentRegistry } from './registry.ts'
import { ApprovalQueue } from '../harness/approvals.ts'
import { runHarness } from '../harness/loop.ts'
import { HarnessError, SteeringInterrupt, type NativeItem } from '../harness/types.ts'
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

type Job = {
  run: RunSnapshot
  controller: AbortController
  generation?: AbortController
  emit: (delta: StreamDelta) => void
  done: Promise<{ stopped: boolean }>
}

export class AgentRuntime {
  store: AgentStore
  registry: AgentRegistry
  active: { id: string; controller: AbortController } | null = null
  approvals = new ApprovalQueue()
  private scheduler = new ModelScheduler()
  private jobs = new Map<string, Job>()
  private chats = new Map<string, Job>()

  isChatActive(id: string) {
    return [...this.jobs.values()].some(job => job.run.conversationId === id && locksChat(job.run))
  }

  private agentWorking(agentId: string) {
    return Boolean(this.active) || [...this.jobs.values()].some(job => job.run.agentId === agentId && locksChat(job.run))
  }

  listRuns() {
    const runs = this.store.runs.list()
    const last = new Map<string, RunSnapshot>()
    for (const run of runs) last.set(run.conversationId, run)
    return runs.filter(run => isLiveRun(run) || last.get(run.conversationId) === run)
  }

  private publish(job: Job, phase?: RunPhase, queue?: RunSnapshot['queue']) {
    if (phase) {
      job.run.phase = phase
      job.run.queue = queue
    }
    this.store.runs.save(job.run)
    job.emit({ requestId: job.run.id, text: '', run: { ...job.run } })
  }

  private publishMessages(job: Job) {
    job.emit({ requestId: job.run.id, text: '', messages: this.store.get(job.run.agentId, job.run.conversationId).messages })
  }
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
    if (this.agentWorking(agentId) || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before editing files.')
    }
    this.editingIdentity = true
    try { return await this.registry.saveMarkdown(agentId, path, content, expected) }
    finally { this.editingIdentity = false }
  }

  async renameNote(agentId: string, path: string, name: string) {
    if (this.agentWorking(agentId) || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before renaming notes.')
    }
    this.editingIdentity = true
    try { return await this.registry.renameNote(agentId, path, name) }
    finally { this.editingIdentity = false }
  }

  async saveIdentity(agentId: string, identity: string, expected: string) {
    if (this.agentWorking(agentId) || this.editingIdentity || this.changingAgents) {
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
    if (this.editingIdentity || this.changingAgents) {
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
    if (this.agentWorking(agentId) || [...this.jobs.values()].some(job => job.run.agentId === agentId) || this.editingIdentity || this.changingAgents) {
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
    if (this.editingIdentity || this.changingAgents) {
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
    if (this.editingIdentity || this.changingAgents) {
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
    return this.changeOrganization(agentId, () => {
      if (this.store.list(agentId).some(chat => chat.projectId === projectId && this.isChatActive(chat.id))) {
        throw new Error('Finish this project’s active runs before linking a repository.')
      }
      return this.store.organization.attachRepository(agentId, projectId, canonical)
    })
  }

  async moveConversation(agentId: string, id: string, location: ConversationLocation) {
    if (this.active || this.isChatActive(id)) throw new Error('Finish the current operation before moving this chat.')
    return this.changeOrganization(agentId, () => {
      if (this.isChatActive(id)) throw new Error('Finish the current operation before moving this chat.')
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
    if (this.active || [...this.jobs.values()].some(job => job.run.conversationId === id) || this.editingIdentity || this.changingAgents) {
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
    if (this.active?.id === id) this.active.controller.abort()
    const job = this.jobs.get(id)
    if (!job || job.controller.signal.aborted) return
    this.publish(job, 'stopping')
    job.controller.abort()
  }

  async stopAll() {
    const jobs = [...this.jobs.values()]
    for (const job of jobs) this.stop(job.run.id)
    await Promise.allSettled(jobs.map(job => job.done))
  }

  cancelPending(agentId: string, id: string) {
    if ([...this.jobs.values()].some(job => job.run.conversationId === id)) throw new Error('Stop the current request first.')
    this.store.runs.cancelPending(agentId, id)
  }

  async settings(agentId: string) {
    return readHarnessSettings(await this.registry.workspace(agentId))
  }

  async skills(agentId: string) {
    return listSkills(await this.registry.workspace(agentId))
  }

  async saveSettings(agentId: string, settings: HarnessSettings) {
    if (this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before changing agent tools.')
    }

    this.editingIdentity = true

    try {
      const saved = await saveHarnessSettings(await this.registry.workspace(agentId), settings)
      this.approvals.invalidateAgent(agentId)
      return saved
    } finally {
      this.editingIdentity = false
    }
  }

  async saveSkill(agentId: string, name: string, content: string) {
    if (this.agentWorking(agentId) || this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before saving a skill.')
    }

    this.editingIdentity = true

    try {
      await saveSkill(await this.registry.workspace(agentId), name, content)
    } finally {
      this.editingIdentity = false
    }
  }

  private validateLocation(agentId: string, conversationId: string) {
    const conversation = this.store.get(agentId, conversationId)
    const section = this.store.organization.section(agentId, conversation.sectionId)
    if (section.mode === 'closed') throw new Error('Closed-section runs will be available after isolated context is implemented. You can organize chats here now.')
    if (conversation.retention === 'temporary') throw new Error('Temporary-chat runs are not available until expiry and memory isolation are implemented.')
    if (conversation.projectId && this.store.organization.project(agentId, conversation.projectId).repositoryPath) {
      throw new Error('Repository-project runs will be available when repository tools and permissions are implemented.')
    }
    return conversation
  }

  async run(
    requestId: string, agentId: string, conversationId: string, connection: Connection,
    text: string, emit: (delta: StreamDelta) => void, intent: RunIntent = 'message'
  ) {
    if (this.editingIdentity || this.changingAgents) throw new Error('Finish the current settings operation first.')
    if (typeof text !== 'string' || (intent === 'message' && !text.trim()) || text.length > 32_000 ||
        typeof requestId !== 'string' || !requestId || requestId.length > 100 ||
        !['message', 'continue', 'pending'].includes(intent) || !connection.model ||
        connection.maxConcurrentRequests !== undefined && (!Number.isInteger(connection.maxConcurrentRequests) || connection.maxConcurrentRequests < 1 || connection.maxConcurrentRequests > 32)) {
      throw new Error('Invalid or oversized message.')
    }
    if (connection.provider === 'codex') throw new Error('Reconnect this legacy connection with ChatGPT or a Responses API connection.')
    if (this.store.runs.list().some(run => run.id === requestId)) throw new Error('This request has already been accepted.')
    this.validateLocation(agentId, conversationId)
    this.store.runs.bind(agentId, conversationId, connection)
    const current = this.chats.get(conversationId)
    if (current && current.run.phase !== 'stopping') {
      if (intent !== 'message') throw new Error('This chat already has pending or active work.')
      this.store.runs.append(current.run, text.trim())
      this.publishMessages(current)
      if (current.run.startedAt !== null) {
        current.generation?.abort(new SteeringInterrupt())
        this.approvals.withdraw(current.run.id)
      }
      return { stopped: false, steered: true, runId: current.run.id }
    }
    const existing = intent === 'pending' ? this.store.get(agentId, conversationId).messages.filter(message => message.delivery === 'pending') : []
    if (intent === 'pending' && !existing.length) throw new Error('There are no pending messages to run.')
    if (intent === 'continue' && ![...this.store.get(agentId, conversationId).messages].reverse().find(message => message.role === 'assistant')?.interrupted) {
      throw new Error('There is no interrupted reply to continue.')
    }
    const run: RunSnapshot = {
      id: requestId, agentId, conversationId, phase: 'queued', model: connection.model,
      connectionId: connection.connectionId, effort: connection.effort,
      createdAt: Date.now(), startedAt: null, endedAt: null, messageIds: [],
      queue: { reason: current ? 'Waiting for the stopped run to finish cleanup' : 'Waiting for model capacity', position: 1 }
    }
    this.store.runs.accept(run, intent === 'continue' ? 'Continue the interrupted task using the original request, corrections and actual completed outcomes. Do not repeat completed actions.' : text.trim(), existing)
    const job: Job = { run, controller: new AbortController(), emit, done: Promise.resolve({ stopped: false }) }
    this.jobs.set(requestId, job)
    this.chats.set(conversationId, job)
    this.publish(job)
    this.publishMessages(job)
    job.done = this.execute(job, connection, current?.done).finally(() => {
      this.jobs.delete(requestId)
      if (this.chats.get(conversationId) === job) this.chats.delete(conversationId)
    })
    return job.done
  }

  private async execute(job: Job, connection: Connection, predecessor?: Job['done']) {
    const { run, controller } = job
    const { agentId, conversationId } = run
    const signal = controller.signal
    let turn: ReturnType<AgentStore['begin']> | undefined
    let lastSave = 0
    let identity: string | undefined
    let inputInitialized = false
    let pausedIntegrations = false
    const integrationNotice = 'Connected integrations are paused while this agent has Closed sections. Section-aware integrations are not available yet.'
    const activity = { reasoningCharacters: 0, answerCharacters: 0 }
    const persist = () => { if (turn) this.store.saveMessage(conversationId, turn.message) }
    const splitReply = () => {
      if (!turn) return
      turn.message.status = 'interrupted'
      turn.message.interrupted = true
      turn.message.notice = 'Provisional reply interrupted by your new direction.'
      persist()
      turn.message = {
        id: randomUUID(), runId: run.id, role: 'assistant', content: '', status: 'running', tools: [],
        model: run.model, connectionId: run.connectionId, effort: run.effort,
        ...(pausedIntegrations ? { notice: integrationNotice } : {})
      }
      persist()
    }
    const initialize = () => {
      if (!turn) {
        this.validateLocation(agentId, conversationId)
        const pending = this.store.runs.pending(run)
        // Startup must distinguish never-started prompts from interrupted work,
        // even if the process exits between these individual database writes.
        this.store.saver.db.transaction(() => {
          run.startedAt = Date.now()
          turn = this.store.begin(agentId, conversationId, pending[0]?.content ?? '', connection.model, sessionKey(connection), pending, run.id)
          turn.message.connectionId = connection.connectionId
          turn.message.effort = connection.effort
          if (pausedIntegrations) turn.message.notice = integrationNotice
          persist()
          this.publish(job, 'preparing')
        })()
        this.publishMessages(job)
      }
      return turn!
    }
    const settings = async () => {
      const value = await this.settings(agentId)
      const hasClosed = this.store.organization.snapshot(agentId).sections.some(section => section.mode === 'closed')
      pausedIntegrations = hasClosed && value.mcpServers.some(server => server.enabled)
      if (pausedIntegrations && turn && !turn.message.notice?.includes(integrationNotice)) {
        turn.message.notice = [turn.message.notice, integrationNotice].filter(Boolean).join(' ')
        persist()
      }
      return hasClosed ? { ...value, mcpServers: [] } : value
    }
    try {
      await predecessor?.catch(() => {})
      signal.throwIfAborted()
      const profile = await this.registry.get(agentId)
      const humanWorkspace = await this.registry.workspace(agentId)
      const workspace = new AgentFilesystem(humanWorkspace.root, { excludeOrganization: true })
      let state: NativeItem[] | undefined
      do {
        const result = await runHarness({
          connection, workspace, settings: await settings(), instructions: '', history: [], text: '', state,
          signal,
          initialize: () => {
            const first = !inputInitialized
            inputInitialized = true
            const current = initialize()
            const pending = this.store.runs.pending(run)
            if (!first && pending.length) splitReply()
            this.store.runs.consume(run, pending)
            this.publishMessages(job)
            return {
              history: current.history,
              state: state ?? (first && !current.recovered ? this.store.modelState(conversationId, sessionKey(connection)) : undefined),
              messages: pending.map(message => message.content)
            }
          },
          getSettings: settings,
          getInstructions: async () => {
            this.validateLocation(agentId, conversationId)
            initialize()
            identity ??= await workspaceText(workspace, '/identity.md')
            const memory = await workspaceText(workspace, '/memory.md')
            return [instructions, turn?.interrupted ? 'The previous run was interrupted. Completed file changes remain. Inspect current files before continuing unfinished work.' : '',
              '<agent_profile>', JSON.stringify(profile), '</agent_profile>', '<identity>', identity, '</identity>',
              '<user_memory>', memory, '</user_memory>'].join('\n')
          },
          acquire: requestSignal => this.scheduler.acquire(connection, requestSignal, (position, reason) => {
            if (!signal.aborted) this.publish(job, 'queued', { position, reason })
          }),
          generation: () => {
            job.generation = new AbortController()
            return job.generation
          },
          hasSteering: () => Boolean(turn && this.store.runs.pending(run).length),
          takeSteering: () => {
            const pending = this.store.runs.pending(run)
            this.store.runs.consume(run, pending)
            if (pending.length) {
              splitReply()
              this.publishMessages(job)
            }
            return pending.map(message => message.content)
          },
          onPhase: (phase, queue) => { if (!signal.aborted) this.publish(job, phase, queue) },
          onText: text => {
            signal.throwIfAborted()
            initialize().message.content += text
            activity.answerCharacters += text.length
            job.emit({ requestId: run.id, text, activity: { ...activity } })
            if (Date.now() - lastSave > 150) { persist(); lastSave = Date.now() }
          },
          onUsage: usage => {
            signal.throwIfAborted()
            initialize().message.contextUsage = usage
            persist()
            job.emit({ requestId: run.id, text: '', contextUsage: usage })
          },
          onReasoning: count => {
            signal.throwIfAborted()
            activity.reasoningCharacters += count
            job.emit({ requestId: run.id, text: '', activity: { ...activity } })
          },
          onTool: tool => {
            signal.throwIfAborted()
            const message = initialize().message
            const index = message.tools!.findIndex(item => item.id === tool.id)
            if (index < 0) message.tools!.push(tool)
            else message.tools![index] = tool
            persist()
            job.emit({ requestId: run.id, text: '', tool })
          },
          approve: async (kind, title, detail) => {
            initialize()
            this.publish(job, 'approval')
            try {
              return await this.approvals.ask({ requestId: run.id, agentId, kind, title, detail }, signal,
                approval => job.emit({ requestId: run.id, text: '', approval }))
            } finally { if (!signal.aborted) this.publish(job, 'tools') }
          }
        })
        state = result.state
        signal.throwIfAborted()
        // Closing optional transports is asynchronous. Messages accepted during
        // that boundary still belong to this run and must precede finalization.
      } while (this.store.runs.pending(run).length)
      this.store.saver.db.transaction(() => {
        this.store.saveModelState(conversationId, sessionKey(connection), state!)
        this.store.finish(conversationId, turn!.message, 'complete')
        run.endedAt = Date.now()
        this.publish(job, 'complete')
      })()
      this.publishMessages(job)
      return { stopped: false }
    } catch (error) {
      const stopped = signal.aborted
      const safe = error instanceof HarnessError || error instanceof Error && !turn
        ? error.message : 'The agent could not finish this reply. Check the connection and model, then Continue.'
      if (turn) {
        if (!stopped) turn.message.error = safe
        this.store.finish(conversationId, turn.message, stopped ? 'stopped' : 'error')
      }
      if (stopped && !turn) {
        for (const message of this.store.runs.pending(run)) this.store.saveMessage(conversationId, { ...message, delivery: 'cancelled' })
      }
      run.error = stopped ? undefined : safe
      run.endedAt = Date.now()
      this.publish(job, stopped ? 'stopped' : 'error')
      this.publishMessages(job)
      if (stopped) return { stopped: true }
      throw new Error(safe)
    }
  }

  close() {
    if (this.active || this.jobs.size) throw new Error('Stop the agent before closing the runtime.')
    this.store.close()
  }
}
