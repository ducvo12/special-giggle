import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentStore } from '../agents/store.ts'
import type { ContextDocument, ContextFilters, ContextReference } from '../../shared/context.ts'
import { ContextStore, revision } from './store.ts'
import { textFile, publishText, locked } from './files.ts'

type Support = { id: string; revision: string }
type Managed = { id: string; agentId: string; path: string; body: string; sources: string }

export class ContextService extends ContextStore {
  readonly directory: string

  constructor(agents: AgentStore, directory: string) {
    super(agents)
    this.directory = directory
  }

  root(agentId: string) { return join(this.directory, 'agents', agentId) }

  private supportAllowed(agentId: string, path: string, id: string) {
    const row = this.db.prepare('SELECT * FROM context_documents WHERE id=? AND agentId=?').get(id, agentId) as ContextDocument | undefined
    if (!row) return false
    const sectionId = path.startsWith('/sections/') ? path.split('/')[2] : null
    let targetMode: 'shared' | 'closed'
    try { targetMode = sectionId ? this.agents.organization.section(agentId, sectionId).mode : 'shared' } catch { return false }
    if (row.conversationId) {
      const chat = this.agents.get(agentId, row.conversationId)
      if (chat.retention !== 'permanent') return false
    }
    return targetMode === 'closed' ? row.sectionId === sectionId : !row.sectionId || this.agents.organization.section(agentId, row.sectionId).mode === 'shared'
  }

  async cleanManaged(agentId: string) {
    const rows = this.db.prepare('SELECT * FROM context_items WHERE agentId=?').all(agentId) as Managed[]
    for (let row of rows) await locked(`${agentId}:${row.path}`, async () => {
      const current = this.db.prepare('SELECT * FROM context_items WHERE id=? AND agentId=?').get(row.id, agentId) as Managed | undefined
      if (!current) return
      row = current
      const currentText = await textFile(this.root(agentId), row.path)
      if (currentText === null || !currentText.includes(row.body)) {
        // Human replacement becomes an independent assertion, not a cached agent echo.
        this.db.prepare('DELETE FROM context_items WHERE id=?').run(row.id)
        return
      }
      const sources = JSON.parse(row.sources) as Support[]
      const remaining = sources.filter(source => {
        const current = this.db.prepare('SELECT revision FROM context_documents WHERE id=?').get(source.id) as { revision: string } | undefined
        return current?.revision === source.revision && this.supportAllowed(agentId, row.path, source.id)
      })
      const valid = row.path === '/memory.md' ? remaining.length > 0 : remaining.length === sources.length && sources.length > 0
      if (valid) {
        if (remaining.length !== sources.length) this.db.prepare('UPDATE context_items SET sources=? WHERE id=?').run(JSON.stringify(remaining), row.id)
        return
      }
      const content = await textFile(this.root(agentId), row.path)
      // Ownership is exact and unique. Never erase a human-edited or ambiguous span by fuzzy matching.
      if (content !== null && content.includes(row.body) && content.indexOf(row.body) === content.lastIndexOf(row.body)) {
        if (row.path !== '/memory.md' && content === row.body) {
          // A generated note's filename can itself encode the deleted claim.
          // Remove the unchanged owned file, rather than indexing an empty title.
          if (await textFile(this.root(agentId), row.path) !== content) return
          await unlink(join(this.root(agentId), row.path))
          this.db.prepare('DELETE FROM context_documents WHERE agentId=? AND path=?').run(agentId, row.path)
        } else await publishText(this.root(agentId), row.path, content.replace(row.body, ''), revision(content))
      }
      this.db.prepare('DELETE FROM context_items WHERE id=?').run(row.id)
    })
  }

  async sync(agentId: string) {
    // Serialize scanning/publication across this agent's concurrent runs, without holding a SQL transaction across I/O.
    await locked(`sync:${agentId}`, async () => {
      const organization = this.agents.organization.snapshot(agentId)
      const root = this.root(agentId)
      const seen = new Set<string>()
      const inspect = async (path: string, sectionId: string | null) => {
        const content = await locked(`${agentId}:${path}`, () => textFile(root, path))
        if (content !== null) seen.add(this.putFile(agentId, path, content, sectionId))
      }
      const notes = async (path: string, sectionId: string | null) => {
        // Check the directory itself before traversal, including every parent component.
        const { AgentFilesystem } = await import('../workspace/filesystem.ts')
        await new AgentFilesystem(root).check(path)
        let entries
        try { entries = await readdir(join(root, path), { withFileTypes: true }) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue
          const file = `${path}/${entry.name}`
          if (entry.isDirectory()) await notes(file, sectionId)
          else if (entry.isFile() && entry.name.endsWith('.md')) await inspect(file, sectionId)
        }
      }
      await inspect('/memory.md', null)
      await notes('/notes', null)
      for (const section of organization.sections) await notes(`/sections/${section.id}/notes`, section.id)
      for (const row of this.db.prepare("SELECT id FROM context_documents WHERE agentId=? AND kind IN ('memory','note')").all(agentId) as { id: string }[]) {
        if (!seen.has(row.id)) this.db.prepare('DELETE FROM context_documents WHERE id=?').run(row.id)
      }
      await this.cleanManaged(agentId)
      // Cleanup may have edited the human-facing files; publish their current views before returning.
      await inspect('/memory.md', null)
      await notes('/notes', null)
      for (const section of organization.sections) await notes(`/sections/${section.id}/notes`, section.id)
      this.refreshSummaries(agentId)
    })
  }

