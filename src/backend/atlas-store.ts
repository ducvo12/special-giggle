import { randomUUID } from 'node:crypto'
import { chmodSync } from 'node:fs'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import type { AgentMessage, Conversation, ConversationDetail, RunStatus, ToolActivity } from '../shared/agent.ts'

export class AtlasStore {
  saver: SqliteSaver
  constructor(path: string) {
    this.saver = SqliteSaver.fromConnString(path)
    chmodSync(path, 0o600)
    this.saver.db.pragma('journal_mode = WAL')
    this.saver.db.exec(`CREATE TABLE IF NOT EXISTS atlas_conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, updatedAt INTEGER NOT NULL, graphId TEXT NOT NULL, recover INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS atlas_messages (id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, createdAt INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS atlas_message_conversation ON atlas_messages(conversationId, createdAt);`)
    // A process exit cannot tell us whether a pending file write completed. Keep
    // the old checkpoint, mark the UI turn interrupted, and never replay it.
    const rows = this.saver.db.prepare('SELECT * FROM atlas_messages').all() as { id: string; conversationId: string; data: string }[]
    for (const row of rows) {
      const message = JSON.parse(row.data) as AgentMessage
      if (message.status !== 'running') continue
      message.status = 'interrupted'; message.interrupted = true
      message.tools = message.tools?.map(tool => tool.status === 'running' ? { ...tool, status: 'interrupted' } : tool)
      this.saveMessage(row.conversationId, message)
      this.saver.db.prepare('UPDATE atlas_conversations SET recover = 1 WHERE id = ?').run(row.conversationId)
    }
  }
  list(): Conversation[] { return this.saver.db.prepare('SELECT id, title, updatedAt FROM atlas_conversations ORDER BY updatedAt DESC').all() as Conversation[] }
  create(): ConversationDetail {
    const conversation = { id: randomUUID(), title: 'New conversation', updatedAt: Date.now() }
    this.saver.db.prepare('INSERT INTO atlas_conversations VALUES (?, ?, ?, ?, 0)').run(conversation.id, conversation.title, conversation.updatedAt, randomUUID())
    return { ...conversation, messages: [] }
  }
  get(id: string): ConversationDetail {
    const row = this.saver.db.prepare('SELECT id, title, updatedAt FROM atlas_conversations WHERE id = ?').get(id) as Conversation | undefined
    if (!row) throw new Error('Conversation not found.')
    const rows = this.saver.db.prepare('SELECT data FROM atlas_messages WHERE conversationId = ? ORDER BY createdAt, rowid').all(id) as { data: string }[]
    return { ...row, messages: rows.map(row => JSON.parse(row.data) as AgentMessage) }
  }
  saveMessage(conversationId: string, message: AgentMessage) {
    this.saver.db.prepare('INSERT INTO atlas_messages VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(message.id, conversationId, Date.now(), JSON.stringify(message))
    this.saver.db.prepare('UPDATE atlas_conversations SET updatedAt = ? WHERE id = ?').run(Date.now(), conversationId)
  }
  begin(conversationId: string, text: string, model: string) {
    const detail = this.get(conversationId)
    if (detail.messages.length >= 200) throw new Error('This conversation is full. Start a new conversation.')
    const row = this.saver.db.prepare('SELECT graphId, recover FROM atlas_conversations WHERE id = ?').get(conversationId) as { graphId: string; recover: number }
    const graphId = row.recover ? randomUUID() : row.graphId
    const message: AgentMessage = { id: randomUUID(), role: 'assistant', content: '', model, status: 'running', tools: [] }
    this.saver.db.transaction(() => {
      if (!detail.messages.length) this.saver.db.prepare('UPDATE atlas_conversations SET title = ? WHERE id = ?').run(text.slice(0, 64), conversationId)
      this.saver.db.prepare('UPDATE atlas_conversations SET graphId = ?, recover = 0 WHERE id = ?').run(graphId, conversationId)
      this.saveMessage(conversationId, { id: randomUUID(), role: 'user', content: text })
      this.saveMessage(conversationId, message)
    })()
    return { message, graphId, recovered: Boolean(row.recover), history: detail.messages }
  }
  finish(id: string, message: AgentMessage, status: RunStatus) {
    message.status = status; message.interrupted = status !== 'complete'
    message.tools = message.tools?.map((tool: ToolActivity) => tool.status === 'running' ? { ...tool, status: 'interrupted' } : tool)
    this.saver.db.transaction(() => {
      this.saveMessage(id, message)
      if (status !== 'complete') this.saver.db.prepare('UPDATE atlas_conversations SET recover = 1 WHERE id = ?').run(id)
    })()
  }
  close() { this.saver.db.close() }
}
