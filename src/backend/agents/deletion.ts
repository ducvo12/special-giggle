import { lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentStore } from './store.ts'
import { validAgentId } from './registry.ts'
import type { AgentDeletionIssue, AgentDeletionResult } from '../../shared/agent.ts'

function exists(path: string) {
  try { return lstatSync(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export class AgentDeletions {
  readonly blocked = new Set<string>()
  readonly issues: AgentDeletionIssue[] = []
  private root: string
  private directory: string
  private store: AgentStore

  constructor(directory: string, store: AgentStore) {
    this.directory = directory
    this.store = store
    this.root = join(directory, 'agent-deletions')
    store.saver.db.exec('CREATE TABLE IF NOT EXISTS agent_deletions (agentId TEXT PRIMARY KEY)')
  }

  private paths(id: string) {
    if (!validAgentId.test(id)) throw new Error('Invalid agent ID in deletion recovery.')
    return { live: join(this.directory, 'agents', id), staged: join(this.root, id) }
  }

  private checkRoot() {
    const info = exists(this.root)
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error('Agent deletion storage must be a local directory.')
    }
    return info
  }

  assertAvailable(id: string) {
    if (this.blocked.has(id)) throw new Error('This agent is unavailable until its deletion recovery conflict is resolved.')
  }

  private issue(id: string, error: unknown) {
    this.blocked.add(id)
    this.issues.push({ agentId: id, stagedPath: join(this.root, id), message: error instanceof Error ? error.message : 'Agent deletion recovery needs attention.' })
  }

  purge(id: string) {
    this.checkRoot()
    const { staged } = this.paths(id)
    const info = exists(staged)
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Staged agent must be a local directory.')
    if (info) rmSync(staged, { recursive: true })
    this.store.saver.db.prepare('DELETE FROM agent_deletions WHERE agentId=?').run(id)
  }

  recover() {
    const committed = new Set((this.store.saver.db.prepare('SELECT agentId FROM agent_deletions').all() as { agentId: string }[]).map(row => row.agentId))
    let entries: string[]
    try {
      entries = this.checkRoot() ? readdirSync(this.root) : []
    } catch (error) {
      for (const id of committed) this.issue(id, error)
      if (!committed.size) this.issue('', error)
      return
    }
    for (const id of new Set([...entries, ...committed])) {
      try {
        const { live, staged } = this.paths(id)
        const info = exists(staged)
        if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Staged agent must be a local directory.')
        if ((info || committed.has(id)) && exists(live)) throw new Error('A live agent folder conflicts with staged or committed deletion. Existing folders were preserved; resolve the conflict before using this agent.')
        if (committed.has(id)) this.purge(id)
        else if (info) renameSync(staged, live)
      } catch (error) {
        this.issue(id, error)
      }
    }
  }

  delete(id: string, commit: () => void): AgentDeletionResult {
    this.checkRoot()
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    const { live, staged } = this.paths(id)
    if (exists(staged)) throw new Error('This agent already has staged deletion data requiring recovery.')
    renameSync(live, staged)
    try {
      this.store.saver.db.transaction(() => {
        commit()
        this.store.saver.db.prepare('INSERT INTO agent_deletions VALUES (?)').run(id)
      })()
    } catch (error) {
      try {
        if (exists(live)) throw new Error('Cannot restore staged agent over an existing folder.')
        renameSync(staged, live)
      } catch (restoreError) {
        this.issue(id, restoreError)
        throw new AggregateError([error, restoreError], 'Deletion failed and the staged agent could not be restored. Its data was preserved for recovery.')
      }
      throw error
    }
    try {
      this.purge(id)
      return { cleanupPending: false }
    } catch (error) {
      this.issue(id, new Error(`Agent deleted; file cleanup pending. ${error instanceof Error ? error.message : 'Cleanup failed.'}`))
      return { cleanupPending: true }
    }
  }
}
