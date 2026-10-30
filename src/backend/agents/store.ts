import { createHash, randomUUID } from 'node:crypto'
import { chmodSync } from 'node:fs'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import type {
  AgentMessage,
  Conversation,
  ConversationDetail,
  RunStatus,
  ToolActivity
} from '../../shared/agent.ts'
import type { NativeItem } from '../harness/types.ts'
import { OrganizationStore } from './organization.ts'
import type { ChatRetention, ConversationLocation } from '../../shared/organization.ts'
import { RunStore } from './runs.ts'

export class AgentStore {
  saver: SqliteSaver
  organization: OrganizationStore
  runs: RunStore

  constructor(path: string) {
    this.saver = SqliteSaver.fromConnString(path)
    this.saver.db.function('context_hash', { deterministic: true }, (value: unknown) => createHash('sha256').update(String(value ?? '')).digest('hex'))
    chmodSync(path, 0o600)
    this.saver.db.pragma('journal_mode = WAL')
    this.saver.db.transaction(() => {
      const legacy = this.saver.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'atlas_conversations'"
        )
        .get()

      if (legacy) {
        this.saver.db.exec(
          'ALTER TABLE atlas_conversations RENAME TO conversations; ALTER TABLE atlas_messages RENAME TO messages;'
        )
      }
    })()
    this.saver.db
      .exec(`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, updatedAt INTEGER NOT NULL, graphId TEXT NOT NULL, recover INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, createdAt INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversationId, createdAt);`)
    this.saver.db.exec(
      'CREATE TABLE IF NOT EXISTS harness_state (conversationId TEXT PRIMARY KEY, modelKey TEXT NOT NULL, data TEXT NOT NULL)'
    )
    const columns = this.saver.db.pragma('table_info(conversations)') as { name: string }[]

    if (!columns.some(column => column.name === 'agentId')) {
      this.saver.db.exec(
        "ALTER TABLE conversations ADD COLUMN agentId TEXT NOT NULL DEFAULT 'atlas'"
      )
    }

    if (!columns.some(column => column.name === 'engine')) {
      this.saver.db.exec(
        "ALTER TABLE conversations ADD COLUMN engine TEXT NOT NULL DEFAULT 'openai'"
      )
    }

    if (!columns.some(column => column.name === 'createdAt')) {
      // Legacy records have no exact creation time. Their earliest saved message
      // is the best available estimate; empty records fall back to updatedAt.
      this.saver.db.transaction(() => this.saver.db.exec(`ALTER TABLE conversations ADD COLUMN createdAt INTEGER NOT NULL DEFAULT 0;
        UPDATE conversations SET createdAt = COALESCE(
          (SELECT MIN(createdAt) FROM messages WHERE conversationId = conversations.id), updatedAt);`))()
    }

    this.saver.db.exec(
      'CREATE INDEX IF NOT EXISTS conversation_agent ON conversations(agentId, updatedAt)'
    )
    this.organization = new OrganizationStore(this.saver.db)