  private refreshSummaries(agentId: string) {
    const rows = this.db.prepare('SELECT s.* FROM context_summaries s JOIN conversations c ON c.id=s.conversationId WHERE c.agentId=?')
      .all(agentId) as { conversationId: string; content: string; revision: string; sources: string; boundary: string }[]
    for (const row of rows) {
      let valid = row.boundary === this.boundary(row.conversationId)
      try {
        for (const source of JSON.parse(row.sources) as Support[]) {
          if (this.get(agentId, row.conversationId, source.id).revision !== source.revision) valid = false
        }
      } catch { valid = false }
      if (!valid) this.db.prepare("DELETE FROM context_documents WHERE id=?").run(`summary:${row.conversationId}`)
    }
  }

  supports(agentId: string, chatId: string, ids: string[], userFacts = false, visited = new Set<string>()): Support[] {
    if (!ids.length) throw new Error('Provide supporting source IDs, available through context reads or current message IDs.')
    const result = new Map<string, Support>()
    for (const id of ids) {
      if (visited.has(id)) throw new Error('Circular or derived-only memory support is not allowed.')
      const doc = this.get(agentId, chatId, id)
      if (doc.conversationId && this.agents.get(agentId, doc.conversationId).retention === 'temporary') throw new Error('Temporary chats cannot support durable saved content.')
      if (userFacts && doc.kind === 'message' && doc.role !== 'user') throw new Error('User memory needs direct user assertions, not assistant echoes or cached summaries.')
      if (doc.kind === 'summary') {
        const summary = this.db.prepare('SELECT sources FROM context_summaries WHERE conversationId=?').get(doc.conversationId!) as { sources: string }
        for (const source of this.supports(agentId, chatId, (JSON.parse(summary.sources) as Support[]).map(item => item.id), userFacts, new Set([...visited, id]))) result.set(source.id, source)
      } else if (doc.path) {
        if (doc.kind === 'memory') throw new Error('Memory cannot independently support itself. Use original user messages.')
        const managed = this.db.prepare('SELECT sources FROM context_items WHERE agentId=? AND path=?').all(agentId, doc.path) as { sources: string }[]
        if (managed.length) {
          for (const row of managed) for (const source of this.supports(agentId, chatId, (JSON.parse(row.sources) as Support[]).map(item => item.id), userFacts, new Set([...visited, id]))) result.set(source.id, source)
        } else result.set(id, { id, revision: doc.revision })
      } else result.set(id, { id, revision: doc.revision })
    }
    return [...result.values()]
  }

  async mutateMemory(agentId: string, chatId: string, expected: string, changes: { id?: string; operation: 'upsert' | 'remove'; text?: string; source_ids?: string[] }[], signal: AbortSignal) {
    const { chat, section } = this.scope(agentId, chatId)
    if (chat.retention !== 'permanent' || section.mode !== 'shared') throw new Error('Agent user memory is unavailable for writes in this chat.')
    return locked(`${agentId}:/memory.md`, async () => {
      const root = this.root(agentId), path = '/memory.md'
      const before = await textFile(root, path)
      if (before === null || revision(before) !== expected) throw new Error('Memory changed. Read its current revision before updating.')
      let content = before
      const used = new Set<string>()
      const updates: { id: string; body: string; sources: Support[] }[] = [], removed: string[] = []
      for (const change of changes) {
        let old = change.id ? this.db.prepare("SELECT * FROM context_items WHERE id=? AND agentId=? AND path='/memory.md'").get(change.id, agentId) as Managed | undefined : undefined
        if (old && used.has(old.id)) throw new Error('Update each memory item only once in a batch.')
        if (old) used.add(old.id)
        if (change.id && !old) throw new Error('Memory item is unavailable. Read current memory first.')
        if (old && (!content.includes(old.body) || content.indexOf(old.body) !== content.lastIndexOf(old.body))) throw new Error('The saved fact was manually edited; inspect current memory rather than overwriting it.')
        if (old) { content = content.replace(old.body, ''); removed.push(old.id) }
        if (change.operation === 'upsert') {
          if (!change.text?.trim()) throw new Error('Provide the confirmed user fact.')
          const body = `- ${change.text.trim().replaceAll('\n', ' ')}\n`
          let sources = this.supports(agentId, chatId, change.source_ids ?? [], true)
          const duplicate = this.db.prepare("SELECT * FROM context_items WHERE agentId=? AND path='/memory.md' AND body=?").get(agentId, body) as Managed | undefined
          if (duplicate && (!old || old.id === duplicate.id)) {
            if (!old) { old = duplicate; if (used.has(old.id)) throw new Error('Duplicate fact in this batch.'); used.add(old.id); content = content.replace(old.body, ''); removed.push(old.id) }
            sources = [...new Map([...(JSON.parse(duplicate.sources) as Support[]), ...sources].map(source => [source.id, source])).values()]
          }
          content = content.trimEnd() + '\n\n' + body
          updates.push({ id: old?.id ?? randomUUID(), body, sources })
        }
      }
      const next = await publishText(root, path, content, expected, signal)
      this.db.transaction(() => {
        for (const id of removed) this.db.prepare('DELETE FROM context_items WHERE id=?').run(id)
        for (const item of updates) this.db.prepare('INSERT OR REPLACE INTO context_items VALUES(?,?,?,?,?)').run(item.id, agentId, path, item.body, JSON.stringify(item.sources))
        this.putFile(agentId, path, content, null)
      })()
      return { revision: next, items: updates.map(item => ({ id: item.id, source_ids: item.sources.map(source => source.id) })) }
    })
  }

