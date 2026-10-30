import { createHash } from 'node:crypto'
import type { AgentStore } from '../agents/store.ts'
import type { ContextDocument, ContextFilters, ContextReference } from '../../shared/context.ts'

export const revision = (value: string) => createHash('sha256').update(value).digest('hex')

type Row = { id: string; agentId: string; sectionId: string | null; projectId: string | null;
  conversationId: string | null; kind: ContextDocument['kind']; title: string; content: string;
  revision: string; updatedAt: number; path: string | null; role: string | null }

export class ContextStore {
  readonly agents: AgentStore
  readonly db: AgentStore['saver']['db']

  constructor(agents: AgentStore) {
    this.agents = agents
    this.db = agents.saver.db
    this.db.function('context_hash', { deterministic: true }, (text: unknown) => revision(String(text ?? '')))
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_documents (
        id TEXT PRIMARY KEY, agentId TEXT NOT NULL, sectionId TEXT, projectId TEXT,
        conversationId TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
        revision TEXT NOT NULL, updatedAt INTEGER NOT NULL, path TEXT, role TEXT
      );
      CREATE INDEX IF NOT EXISTS context_owner ON context_documents(agentId, sectionId, conversationId);
      CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(title, content, content='context_documents', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS context_fts_insert AFTER INSERT ON context_documents BEGIN
        INSERT INTO context_fts(rowid,title,content) VALUES(new.rowid,new.title,new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS context_fts_delete AFTER DELETE ON context_documents BEGIN
        INSERT INTO context_fts(context_fts,rowid,title,content) VALUES('delete',old.rowid,old.title,old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS context_fts_update AFTER UPDATE OF title,content ON context_documents BEGIN
        INSERT INTO context_fts(context_fts,rowid,title,content) VALUES('delete',old.rowid,old.title,old.content);
        INSERT INTO context_fts(rowid,title,content) VALUES(new.rowid,new.title,new.content);
      END;
      CREATE TABLE IF NOT EXISTS context_summaries (
        conversationId TEXT PRIMARY KEY, content TEXT NOT NULL, throughId TEXT NOT NULL,
        revision TEXT NOT NULL, sources TEXT NOT NULL, boundary TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS context_items (
        id TEXT PRIMARY KEY, agentId TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL, sources TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS context_state_refs (conversationId TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS context_compactions (conversationId TEXT PRIMARY KEY, summary TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS context_chat_delete AFTER DELETE ON conversations BEGIN
        DELETE FROM context_documents WHERE conversationId=old.id;
        DELETE FROM context_summaries WHERE conversationId=old.id;
        DELETE FROM context_state_refs WHERE conversationId=old.id;
        DELETE FROM context_compactions WHERE conversationId=old.id;
      END;
      CREATE TRIGGER IF NOT EXISTS context_chat_move AFTER UPDATE OF sectionId,projectId,retention ON conversations BEGIN
        UPDATE context_documents SET sectionId=new.sectionId,projectId=new.projectId WHERE conversationId=new.id;
        DELETE FROM context_state_refs WHERE conversationId=new.id;
        DELETE FROM harness_state WHERE conversationId=new.id;
      END;
      CREATE TRIGGER IF NOT EXISTS context_chat_title AFTER UPDATE OF title ON conversations BEGIN
        UPDATE context_documents SET title=new.title WHERE conversationId=new.id;
      END;
      CREATE TRIGGER IF NOT EXISTS context_message_delete AFTER DELETE ON messages BEGIN
        DELETE FROM context_documents WHERE id='message:' || old.id;
        DELETE FROM context_documents WHERE kind='summary' AND conversationId=old.conversationId;
        DELETE FROM context_summaries WHERE conversationId=old.conversationId;
      END;
    `)
    if (!(this.db.pragma('table_info(context_compactions)') as { name: string }[]).some(column => column.name === 'boundary')) this.db.exec("ALTER TABLE context_compactions ADD COLUMN boundary TEXT NOT NULL DEFAULT '{}'")
    // Index only display text. Opaque provider state, raw terminal output and private reasoning never enter FTS.
    const upsert = `INSERT INTO context_documents(id,agentId,sectionId,projectId,conversationId,kind,title,content,revision,updatedAt,role)
      SELECT 'message:' || m.id,c.agentId,c.sectionId,c.projectId,c.id,'message',c.title,
        json_extract(m.data,'$.content'),context_hash(json_extract(m.data,'$.content')),m.createdAt,json_extract(m.data,'$.role')
      FROM messages m JOIN conversations c ON c.id=m.conversationId
      WHERE json_extract(m.data,'$.content') != '' AND json_extract(m.data,'$.role') IN ('user','assistant')
        AND coalesce(json_extract(m.data,'$.delivery'),'processed') NOT IN ('pending','cancelled')
        AND coalesce(json_extract(m.data,'$.status'),'complete') != 'running'`
    for (const event of ['INSERT', 'UPDATE']) {
      this.db.exec(`CREATE TRIGGER IF NOT EXISTS context_message_${event.toLowerCase()} AFTER ${event} ON messages BEGIN
        DELETE FROM context_documents WHERE id='message:' || new.id;
        ${upsert} AND m.id=new.id;
        DELETE FROM context_documents WHERE kind='summary' AND conversationId=new.conversationId
          AND EXISTS(SELECT 1 FROM context_summaries WHERE conversationId=new.conversationId AND boundary != (
            SELECT context_hash(group_concat(id || ':' || context_hash(json_extract(data,'$.content')),'|')) FROM
            (SELECT id,data FROM messages WHERE conversationId=new.conversationId AND json_extract(data,'$.role')='user' AND coalesce(json_extract(data,'$.delivery'),'processed')='processed' ORDER BY createdAt,rowid)));
      END;`)
    }
    this.db.exec(`${upsert} ON CONFLICT(id) DO UPDATE SET content=excluded.content,revision=excluded.revision,title=excluded.title;`)
  }

  scope(agentId: string, chatId: string) {
    const chat = this.agents.get(agentId, chatId)
    const section = this.agents.organization.section(agentId, chat.sectionId)
    return { chat, section }
  }

  private eligible(agentId: string, chatId: string, filters: ContextFilters = {}) {
    const { chat, section } = this.scope(agentId, chatId)
    const parts = ['d.agentId=?'], values: unknown[] = [agentId]
    parts.push(`(d.conversationId IS NULL OR EXISTS(SELECT 1 FROM conversations c WHERE c.id=d.conversationId AND
      (c.retention='permanent' OR c.id=?)))`)
    values.push(chatId)
    if (section.mode === 'closed') {
      parts.push('d.sectionId=?')
      values.push(section.id)
    } else {
      parts.push("(d.sectionId IS NULL OR EXISTS(SELECT 1 FROM sections s WHERE s.id=d.sectionId AND s.mode='shared'))")
    }
    for (const [field, value] of [['sectionId', filters.section_id], ['projectId', filters.project_id], ['kind', filters.kind]]) {
      if (value !== undefined) { parts.push(`d.${field}=?`); values.push(value) }
    }
    return { clause: parts.join(' AND '), values, chat }
  }

  reference(row: Row): ContextReference {
    return { id: row.id, kind: row.kind, title: row.title, revision: row.revision,
      ...(row.conversationId ? { conversationId: row.conversationId } : {}),
      ...(row.id.startsWith('message:') ? { messageId: row.id.slice(8) } : {}),
      ...(row.path ? { path: row.path } : {}), ...(row.sectionId ? { sectionId: row.sectionId } : {}), projectId: row.projectId }
  }

  get(agentId: string, chatId: string, id: string): ContextDocument {
    const scope = this.eligible(agentId, chatId)
    const row = this.db.prepare(`SELECT d.* FROM context_documents d WHERE ${scope.clause} AND d.id=?`).get(...scope.values, id) as Row | undefined
    if (!row) throw new Error('Context source is unavailable in this chat.')
    return { ...this.reference(row), agentId: row.agentId, content: row.content, updatedAt: row.updatedAt, role: row.role ?? undefined }
  }

  list(agentId: string, chatId: string, filters: ContextFilters = {}, query?: string) {
    const scope = this.eligible(agentId, chatId, filters)
    const limit = Math.min(50, Math.max(1, filters.limit ?? 15))
    const epoch = revision(JSON.stringify(this.db.prepare(`SELECT d.id,d.revision,d.title,d.sectionId,d.projectId FROM context_documents d WHERE ${scope.clause} ORDER BY d.id`).all(...scope.values)))
    let offset = 0
    if (filters.cursor) {
      let cursor: any
      try { cursor = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString()) } catch {}
      const key = revision(JSON.stringify([agentId, chatId, filters.section_id, filters.project_id, filters.kind, query, epoch]))
      if (!cursor || cursor.key !== key || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error('Invalid context cursor.')
      offset = cursor.offset
    }
    const words = query?.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 16)
    if (query !== undefined && !words?.length) return { sources: [], next_cursor: null }
    // Do not use corpus-wide BM25 statistics: disallowed sections must not affect exposed scores/counts.
    const match = words?.map(word => `"${word.replaceAll('"', '""')}"`).join(' OR ')
    const from = match ? 'context_fts JOIN context_documents d ON d.rowid=context_fts.rowid' : 'context_documents d'
    const rows = this.db.prepare(`SELECT d.*${match ? ",snippet(context_fts,1,'','',' … ',48) AS excerpt" : ''}
      FROM ${from} WHERE ${scope.clause}${match ? ' AND context_fts MATCH ?' : ''}
      ORDER BY d.sectionId=? DESC,d.kind='summary' DESC,d.updatedAt DESC,d.id LIMIT ? OFFSET ?`)
      .all(...scope.values, ...(match ? [match] : []), scope.chat.sectionId, limit + 1, offset) as (Row & { excerpt?: string })[]
    const more = rows.length > limit
    return {
      sources: rows.slice(0, limit).map(row => ({ ...this.reference(row), ...(match ? { excerpt: row.excerpt?.slice(0, 1600) } : {}) })),
      next_cursor: more ? Buffer.from(JSON.stringify({ offset: offset + limit,
        key: revision(JSON.stringify([agentId, chatId, filters.section_id, filters.project_id, filters.kind, query, epoch])) })).toString('base64url') : null
    }
  }

  putFile(agentId: string, path: string, content: string, sectionId: string | null) {
    const id = `file:${agentId}:${path}`
    this.db.prepare(`INSERT INTO context_documents(id,agentId,sectionId,projectId,conversationId,kind,title,content,revision,updatedAt,path)
      VALUES(?,?,?,NULL,NULL,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,revision=excluded.revision,updatedAt=excluded.updatedAt
      WHERE context_documents.revision != excluded.revision`)
      .run(id, agentId, sectionId, path === '/memory.md' ? 'memory' : 'note', path, content, revision(content), Date.now(), path)
    return id
  }

  boundary(chatId: string) {
    const rows = this.db.prepare("SELECT id,data FROM messages WHERE conversationId=? AND json_extract(data,'$.role')='user' AND coalesce(json_extract(data,'$.delivery'),'processed')='processed' ORDER BY createdAt,rowid").all(chatId) as { id: string; data: string }[]
    return revision(rows.map(row => `${row.id}:${revision(JSON.parse(row.data).content)}`).join('|'))
  }
}
