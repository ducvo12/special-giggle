import { ContextService } from '../context/service.ts'
import { ContextSession, safeHistory } from '../context/session.ts'
import { revision } from '../context/store.ts'
import { isAbsolute, join } from 'node:path'
import { mkdirSync, rmdirSync, rmSync } from 'node:fs'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isLiveRun, locksChat, type RunIntent, type RunPhase, type RunSnapshot } from '../../shared/run.ts'
import type { AgentMessage } from '../../shared/agent.ts'
import { ModelScheduler } from '../harness/scheduler.ts'
import { repositoryAccess, internalRepository } from '../repositories/access.ts'
import { SetupAuthorization } from '../repositories/authorization.ts'
import { PreviewManager } from '../repositories/previews.ts'
import { RepositoryStore } from '../repositories/store.ts'
import { RepositorySession } from '../repositories/session.ts'
import { RepositoryPaths, within } from '../repositories/paths.ts'
import { sessionKey } from './runs.ts'
import type { Connection, StreamDelta } from '../../shared/chat.ts'
import type { HarnessSettings } from '../../shared/harness.ts'
import { ensureOrganizationStorage, workspaceEntries, workspaceText } from '../workspace/workspace.ts'
import { AgentFilesystem } from '../workspace/filesystem.ts'
import type { ConversationLocation, SectionMode } from '../../shared/organization.ts'
import { AgentStore } from './store.ts'
import { AgentRegistry } from './registry.ts'
import { QuestionQueue } from '../harness/questions.ts'
import { ApprovalQueue } from '../harness/approvals.ts'
import { runHarness } from '../harness/loop.ts'
import { HarnessError, ModelAccessError, SteeringInterrupt, type NativeItem } from '../harness/types.ts'
import {
  readHarnessSettings,
  saveHarnessSettings,
  listSkills,
  saveSkill
} from '../harness/settings.ts'