    // Recovery starts a new graph without discarding the previous checkpoint.
    // Track every graph so deleting its conversation removes the entire history.
    this.saver.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_threads (
        graphId TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS thread_conversation ON conversation_threads(conversationId);
      INSERT OR IGNORE INTO conversation_threads (graphId, conversationId)
        SELECT graphId, id FROM conversations;
    `)

    // A process exit cannot tell us whether a pending file write completed. Keep
    // the old checkpoint, mark the UI turn interrupted, and never replay it.
    const rows = this.saver.db.prepare('SELECT * FROM messages').all() as {
      id: string
      conversationId: string
      data: string
    }[]

    let interruptedReplies = 0
    for (const row of rows) {
      const message = JSON.parse(row.data) as AgentMessage

      if (message.status !== 'running') {
        continue
      }

      message.status = 'interrupted'
      for (const question of message.questions ?? []) if (question.status === 'pending') question.status = 'interrupted'
      interruptedReplies++
      message.interrupted = true
      message.tools = message.tools?.map(tool =>
        tool.status === 'running' ? { ...tool, status: 'interrupted' } : tool
      )
      this.saveMessage(row.conversationId, message)
      this.saver.db
        .prepare('UPDATE conversations SET recover = 1 WHERE id = ?')
        .run(row.conversationId)
    }
    this.runs = new RunStore(this)
    this.runs.recover(interruptedReplies)
  }

  list(agentId: string): Conversation[] {
    return this.saver.db
      .prepare(
        `SELECT id, agentId, title, updatedAt, createdAt, sectionId, projectId, retention, expiresAt,
          (SELECT MAX(createdAt) FROM messages WHERE conversationId = conversations.id) AS lastChattedAt
          FROM conversations WHERE agentId = ? ORDER BY updatedAt DESC, rowid DESC`
      )
      .all(agentId) as Conversation[]
  }

  create(agentId: string, location?: Partial<ConversationLocation>, retention: ChatRetention = 'permanent'): ConversationDetail {
    if (retention !== 'permanent' && retention !== 'temporary') throw new Error('Invalid chat retention.')
    const conversation = {
      id: randomUUID(),
      agentId,
      title: 'New conversation',
      updatedAt: Date.now(),
      createdAt: Date.now(),
      lastChattedAt: null,
      ...this.organization.location(agentId, location, retention),
      retention,
      expiresAt: null
    }
    const graphId = randomUUID()

    this.saver.db.transaction(() => {
      this.saver.db
        .prepare(
          'INSERT INTO conversations (id, title, updatedAt, createdAt, graphId, recover, agentId, sectionId, projectId, retention) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)'
        )
        .run(conversation.id, conversation.title, conversation.updatedAt, conversation.createdAt, graphId, agentId, conversation.sectionId, conversation.projectId, retention)
      this.saver.db
        .prepare('INSERT INTO conversation_threads (graphId, conversationId) VALUES (?, ?)')
        .run(graphId, conversation.id)
    })()

    return { ...conversation, messages: [] }
  }

  get(agentId: string, id: string): ConversationDetail {
    const row = this.saver.db
      .prepare(
        `SELECT id, agentId, title, updatedAt, createdAt, sectionId, projectId, retention, expiresAt,
          (SELECT MAX(createdAt) FROM messages WHERE conversationId = conversations.id) AS lastChattedAt
          FROM conversations WHERE id = ? AND agentId = ?`
      )
      .get(id, agentId) as Conversation | undefined

    if (!row) {
      throw new Error('Conversation not found.')
    }

    const rows = this.saver.db
      .prepare('SELECT data FROM messages WHERE conversationId = ? ORDER BY createdAt, rowid')
      .all(id) as { data: string }[]

    return { ...row, messages: rows.map(row => JSON.parse(row.data) as AgentMessage) }
  }

  saveResponseDuration(agentId: string, conversationId: string, messageId: string, durationMs: number) {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
      throw new Error('Invalid response duration.')
    }
    const message = this.get(agentId, conversationId).messages.find(item => item.id === messageId)
    if (!message || message.role !== 'assistant' || message.status !== 'complete') {
      throw new Error('Completed response not found.')
    }
    if (message.responseDurationMs !== undefined) return
    // Update only the message metadata; timing must not reorder conversations.
    this.saver.db.prepare('UPDATE messages SET data = ? WHERE id = ? AND conversationId = ?')
      .run(JSON.stringify({ ...message, responseDurationMs: durationMs }), messageId, conversationId)
  }

  saveMessage(conversationId: string, message: AgentMessage) {
    this.saver.db
      .prepare(
        'INSERT INTO messages VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
      )
      .run(message.id, conversationId, Date.now(), JSON.stringify(message))
    this.saver.db
      .prepare('UPDATE conversations SET updatedAt = ? WHERE id = ?')
      .run(Date.now(), conversationId)
  }

  begin(agentId: string, conversationId: string, text: string, model: string, engine = 'openai', accepted?: AgentMessage[], runId?: string) {
    const detail = this.get(agentId, conversationId)

    const row = this.saver.db
      .prepare('SELECT graphId, recover, engine FROM conversations WHERE id = ?')
      .get(conversationId) as { graphId: string; recover: number; engine: string }
    const recovered = Boolean(row.recover) || row.engine !== engine
    const graphId = recovered ? randomUUID() : row.graphId
    const message: AgentMessage = {
      id: runId ?? randomUUID(),
      ...(runId ? { runId } : {}),
      role: 'assistant',
      content: '',
      model,
      status: 'running',
      tools: []
    }
    this.saver.db.transaction(() => {
      if (!detail.messages.length && detail.title === 'New conversation') {
        this.saver.db
          .prepare('UPDATE conversations SET title = ? WHERE id = ?')
          .run(text.slice(0, 64), conversationId)
      }

      this.saver.db
        .prepare('UPDATE conversations SET graphId = ?, recover = 0, engine = ? WHERE id = ?')
        .run(graphId, engine, conversationId)
      this.saver.db
        .prepare(
          'INSERT OR IGNORE INTO conversation_threads (graphId, conversationId) VALUES (?, ?)'
        )
        .run(graphId, conversationId)
      if (!accepted) this.saveMessage(conversationId, { id: randomUUID(), role: 'user', content: text })
      this.saveMessage(conversationId, message)
    })()

    return {
      message,
      graphId,
      recovered,
      interrupted: Boolean(row.recover),
      history: detail.messages.filter(message => !accepted?.some(item => item.id === message.id) &&
        message.delivery !== 'pending' && message.delivery !== 'cancelled')
    }
  }

  finish(id: string, message: AgentMessage, status: RunStatus) {
    message.status = status
    message.interrupted = status !== 'complete'
    message.tools = message.tools?.map((tool: ToolActivity) =>
      tool.status === 'running' ? { ...tool, status: 'interrupted' } : tool
    )
    this.saver.db.transaction(() => {
      this.saveMessage(id, message)

      if (status !== 'complete') {
        this.saver.db.prepare('UPDATE conversations SET recover = 1 WHERE id = ?').run(id)
      }
    })()
  }

  close() {
    this.saver.db.close()
  }

  modelState(conversationId: string, modelKey: string): NativeItem[] | undefined {
    const row = this.saver.db
      .prepare('SELECT data FROM harness_state WHERE conversationId = ? AND modelKey = ?')
      .get(conversationId, modelKey) as { data: string } | undefined

    return row ? JSON.parse(row.data) : undefined
  }

  saveModelState(conversationId: string, modelKey: string, state: NativeItem[]) {
    this.saver.db
      .prepare(
        'INSERT INTO harness_state VALUES (?, ?, ?) ON CONFLICT(conversationId) DO UPDATE SET modelKey = excluded.modelKey, data = excluded.data'
      )
      .run(conversationId, modelKey, JSON.stringify(state))
  }

  renameConversation(agentId: string, id: string, title: string) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) {
      throw new Error('Chat names must contain between 1 and 200 characters.')
    }
    this.get(agentId, id)
    this.saver.db.prepare('UPDATE conversations SET title = ? WHERE id = ? AND agentId = ?')
      .run(title.trim(), id, agentId)
  }

  deleteConversation(agentId: string, id: string) {
    this.saver.db.transaction(() => {
      this.get(agentId, id)
      const tables = this.saver.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('checkpoints', 'writes')")
        .all() as { name: string }[]

      for (const { name } of tables) {
        this.saver.db.prepare(`DELETE FROM ${name} WHERE thread_id IN (
          SELECT graphId FROM conversation_threads WHERE conversationId = ?
        )`).run(id)
      }

      this.saver.db.prepare('DELETE FROM harness_state WHERE conversationId = ?').run(id)
      this.saver.db.prepare('DELETE FROM runs WHERE conversationId = ?').run(id)
      this.saver.db.prepare('DELETE FROM chat_sessions WHERE conversationId = ?').run(id)
      this.saver.db.prepare('DELETE FROM messages WHERE conversationId = ?').run(id)
      this.saver.db.prepare('DELETE FROM conversation_threads WHERE conversationId = ?').run(id)
      this.saver.db.prepare('DELETE FROM conversations WHERE id = ? AND agentId = ?').run(id, agentId)
    })()
  }

  deleteAgent(agentId: string) {
    this.saver.db.transaction(() => {
      for (const table of ['runs', 'chat_sessions']) {
        this.saver.db.prepare(`DELETE FROM ${table} WHERE conversationId IN (SELECT id FROM conversations WHERE agentId = ?)`).run(agentId)
      }
      this.saver.db
        .prepare(
          'DELETE FROM harness_state WHERE conversationId IN (SELECT id FROM conversations WHERE agentId = ?)'
        )
        .run(agentId)
      // The SDK creates checkpoint tables lazily, after the first model run.
      const tables = this.saver.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('checkpoints', 'writes')"
        )
        .all() as { name: string }[]

      for (const { name } of tables) {
        this.saver.db
          .prepare(
            `
          DELETE FROM ${name} WHERE thread_id IN (
            SELECT graphId FROM conversation_threads
            WHERE conversationId IN (SELECT id FROM conversations WHERE agentId = ?)
          )
        `
          )
          .run(agentId)
      }

      this.saver.db
        .prepare(
          `
        DELETE FROM messages
        WHERE conversationId IN (SELECT id FROM conversations WHERE agentId = ?)
      `
        )
        .run(agentId)
      this.saver.db
        .prepare(
          `
        DELETE FROM conversation_threads
        WHERE conversationId IN (SELECT id FROM conversations WHERE agentId = ?)
      `
        )
        .run(agentId)
      this.saver.db.prepare('DELETE FROM conversations WHERE agentId = ?').run(agentId)
      this.saver.db.prepare('DELETE FROM projects WHERE agentId = ?').run(agentId)
      this.saver.db.prepare('DELETE FROM sections WHERE agentId = ?').run(agentId)
    })()
  }
}
