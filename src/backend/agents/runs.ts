import { randomUUID, createHash } from 'node:crypto'
import type { AgentStore } from './store.ts'
import type { AgentMessage } from '../../shared/agent.ts'
import type { Connection } from '../../shared/chat.ts'
import { isLiveRun, type RecoveryNotice, type RunSnapshot } from '../../shared/run.ts'

export function sessionKey(connection: Connection) {
  return createHash('sha256').update(JSON.stringify([
    connection.connectionId ?? '', connection.provider ?? 'openai',
    connection.protocol ?? 'chat-completions', connection.baseUrl.replace(/\/+$/, ''),
    connection.accountId ?? '', connection.model
  ])).digest('hex')
}

// Only public run metadata is durable. Credentials and provider request bodies
// never enter these tables; a restarted job resolves its saved connection anew.
export class RunStore {
  private store: AgentStore

  constructor(store: AgentStore) {
    this.store = store
    store.saver.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS run_conversation ON runs(conversationId);
      CREATE TABLE IF NOT EXISTS chat_sessions (conversationId TEXT PRIMARY KEY, binding TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime_notices (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    `)
  }

  list(): RunSnapshot[] {
    return (this.store.saver.db.prepare('SELECT data FROM runs ORDER BY rowid').all() as { data: string }[])
      .map(row => JSON.parse(row.data))
  }

  save(run: RunSnapshot) {
    this.store.saver.db.prepare('INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(run.id, run.conversationId, JSON.stringify(run))
  }

  bind(agentId: string, conversationId: string, connection: Connection) {
    const detail = this.store.get(agentId, conversationId)
    const old = detail.messages.find(message => message.model)
    if (old && (old.model !== connection.model || old.connectionId && old.connectionId !== connection.connectionId)) {
      throw new Error('The model is fixed for this conversation. Start a new chat to choose another model.')
    }
    const binding = sessionKey(connection)
    const saved = this.store.saver.db.prepare('SELECT binding FROM chat_sessions WHERE conversationId = ?')
      .get(conversationId) as { binding: string } | undefined
    if (saved && saved.binding !== binding) {
      throw new Error('The model and provider are fixed for this conversation. Restore its connection or start a new chat.')
    }
    this.store.saver.db.prepare('INSERT OR IGNORE INTO chat_sessions VALUES (?, ?)').run(conversationId, binding)
  }

  accept(run: RunSnapshot, text: string, existing: AgentMessage[] = []) {
    this.store.saver.db.transaction(() => {
      if (existing.length) {
        for (const message of existing) {
          this.store.saveMessage(run.conversationId, { ...message, runId: run.id, delivery: 'pending' })
          run.messageIds.push(message.id)
        }
      } else {
        this.append(run, text)
      }
      this.save(run)
    })()
  }

  append(run: RunSnapshot, text: string) {
    const message: AgentMessage = {
      id: randomUUID(), role: 'user', content: text, runId: run.id, delivery: 'pending',
      model: run.model, connectionId: run.connectionId, effort: run.effort
    }
    this.store.saver.db.transaction(() => {
      const detail = this.store.get(run.agentId, run.conversationId)
      if (!detail.messages.length && detail.title === 'New conversation') {
        this.store.saver.db.prepare('UPDATE conversations SET title = ? WHERE id = ?')
          .run(text.slice(0, 64), run.conversationId)
      }
      this.store.saveMessage(run.conversationId, message)
      run.messageIds.push(message.id)
      this.save(run)
    })()
    return message
  }

  pending(run: RunSnapshot) {
    return this.store.get(run.agentId, run.conversationId).messages
      .filter(message => message.runId === run.id && message.delivery === 'pending')
  }

  consume(run: RunSnapshot, messages: AgentMessage[]) {
    this.store.saver.db.transaction(() => {
      for (const message of messages) this.store.saveMessage(run.conversationId, { ...message, delivery: 'processed' })
    })()
  }

  cancelPending(agentId: string, conversationId: string) {
    this.store.saver.db.transaction(() => {
      for (const message of this.store.get(agentId, conversationId).messages) {
        if (message.delivery === 'pending') this.store.saveMessage(conversationId, { ...message, delivery: 'cancelled' })
      }
      for (const run of this.list().filter(run => run.conversationId === conversationId && run.phase === 'not_started')) {
        this.save({ ...run, phase: 'stopped', endedAt: Date.now(), error: undefined })
      }
    })()
  }

  recover(interruptedReplies: number) {
    const notice: RecoveryNotice = { active: 0, pending: 0 }
    this.store.saver.db.transaction(() => {
      for (const run of this.list().filter(isLiveRun)) {
        if (run.startedAt === null) {
          run.phase = 'not_started'
          run.error = 'Not started — Granite restarted. Run pending messages when you are ready.'
          notice.pending++
        } else {
          run.phase = 'interrupted'
          run.error = 'Granite closed before this run finished. Completed changes are kept.'
          notice.active++
        }
        run.endedAt = Date.now()
        delete run.queue
        delete run.question
        this.save(run)
      }
      // AgentStore already marks old running replies interrupted, including
      // databases created before durable runs existed.
      notice.active = Math.max(notice.active, interruptedReplies)
      if (notice.active || notice.pending) {
        this.store.saver.db.prepare("INSERT OR REPLACE INTO runtime_notices VALUES ('recovery', ?)").run(JSON.stringify(notice))
      }
    })()
  }

  recovery(): RecoveryNotice {
    const row = this.store.saver.db.prepare("SELECT data FROM runtime_notices WHERE id = 'recovery'")
      .get() as { data: string } | undefined
    return row ? JSON.parse(row.data) : { active: 0, pending: 0 }
  }

  dismissRecovery() {
    this.store.saver.db.prepare("DELETE FROM runtime_notices WHERE id = 'recovery'").run()
  }
}
