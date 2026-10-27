import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentStore } from '../agents/store.ts'
import type { PreviewSnapshot } from '../../shared/setup.ts'
import type { RepositoryRecord } from './store.ts'
import { RepositoryPaths } from './paths.ts'
import { scanTree, type TreeState } from './changes.ts'
import { copyCommandWorkspace } from './command-workspace.ts'
import { startRepositoryProcess, processGroup, settleProcess, type ProcessRecord } from './process.ts'

type PreviewRecord = { snapshot: PreviewSnapshot; root: string; internalRoot?: string; acknowledged?: boolean; workspace?: string; home?: string; process?: ProcessRecord }
type ActivePreview = { record: PreviewRecord; controller: AbortController; task: Promise<void>; handle?: Awaited<ReturnType<typeof startRepositoryProcess>>; watcher?: Promise<void> }
const live = (preview: PreviewSnapshot) => ['starting','ready'].includes(preview.status)
const revision = (tree: TreeState) => createHash('sha256').update(JSON.stringify(Object.keys(tree).sort().map(path => [path, tree[path].hash, tree[path].mode]))).digest('hex')

export class PreviewManager {
  private starts = new Map<string, { controller: AbortController; task: Promise<PreviewSnapshot>; runId: string }>()
  private active = new Map<string, ActivePreview>()
  private store: AgentStore
  private privateRoot: string
  constructor(store: AgentStore, privateRoot: string) {
    this.store = store; this.privateRoot = privateRoot
    store.saver.db.exec('CREATE TABLE IF NOT EXISTS repository_previews (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
  }
  private records(): PreviewRecord[] { return (this.store.saver.db.prepare('SELECT data FROM repository_previews ORDER BY rowid').all() as {data:string}[]).map(row => JSON.parse(row.data)) }
  private save(record: PreviewRecord) { this.store.saver.db.prepare('INSERT INTO repository_previews VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(record.snapshot.id, JSON.stringify(record)) }
  list(agentId: string, conversationId: string) {
    this.store.get(agentId, conversationId)
    return this.records().filter(record => record.snapshot.agentId === agentId && record.snapshot.conversationId === conversationId).map(record => record.snapshot)
  }
  private owned(agentId: string, conversationId: string, id: string, requireProject = true) {
    const record = this.records().find(record => record.snapshot.id === id && record.snapshot.agentId === agentId && record.snapshot.conversationId === conversationId)
    if (!record) throw new Error('Preview is unavailable in this chat.')
    const chat = this.store.get(agentId, conversationId)
    const project = this.store.organization.project(agentId, record.snapshot.projectId)
    if (requireProject && (chat.projectId !== project.id || chat.retention !== 'permanent' || project.repositoryPath !== record.root)) throw new Error('Preview no longer belongs to this repository chat.')
    return record
  }
  start(source: RepositoryRecord, command: string, cwd: string, requestedPort: number, signal: AbortSignal) {
    const key = `${source.agentId}:${source.conversationId}`
    if (this.starts.has(key)) throw new Error('A preview is already being prepared for this chat.')
    const controller = new AbortController()
    const task = this.prepare(source, command, cwd, requestedPort, AbortSignal.any([signal, controller.signal])).finally(() => this.starts.delete(key))
    this.starts.set(key, { controller, task, runId: source.runId })
    return task
  }
  private async prepare(source: RepositoryRecord, command: string, cwd: string, requestedPort: number, signal: AbortSignal) {
    signal.throwIfAborted()
    if (source.report.state === 'attention') throw new Error('Review the unresolved repository outcome before starting a preview.')
    if (!Number.isInteger(requestedPort) || requestedPort !== 0 && (requestedPort < 1024 || requestedPort > 65535)) throw new Error('Choose a local preview port from 1024 to 65535, or zero for automatic.')
    await this.stopExisting(source.agentId, source.conversationId)
    const paths = new RepositoryPaths(source.root, this.privateRoot, source.internalRoot)
    await paths.check(cwd)
    const probe = createServer()
    await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(requestedPort, '127.0.0.1', () => resolve()) })
    const port = (probe.address() as {port:number}).port
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
    signal.throwIfAborted()
    const snapshot: PreviewSnapshot = { id: randomUUID(), agentId: source.agentId, conversationId: source.conversationId, projectId: source.projectId, runId: source.runId,
      command, cwd, port, url: `http://127.0.0.1:${port}`, status: 'starting', revision: '', capturedAt: Date.now(), stale: false, output: '' }
    const record: PreviewRecord = { snapshot, root: source.root, internalRoot: source.internalRoot }
    const entry: ActivePreview = { record, controller: new AbortController(), task: Promise.resolve() }
    this.active.set(snapshot.id, entry); this.save(record)
    const combined = AbortSignal.any([signal, entry.controller.signal])
    entry.task = this.execute(entry, paths, combined)
    void entry.task.catch(() => {})
    await Promise.race([entry.task, delay(500, undefined, { signal }).catch(() => {})])
    return { ...record.snapshot }
  }
  private async execute(entry: ActivePreview, paths: RepositoryPaths, signal: AbortSignal) {
    const { record } = entry, state = record.snapshot
    let lastOutputSave = 0
    try {
      const before = await scanTree(paths, signal, false)
      state.revision = revision(before)
      record.workspace = await realpath(await mkdtemp(join(tmpdir(), 'granite-repository-command-'))); this.save(record)
      const root = join(record.workspace, 'repository')
      await copyCommandWorkspace(paths.root, root, true, signal)
      if (revision(await scanTree(paths, signal, false)) !== state.revision || revision(await scanTree(new RepositoryPaths(root, this.privateRoot), signal, false, true)) !== state.revision) throw new Error('Repository changed while preparing the preview. Restart from current code.')
      record.home = await realpath(await mkdtemp(join(tmpdir(), 'granite-preview-environment-'))); this.save(record)
      entry.handle = await startRepositoryProcess({ root, container: record.workspace, privateRoot: this.privateRoot, cwd: join(root, state.cwd),
        executable: '/bin/sh', args: ['-c', state.command], writable: true, network: false, loopbackPort: state.port, previewEnvironment: { PORT: String(state.port), HOST: '127.0.0.1', HOSTNAME: '127.0.0.1' },
        home: record.home, interactive: false, signal,
        onStart: process => { record.process = { ...process }; this.save(record) },
        onOutput: () => { state.output = entry.handle?.output.tail() ?? state.output; if (Date.now() - lastOutputSave > 150) { this.save(record); lastOutputSave = Date.now() } } })
      await entry.handle.ready
      entry.watcher = this.watch(entry, signal)
      const result = await entry.handle.done
      state.output = entry.handle.output.tail()
      if (!signal.aborted) { state.status = 'failed'; state.error = `Preview exited with code ${result.exitCode ?? 'unknown'}. Inspect its output before restarting.` }
    } catch (error) {
      state.status = signal.aborted ? 'stopped' : 'failed'
      if (!signal.aborted) state.error = error instanceof Error ? error.message : 'Preview failed.'
    } finally {
      entry.controller.abort()
      await entry.watcher?.catch(() => {})
      if (state.status === 'starting' || state.status === 'ready') state.status = 'stopped'
      try {
        if (entry.handle?.settlementError()) throw new Error(entry.handle.settlementError())
        if (record.process) settleProcess(record.process)
        await this.cleanup(record)
      } catch (error) { state.error = error instanceof Error ? error.message : 'Preview cleanup needs review.'; state.status = 'failed' }
      this.save(record); this.active.delete(state.id)
    }
  }
  private async watch(entry: ActivePreview, signal: AbortSignal) {
    while (!signal.aborted) {
      const state = entry.record.snapshot
      try {
        const response = await fetch(state.url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) })
        await response.body?.cancel()
        if (response.status >= 200 && response.status < 400 && entry.record.process && !signal.aborted) {
          // A pre-existing or racing listener must not masquerade as this app.
          const listeners = execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${state.port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' }).split('\n').filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1)))
          const owned = new Set(processGroup(entry.record.process).map(process => process.pid))
          if (listeners.length && listeners.every(pid => owned.has(pid))) { state.status = 'ready'; this.save(entry.record); return }
        }
      } catch { /* Not ready yet; readiness probes are bounded, process lifetime is not. */ }
      await delay(500, undefined, { signal }).catch(() => {})
    }
  }
  async read(agentId: string, conversationId: string, id: string, waitMs = 0) {
    this.owned(agentId, conversationId, id)
    const entry = this.active.get(id)
    if (entry && waitMs) await Promise.race([entry.task, delay(waitMs)])
    const record = this.owned(agentId, conversationId, id)
    if (live(record.snapshot) && record.snapshot.revision) {
      record.snapshot.stale = revision(await scanTree(new RepositoryPaths(record.root, this.privateRoot, record.internalRoot), undefined, false)) !== record.snapshot.revision
      if (entry) { entry.record.snapshot.stale = record.snapshot.stale; this.save(entry.record) } else this.save(record)
    }
    return record.snapshot
  }
  async stop(agentId: string, conversationId: string, id: string) {
    const record = this.owned(agentId, conversationId, id, false), entry = this.active.get(id)
    if (entry) { entry.controller.abort(); entry.handle?.stop(); await entry.task }
    else if (live(record.snapshot) || record.process || record.workspace || record.home) {
      try { await this.settle(record); await this.cleanup(record); record.snapshot.status = 'stopped'; delete record.snapshot.error; this.save(record) }
      catch (error) { record.snapshot.status = 'failed'; record.snapshot.error = error instanceof Error ? error.message : 'Preview cleanup needs review.'; this.save(record); throw error }
    }
    return this.owned(agentId, conversationId, id, false).snapshot
  }
  async refreshProject(projectId: string) {
    for (const record of this.records().filter(record => record.snapshot.projectId === projectId && live(record.snapshot))) {
      await this.read(record.snapshot.agentId, record.snapshot.conversationId, record.snapshot.id)
    }
  }
  async restart(agentId: string, conversationId: string, id: string, signal: AbortSignal) {
    const record = this.owned(agentId, conversationId, id)
    return this.start({ runId: record.snapshot.runId, agentId, conversationId, projectId: record.snapshot.projectId, root: record.root, internalRoot: record.internalRoot,
      baseline: {}, touched: [], report: { runId: record.snapshot.runId, projectId: record.snapshot.projectId, name: 'Preview', state: 'settled', changes: [], preExisting: 0 } }, record.snapshot.command, record.snapshot.cwd, record.snapshot.port, signal)
  }
  async stopChat(agentId: string, conversationId: string) {
    const starting = this.starts.get(`${agentId}:${conversationId}`)
    starting?.controller.abort(); await starting?.task.catch(() => {})
    await this.stopExisting(agentId, conversationId)
  }
  private async stopExisting(agentId: string, conversationId: string) { for (const record of this.list(agentId, conversationId)) await this.stop(agentId, conversationId, record.id) }
  async stopAgent(agentId: string) {
    const starts = [...this.starts.entries()].filter(([key]) => key.startsWith(`${agentId}:`)).map(([,value]) => value)
    for (const start of starts) start.controller.abort()
    await Promise.allSettled(starts.map(start => start.task))
    for (const record of this.records().filter(record => record.snapshot.agentId === agentId)) await this.stop(agentId, record.snapshot.conversationId, record.snapshot.id) }
  async stopAll() {
    const starts = [...this.starts.values()]
    for (const start of starts) start.controller.abort()
    await Promise.allSettled(starts.map(start => start.task))
    const results = await Promise.allSettled(this.records().map(record => this.stop(record.snapshot.agentId, record.snapshot.conversationId, record.snapshot.id)))
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
  async stopRun(runId: string) {
    const starts = [...this.starts.values()].filter(start => start.runId === runId)
    for (const start of starts) start.controller.abort()
    await Promise.allSettled(starts.map(start => start.task))
    for (const record of this.records().filter(record => record.snapshot.runId === runId)) await this.stop(record.snapshot.agentId, record.snapshot.conversationId, record.snapshot.id) }
  unfinished(runId: string) { return this.records().some(record => record.snapshot.runId === runId && record.snapshot.status === 'starting') }
  private async cleanup(record: PreviewRecord) {
    for (const [key, prefix] of [['workspace','granite-repository-command-'],['home','granite-preview-environment-']] as const) {
      const path = record[key]
      if (!path) continue
      if (dirname(path) !== await realpath(tmpdir()) || !basename(path).startsWith(prefix) || (await lstat(path).catch(() => null))?.isSymbolicLink()) throw new Error('Invalid preview cleanup path; review required.')
      await rm(path, { recursive: true, force: true }); delete record[key]
    }
    delete record.process
  }
  private async settle(record: PreviewRecord) {
    if (!record.process) return
    let failure: unknown
    for (let attempt = 0; attempt < 30; attempt++) {
      try { settleProcess(record.process); if (!processGroup(record.process).length) return }
      catch (error) { failure = error }
      // Parent-liveness cleanup can be in flight during startup. Never kill an
      // unidentified PID; give already-dying groups a chance to disappear.
      await delay(50)
    }
    throw failure ?? new Error('Preview processes are still stopping. Review required.')
  }
  async recover() {
    for (const record of this.records()) if (live(record.snapshot) || record.process || record.workspace || record.home) {
      try { await this.settle(record); await this.cleanup(record); record.snapshot.status = 'interrupted'; record.acknowledged = false; record.snapshot.error = 'Granite closed. Restart this preview explicitly from current code.' }
      catch (error) { record.snapshot.status = 'failed'; record.snapshot.error = error instanceof Error ? error.message : 'Preview recovery needs review.' }
      this.save(record)
    }
  }
  remove(agentId: string, conversationId?: string) {
    const records = this.records().filter(record => record.snapshot.agentId === agentId && (!conversationId || record.snapshot.conversationId === conversationId))
    if (records.some(record => record.process || record.workspace || record.home)) throw new Error('Stop and review remaining preview processes before deleting their records.')
    for (const record of records) this.store.saver.db.prepare('DELETE FROM repository_previews WHERE id = ?').run(record.snapshot.id)
  }
  dismissRecovery() { for (const record of this.records().filter(record => record.snapshot.status === 'interrupted')) { record.acknowledged = true; this.save(record) } }
  interruptedCount() { return this.records().filter(record => record.snapshot.status === 'interrupted' && !record.acknowledged || record.snapshot.status === 'failed' && (record.process || record.workspace || record.home)).length }
  hasActive() { return this.active.size > 0 || this.starts.size > 0 }
}
