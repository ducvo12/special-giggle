import { basename, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { lstat, realpath, rm } from 'node:fs/promises'
import type { AgentStore } from '../agents/store.ts'
import type { RepositoryReport } from '../../shared/repository.ts'
import { compareTrees, scanPaths, scanTree, type TreeState } from './changes.ts'
import { RepositoryPaths } from './paths.ts'
import { processGroup, settleProcess, type ProcessRecord } from './process.ts'

export interface RepositoryRecord {
  runId: string
  agentId: string
  conversationId: string
  projectId: string
  root: string
  internalRoot?: string
  baseline: TreeState
  touched: string[]
  report: RepositoryReport
  pending?: { kind: 'file' | 'command'; process?: ProcessRecord; external?: boolean; workspace?: string }
}

export class RepositoryStore {
  private store: AgentStore
  readonly privateRoot: string
  constructor(store: AgentStore, privateRoot: string) {
    this.store = store; this.privateRoot = privateRoot
    store.saver.db.exec('CREATE TABLE IF NOT EXISTS repository_runs (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS repository_project ON repository_runs(projectId)')
  }
  records(): RepositoryRecord[] {
    return (this.store.saver.db.prepare('SELECT data FROM repository_runs ORDER BY rowid').all() as { data: string }[]).map(row => JSON.parse(row.data))
  }
  save(record: RepositoryRecord) {
    this.store.saver.db.prepare('INSERT INTO repository_runs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(record.runId, record.projectId, JSON.stringify(record))
  }
  removeRecords(agentId: string, conversationId?: string) {
    const records = this.records().filter(record => record.agentId === agentId && (!conversationId || record.conversationId === conversationId))
    if (records.some(record => record.report.state !== 'settled')) throw new Error('Review unresolved repository outcomes before deleting their recovery records.')
    for (const record of records) this.store.saver.db.prepare('DELETE FROM repository_runs WHERE id = ?').run(record.runId)
  }
  reports(agentId: string, conversationId: string) {
    this.store.get(agentId, conversationId)
    return this.records().filter(record => record.agentId === agentId && record.conversationId === conversationId).map(record => record.report)
  }
  assertAvailable(projectId: string) {
    const project = this.store.saver.db.prepare('SELECT repositoryPath FROM projects WHERE id = ?').get(projectId) as { repositoryPath: string | null } | undefined
    if (this.records().some(record => record.report.state === 'attention' && (record.projectId === projectId || Boolean(project?.repositoryPath && record.root === project.repositoryPath)))) {
      throw new Error('This project has an unresolved action outcome. Review its repository changes before starting more work.')
    }
  }
  async refresh(record: RepositoryRecord) {
    const current = await scanPaths(new RepositoryPaths(record.root, this.privateRoot, record.internalRoot), record.touched)
    // Only touched paths are attributed to this run. Existing dirty files which
    // did not change in an operation are not included in the run's diff.
    const selected = new Set(record.touched)
    record.report.changes = await compareTrees(
      Object.fromEntries(Object.entries(record.baseline).filter(([path]) => selected.has(path))),
      Object.fromEntries(Object.entries(current).filter(([path]) => selected.has(path))))
    this.save(record)
    return current
  }
  async recover(record: RepositoryRecord, acknowledge = false) {
    if (record.report.state === 'settled') return
    try {
      if (record.pending?.process) {
        settleProcess(record.pending.process)
        for (let attempt = 0; attempt < 30 && processGroup(record.pending.process).length; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        if (processGroup(record.pending.process).length) throw new Error('Owned command processes are still stopping.')
      }
      if (record.pending?.workspace) {
        const workspace = record.pending.workspace
        if (dirname(workspace) !== await realpath(tmpdir()) || !basename(workspace).startsWith('granite-repository-command-')) throw new Error('Invalid command-copy recovery path.')
        try {
          if ((await lstat(workspace)).isSymbolicLink()) throw new Error('Command-copy recovery path became a symbolic link.')
          await rm(workspace, { recursive: true, force: true })
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      if (record.pending?.kind === 'command' && !record.pending.workspace) {
        const current = await scanTree(new RepositoryPaths(record.root, this.privateRoot, record.internalRoot))
        record.touched = [...new Set([...record.touched, ...Object.keys(record.baseline), ...Object.keys(current)])]
      }
      await this.refresh(record)
      if (record.pending?.external && !acknowledge) throw new Error('A command with network or Git mutation permission was interrupted. Its external outcome needs your review; it has not been replayed.')
      delete record.pending
      record.report.state = 'settled'; delete record.report.error
    } catch (error) {
      record.report.state = 'attention'
      record.report.error = error instanceof Error ? error.message : 'Action outcome unknown — needs attention.'
    }
    this.save(record)
  }
  async recoverAll() {
    for (const record of this.records().filter(record => record.report.state !== 'settled')) await this.recover(record)
  }
  async review(agentId: string, conversationId: string, runId: string, acknowledge: boolean) {
    this.store.get(agentId, conversationId)
    const record = this.records().find(record => record.runId === runId && record.agentId === agentId && record.conversationId === conversationId)
    if (!record) throw new Error('Repository change record not found.')
    if (this.store.runs.list().some(run => run.id === runId && !run.endedAt)) throw new Error('Stop the run before reviewing its outcome.')
    await this.recover(record, acknowledge)
    return record.report
  }
}