const instructions = `You are a personal agent running in Granite. Your name and personality come from the agent profile and identity below.
Your file tools use a virtual workspace rooted at /. Use /notes/ for notes. Repository files are available only through the separate repo_ tools.
Use context tools for permitted chat history, confirmed user facts, notes and continuity summaries. Use update_memory and save_note for durable writes with original source references; legacy workspace edits also use the context layer. Never store secrets or guesses as facts.
Identity changes require propose_identity_change and approval of the exact replacement. Configuration and skills are read-only to tools. Closed chats have section-only context and notes, without agent memory or global file/terminal tools.
For a simple question, answer directly. Use plans and tools only when they help complete the user's request. For file changes, actually call tools and report their outcome.
Load a relevant skill from the available catalog before applying its instructions. MCP and terminal tools are available only if the user enabled them.
Granite enforces permissions independently of your instructions. Respect a denied action; do not attempt a different tool to bypass it.
For project setup, inspect existing files first. Use ask_user for consequential choices you cannot infer; honor supplied commands, prior answers and requested defaults. Answer routine installer prompts yourself when their answer is known. Never ask for credentials in chat. Use interactive sessions for prompting commands and verify successful builds before claiming setup is done.
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
  questions = new QuestionQueue()
  private scheduler = new ModelScheduler()
  private projectScheduler = new ModelScheduler()
  context: ContextService
  repositories: RepositoryStore
  authorization: SetupAuthorization
  previews: PreviewManager
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

  private directory: string
  private constructor(store: AgentStore, registry: AgentRegistry, directory: string) {
    this.directory = directory
    this.store = store
    this.registry = registry
    this.context = new ContextService(store, directory)
    this.repositories = new RepositoryStore(store, directory)
    this.authorization = new SetupAuthorization(store)
    this.previews = new PreviewManager(store, directory)
  }

  static async open(directory: string) {
    await mkdir(directory, { recursive: true })
    directory = await realpath(directory)
    const registry = await AgentRegistry.open(directory)

    // Retain the original database filename, including existing WAL/checkpoints.
    const runtime = new AgentRuntime(new AgentStore(join(directory, 'atlas.sqlite')), registry, directory)
    try {
      for (const agent of await registry.list()) {
        runtime.store.organization.ensureGeneral(agent.id)
        const workspace = await registry.workspace(agent.id)
        ensureOrganizationStorage(workspace.root, runtime.store.organization.snapshot(agent.id))
      }
      await runtime.previews.recover()
      for (const grant of runtime.authorization.all()) if (grant.state === 'active') runtime.authorization.end(grant.runId)
      await runtime.repositories.recoverAll()
      return runtime
    } catch (error) {
      runtime.close()
      throw error
    }
  }

  recovery() {
    return { ...this.store.runs.recovery(), previews: this.previews.interruptedCount(), repositories: this.repositories.records().filter(record => record.report.state === 'attention').length }
  }

  async createRepository(agentId: string, projectId: string) {
    const project = this.store.organization.project(agentId, projectId)
    const path = internalRepository(this.directory, agentId, project.sectionId, projectId)
    if (project.repositoryPath) throw new Error('This project already has a repository.')
    if (this.store.list(agentId).some(chat => chat.projectId === projectId && this.isChatActive(chat.id))) throw new Error('Stop project runs before creating its repository.')
    const workspace = await this.registry.workspace(agentId)
    ensureOrganizationStorage(workspace.root, this.store.organization.snapshot(agentId))
    await mkdir(path, { recursive: false })
    try { return await this.attachRepository(agentId, projectId, path) }
    catch (error) { await (await import('node:fs/promises')).rmdir(path).catch(() => {}); throw error }
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
      await this.previews.stopAgent(agentId)

      // Run in the worker, synchronously inside the transaction: a filesystem
      // failure rolls back database deletion, and no other request interleaves.
      this.store.saver.db.transaction(() => {
        this.previews.remove(agentId)
        this.authorization.remove(agentId)
        this.repositories.removeRecords(agentId)
        this.context.db.prepare('DELETE FROM context_items WHERE agentId=?').run(agentId)
        this.context.db.prepare('DELETE FROM context_documents WHERE agentId=?').run(agentId)
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

  private async changeOrganization<T>(agentId: string, change: (workspaceRoot: string) => T) {
    if (this.editingIdentity || this.changingAgents) {
      throw new Error('Finish the current operation before changing sections, projects or chat locations.')
    }
    this.changingAgents = true
    try {
      const workspace = await this.registry.workspace(agentId)
      return this.store.saver.db.transaction(() => {
        const result = change(workspace.root)
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

  async createProject(agentId: string, sectionId: string, name: string, repositoryPath: string | null = null, createRepository = false) {
    if (typeof createRepository !== 'boolean' || createRepository && repositoryPath !== null) throw new Error('Choose either a linked folder or a new repository folder.')
    const canonical = repositoryPath === null ? null : await this.resolveRepositoryFolder(repositoryPath)
    let createdFolder: string | undefined
    try {
      return await this.changeOrganization(agentId, workspaceRoot => {
        const project = this.store.organization.createProject(agentId, sectionId, name, canonical)
        if (!createRepository) return project
        ensureOrganizationStorage(workspaceRoot, this.store.organization.snapshot(agentId))
        const folder = internalRepository(this.directory, agentId, sectionId, project.id)
        mkdirSync(folder, { mode: 0o700 })
        createdFolder = folder
        return this.store.organization.attachRepository(agentId, project.id, folder)
      })
    } catch (error) {
      if (createdFolder) { try { rmdirSync(createdFolder) } catch {} }
      throw error
    }
  }

  renameProject(agentId: string, id: string, name: string) {
    return this.changeOrganization(agentId, () => this.store.organization.renameProject(agentId, id, name))
  }

  private async resolveRepositoryFolder(path: string, internal?: string) {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error('Choose an existing repository folder.')
    const canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) throw new Error('Choose a repository folder, not a file.')
    if (within(this.directory, canonical) && canonical !== internal) throw new Error('Link a code folder outside Granite storage, or create a repository inside this project.')
    return canonical
  }

  async attachRepository(agentId: string, projectId: string, path: string) {
    // Resolve the selected directory before publishing the reference. No copying,
    // symlinking or modification of the selected codebase is performed here.
    const project = this.store.organization.project(agentId, projectId)
    if (project.repositoryPath) throw new Error('This project already has a repository. Relinking is not available yet.')
    const canonical = await this.resolveRepositoryFolder(path, internalRepository(this.directory, agentId, project.sectionId, projectId))
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
      await this.previews.stopChat(agentId, id)
      this.store.saver.db.transaction(() => {
        this.previews.remove(agentId, id)
        this.authorization.remove(agentId, id)
        this.repositories.removeRecords(agentId, id)
        this.store.deleteConversation(agentId, id)
      })()
      await this.context.sync(agentId)
    } finally {
      this.changingAgents = false
    }
  }

  stop(id: string) {
    if (this.active?.id === id) this.active.controller.abort()
    const job = this.jobs.get(id)
    if (!job || job.controller.signal.aborted) { void this.previews.stopRun(id).catch(() => {}); return }
    this.publish(job, 'stopping')
    job.controller.abort()
  }

  answerQuestion(runId: string, questionId: string, answers: string[]) {
    const job = this.jobs.get(runId)
    if (!job || job.controller.signal.aborted || job.run.question?.id !== questionId || !Array.isArray(answers) || answers.length !== job.run.question.questions.length) throw new Error('This question is no longer pending.')
    this.questions.answer(runId, questionId, answers)
  }

  rejectQuestion(runId: string, questionId: string) {
    const job = this.jobs.get(runId)
    if (!job || job.controller.signal.aborted || job.run.question?.id !== questionId) throw new Error('This question is no longer pending.')
    this.questions.reject(runId, questionId)
  }

  async stopAll() {
    const jobs = [...this.jobs.values()]
    for (const job of jobs) this.stop(job.run.id)
    await Promise.allSettled(jobs.map(job => job.done))
    await this.previews.stopAll()
  }

  async restartPreview(agentId: string, chatId: string, id: string) {
    const chat = this.store.get(agentId, chatId)
    if ((await this.settings(agentId)).terminal !== true) throw new Error('Enable terminal tools before restarting a preview.')
    if ([...this.jobs.values()].some(job => this.store.get(job.run.agentId, job.run.conversationId).projectId === chat.projectId)) throw new Error('Finish this project’s active work before refreshing the preview.')
    if (chat.projectId) this.repositories.assertAvailable(chat.projectId)
    return this.previews.restart(agentId, chatId, id, new AbortController().signal)
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
    if (conversation.retention === 'temporary') throw new Error('Temporary-chat runs are not available until expiry and memory isolation are implemented.')
    if (conversation.projectId && this.store.organization.project(agentId, conversation.projectId).repositoryPath) this.repositories.assertAvailable(conversation.projectId)
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
      const message = this.store.runs.append(current.run, text.trim())
      const projectId = this.store.get(agentId, conversationId).projectId
      if (projectId) this.authorization.message(current.run.id, agentId, conversationId, projectId, message)
      this.publishMessages(current)
      if (current.run.startedAt !== null) {
        current.generation?.abort(new SteeringInterrupt())
        this.approvals.withdraw(current.run.id)
        this.questions.withdraw(current.run.id)
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
    let repository: RepositorySession | undefined
    let releaseProject: (() => void) | undefined
    const updateRepository = () => {
      if (!repository) return
      const report = repository.record.report
      run.repository = { projectId: report.projectId, name: report.name, state: report.state, error: report.error,
        commandVersion: report.commandVersion,
        files: report.changes.length, added: report.changes.reduce((sum, change) => sum + change.added, 0), removed: report.changes.reduce((sum, change) => sum + change.removed, 0) }
      this.publish(job)
    }
    const settleRepository = async () => {
      if (!repository) return
      try {
        await repository.close()
        await this.repositories.refresh(repository.record)
        if (repository.record.report.state !== 'attention') repository.record.report.state = 'settled'
      } catch (error) {
        repository.record.report.state = 'attention'; repository.record.report.error = error instanceof Error ? error.message : 'Could not verify repository changes.'
      }
      this.repositories.save(repository.record); updateRepository()
      await this.previews.refreshProject(repository.record.projectId).catch(() => {})
    }
    const completedQuestionTools = new Set<string>()
    let pausedIntegrations = false
    const integrationNotice = 'Connected integrations are paused while this agent has Closed sections or repositories. Scoped integrations are not available yet.'
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
      const organization = this.store.organization.snapshot(agentId)
      const hasClosed = organization.sections.some(section => section.mode === 'closed') || organization.projects.some(project => project.repositoryPath)
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
      const location = this.validateLocation(agentId, conversationId)
      const project = location.projectId ? this.store.organization.project(agentId, location.projectId) : undefined
      if (project?.repositoryPath) {
        releaseProject = await this.projectScheduler.acquireResource({ key: project.id, capacity: 1, reason: 'Queued for repository project' }, signal,
          (position, reason) => this.publish(job, 'queued', { position, reason }))
        this.validateLocation(agentId, conversationId)
        const paths = new RepositoryPaths(project.repositoryPath, this.directory, internalRepository(this.directory, agentId, project.sectionId, project.id))
        await paths.check()
        const record = { runId: run.id, agentId, conversationId, projectId: project.id, root: project.repositoryPath,
          internalRoot: internalRepository(this.directory, agentId, project.sectionId, project.id), baseline: {}, touched: [],
          report: { runId: run.id, projectId: project.id, name: project.name, state: 'active' as const, changes: [], preExisting: 0 } }
        this.repositories.save(record)
        repository = new RepositorySession(record, this.repositories, signal, updateRepository)
        this.authorization.begin(run.id, agentId, conversationId, project.id, this.store.get(agentId, conversationId).messages)
        updateRepository()
      }
      const profile = await this.registry.get(agentId)
      const humanWorkspace = await this.registry.workspace(agentId)
      const workspace = new AgentFilesystem(humanWorkspace.root, { excludeOrganization: true })
      const context = new ContextSession(this.context, agentId, conversationId, signal, source => {
        if (!turn) return
        const sources = turn.message.sources ??= []
        const old = sources.findIndex(item => item.id === source.id)
        const { content: _content, ...reference } = source as import('../../shared/context.ts').ContextDocument
        if (old >= 0) sources[old] = reference
        else if (sources.length < 20) sources.push(reference)
        persist()
      })
      await context.refresh()
      let state: NativeItem[] | undefined
      do {
        const result = await runHarness({
          connection, workspace, settings: await settings(), instructions: '', history: [], text: '', state,
          signal, context,
          rebuildHistory: () => safeHistory(this.store.get(agentId, conversationId).messages),
          onContext: status => { run.context = status; if (turn) { turn.message.contextStatus = status; persist() }; this.publish(job) },
          repository: {
            signal, owner: repository, authorization: this.authorization, previews: this.previews,
            access: () => repositoryAccess(this.store, this.directory, agentId, conversationId),
            userMessages: () => this.store.get(agentId, conversationId).messages.filter(message => message.role === 'user' && !message.questionId && message.runId === run.id).map(message => message.content),
            requestEntry: projectId => {
              const target = repositoryAccess(this.store, this.directory, agentId, conversationId).find(target => target.projectId === projectId)
              if (!target) throw new Error('Repository is unavailable.')
              const problem = (this.store.get(agentId, conversationId).retention === 'temporary')
                ? 'Keep the temporary chat first.' : undefined
              if (problem) throw new Error(problem)
              run.projectEntry = { projectId, name: target.name }; this.publish(job)
            }
          },
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
            await context.refresh()
            const orientation = await context.orientation()
            return [instructions, turn?.interrupted ? 'The previous run was interrupted. Completed file changes remain. Inspect current files before continuing unfinished work.' : '',
              '<agent_profile>', JSON.stringify(profile), '</agent_profile>', '<identity>', identity, `Revision: ${revision(identity)}`, '</identity>',
              '<permitted_context>', orientation, '</permitted_context>',
              '<task_permissions>', JSON.stringify(this.authorization.list(agentId, conversationId).filter(grant => grant.runId === run.id && grant.operation !== 'preview')), '</task_permissions>',
              'For setup, use one supported package-manager command per tool call. Pass network:true for authorized downloads. A setup grant covers related npm/pnpm/yarn/bun install/create or supported npx scaffold commands; compound shell commands and other network actions require their own approval. Build with networking disabled unless a separate needed action is authorized. Check resulting files and build output even if a CLI exits zero. Use ask_user for missing choices, then keep working in the same task. You may start a local preview whenever useful for the task without asking for authorization. Respect an explicit instruction not to preview and user Stop actions. Use repo_preview_start with the supplied HOST/PORT environment and wait for actual ready status. A ready preview can remain after your final reply, but it serves its recorded snapshot; refresh after edits.',
              '<repositories>', JSON.stringify(repositoryAccess(this.store, this.directory, agentId, conversationId).map(({ paths, ...access }) => access)), '</repositories>',
              'Repository tools use relative paths. Read before editing and use the returned revision. Only this chat’s own repository project is writable. If outside a project, ask to move using request_repository_edit, then finish the run. Never use workspace, terminal or MCP paths to bypass membership. Git mutations and network actions require explicit user authorization.'].join('\n')
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
          onRateLimits: rateLimits => {
            job.emit({ requestId: run.id, text: '', rateLimits })
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
            if (completedQuestionTools.has(tool.id)) return
            const message = initialize().message
            const index = message.tools!.findIndex(item => item.id === tool.id)
            if (index < 0) message.tools!.push(tool)
            else message.tools![index] = tool
            persist()
            job.emit({ requestId: run.id, text: '', tool })
          },
          askQuestion: async questions => {
            const message = initialize().message
            let pending: NonNullable<AgentMessage['questions']>[number] | undefined
            this.publish(job, 'question')
            try {
              const result = await this.questions.ask(run.id, questions, signal, question => {
                if (question) {
                  run.question = question
                  pending = { ...question, status: 'pending' }
                  ;(message.questions ??= []).push(pending)
                } else {
                  delete run.question
                  if (pending?.status === 'pending') pending.status = signal.aborted ? 'interrupted' : 'withdrawn'
                }
                persist(); this.publish(job); this.publishMessages(job)
              })
              if (result.answers || result.rejected) {
                pending!.status = result.rejected ? 'rejected' : 'answered'
                if (result.answers) pending!.answers = result.answers
                for (const tool of message.tools ?? []) if (tool.name === 'ask_user' && tool.status === 'running') {
                  tool.status = 'complete'; tool.output = JSON.stringify(result).slice(0, 4000); completedQuestionTools.add(tool.id)
                }
                persist(); this.publishMessages(job)
              }
              if (result.answers) {
                message.status = 'complete'; message.interrupted = false; persist()
                this.store.saveMessage(conversationId, { id: randomUUID(), role: 'user', runId: run.id, questionId: result.id,
                  delivery: 'processed', content: questions.map((question, index) => `${question.title}\n${result.answers![index] || '[No answer provided]'}`).join('\n\n') })
                turn!.message = { id: randomUUID(), runId: run.id, role: 'assistant', content: '', status: 'running', tools: [],
                  model: run.model, connectionId: run.connectionId, effort: run.effort }
                persist(); this.publishMessages(job)
              }
              return result
            } finally { if (!signal.aborted) this.publish(job, 'tools') }
          },
          approve: async (kind, title, detail) => {
            initialize()
            this.publish(job, 'approval')
            try {
              return await this.approvals.ask({ requestId: run.id, agentId, kind, title, detail }, signal,
                approval => { if (approval) this.authorization.noteApproval(run.id, approval.id); job.emit({ requestId: run.id, text: '', approval }) })
            } finally { if (!signal.aborted) this.publish(job, 'tools') }
          }
        })
        state = result.state
        context.save()
        signal.throwIfAborted()
        // Closing optional transports is asynchronous. Messages accepted during
        // that boundary still belong to this run and must precede finalization.
      } while (this.store.runs.pending(run).length)
      await settleRepository()
      this.store.saver.db.transaction(() => {
        this.store.saveModelState(conversationId, sessionKey(connection), state!)
        this.store.finish(conversationId, turn!.message, 'complete')
        run.endedAt = Date.now()
        this.publish(job, 'complete')
      })()
      try { context.commitSummary(turn!.message) } catch { /* A changed source makes a derived summary unavailable; never fail completed work. */ }
      this.publishMessages(job)
      return { stopped: false }
    } catch (error) {
      await this.previews.stopRun(run.id).catch(() => {}) // durable preview record retains cleanup failures for review
      await settleRepository()
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
      if (error instanceof ModelAccessError) throw error
      throw new Error(safe)
    } finally { this.authorization.end(run.id); releaseProject?.() }
  }

  close() {
    if (this.active || this.jobs.size || this.previews.hasActive()) throw new Error('Stop the agent before closing the runtime.')
    this.store.close()
  }
}