  notePath(agentId: string, chatId: string, scope: 'agent' | 'section', name: string) {
    const { chat, section } = this.scope(agentId, chatId)
    if (chat.retention !== 'permanent' || scope === 'agent' && section.mode !== 'shared') throw new Error('This note scope is not writable in this chat.')
    if (!/^[\p{L}\p{N}_ -][\p{L}\p{N}_. /-]{0,180}\.md$/u.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Use a descriptive relative Markdown note name without traversal.')
    return scope === 'agent' ? `/notes/${name}` : `/sections/${section.id}/notes/${name}`
  }

  async saveNote(agentId: string, chatId: string, scope: 'agent' | 'section', name: string, content: string, expected: string | null, ids: string[], signal: AbortSignal) {
    const path = this.notePath(agentId, chatId, scope, name)
    const sources = this.supports(agentId, chatId, ids)
    return locked(`${agentId}:${path}`, async () => {
      const next = await publishText(this.root(agentId), path, content, expected, signal)
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM context_items WHERE agentId=? AND path=?').run(agentId, path)
        this.db.prepare('INSERT INTO context_items VALUES(?,?,?,?,?)').run(randomUUID(), agentId, path, content, JSON.stringify(sources))
        this.putFile(agentId, path, content, scope === 'section' ? this.scope(agentId, chatId).section.id : null)
      })()
      return { source_id: `file:${agentId}:${path}`, path, revision: next }
    })
  }

  validateSummary(agentId: string, chatId: string, summary: string, throughId: string, expected: string | null, ids: string[]) {
    const chat = this.agents.get(agentId, chatId)
    if (chat.retention !== 'permanent') throw new Error('Temporary chats cannot publish shared summaries.')
    const through = chat.messages.find(message => message.id === throughId && message.role === 'user' && message.delivery !== 'pending')
    if (!through || chat.messages.filter(message => message.role === 'user' && message.delivery !== 'pending' && message.delivery !== 'cancelled').at(-1)?.id !== throughId) throw new Error('Summary must cover the latest processed user message; read current context first.')
    const old = this.db.prepare('SELECT revision FROM context_summaries WHERE conversationId=?').get(chatId) as { revision: string } | undefined
    if ((old?.revision ?? null) !== expected) throw new Error('Summary changed; read its current revision.')
    const sources = this.supports(agentId, chatId, ids)
    return { chat, sources, hash: revision(summary), boundary: this.boundary(chatId) }
  }

  saveSummary(agentId: string, chatId: string, summary: string, throughId: string, expected: string | null, ids: string[]) {
    const { chat, sources, hash, boundary } = this.validateSummary(agentId, chatId, summary, throughId, expected, ids)
    this.db.transaction(() => {
      this.db.prepare('INSERT OR REPLACE INTO context_summaries VALUES(?,?,?,?,?,?)').run(chatId, summary, throughId, hash, JSON.stringify(sources), boundary)
      this.db.prepare(`INSERT INTO context_documents(id,agentId,sectionId,projectId,conversationId,kind,title,content,revision,updatedAt)
        VALUES(?,?,?,?,?,'summary',?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,revision=excluded.revision,updatedAt=excluded.updatedAt`).run(`summary:${chatId}`, agentId, chat.sectionId, chat.projectId, chatId, chat.title, summary, hash, Date.now())
    })()
    return { source_id: `summary:${chatId}`, revision: hash }
  }

  async identity(agentId: string, chatId: string, content: string, expected: string, signal: AbortSignal) {
    const { chat, section } = this.scope(agentId, chatId)
    if (chat.retention !== 'permanent' || section.mode !== 'shared') throw new Error('Identity changes are unavailable in this chat.')
    return locked(`${agentId}:/identity.md`, async () => ({ revision: await publishText(this.root(agentId), '/identity.md', content, expected, signal), activates: 'next run' }))
  }

  memoryItems(agentId: string) {
    return (this.db.prepare("SELECT * FROM context_items WHERE agentId=? AND path='/memory.md'").all(agentId) as Managed[])
      .map(row => ({ id: row.id, text: row.body.trim(), source_ids: (JSON.parse(row.sources) as Support[]).map(source => source.id) }))
  }
}
