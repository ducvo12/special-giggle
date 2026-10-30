import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, mkdir, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { ContextSession } from '../src/backend/context/session.ts'
import { createToolRegistry } from '../src/backend/harness/tools/registry.ts'
import { defaultHarnessSettings } from '../src/shared/harness.ts'
import { revision } from '../src/backend/context/store.ts'
import { contextBudget, compactionCut } from '../src/backend/context/budget.ts'
import { searchRepository } from '../src/backend/repositories/search.ts'
import { RepositoryPaths } from '../src/backend/repositories/paths.ts'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'granite-context-'))
  const runtime = await AgentRuntime.open(join(directory, 'profile'))
  const agent = await runtime.createAgent('Context fixture')
  const shared = await runtime.createSection(agent.id, 'Shared work', 'shared')
  const closed = await runtime.createSection(agent.id, 'Private work', 'closed')
  const a = await runtime.createConversation(agent.id, { sectionId: shared.id })
  const b = await runtime.createConversation(agent.id, { sectionId: closed.id })
  const root = (await runtime.registry.workspace(agent.id)).root
  function message(chat: string, id: string, content: string, role: 'user' | 'assistant' = 'user') {
    runtime.store.saveMessage(chat, { id, role, content, delivery: 'processed' })
    return `message:${id}`
  }
  return { directory, runtime, agent, shared, closed, a, b, root, message,
    session: (chat = a.id) => new ContextSession(runtime.context, agent.id, chat, new AbortController().signal, () => {}),
    close: async () => { await runtime.stopAll(); runtime.close(); await rm(directory, { recursive: true, force: true }) } }
}

test('FTS backfill and all metadata/read paths isolate agents, Closed sections and temporary sources', async () => {
  const f = await fixture()
  try {
    const { runtime: r, agent } = f
    const publicId = f.message(f.a.id, 'public', 'quartz public fact absent from any summary')
    const privateId = f.message(f.b.id, 'private', 'quartz private secret')
    const temporary = r.store.create(agent.id, { sectionId: f.shared.id }, 'temporary')
    const tempId = f.message(temporary.id, 'temp', 'quartz temporary secret')
    const other = await r.createAgent('Other owner'), otherChat = await r.createConversation(other.id)
    f.message(otherChat.id, 'other', 'quartz other owner secret')
    await writeFile(join(f.root, 'memory.md'), 'Global user memory')
    await writeFile(join(f.root, 'notes', 'public.md'), 'Global note')
    await writeFile(join(f.root, 'sections', f.closed.id, 'notes', 'private.md'), 'Closed note')
    await r.context.sync(agent.id)
    assert.deepEqual(r.context.list(agent.id, f.a.id, {}, 'quartz').sources.map(s => s.id), [publicId])
    assert.deepEqual(r.context.list(agent.id, f.b.id, {}, 'quartz').sources.map(s => s.id), [privateId])
    assert.throws(() => r.context.get(agent.id, f.a.id, privateId), /unavailable/)
    assert.throws(() => r.context.get(agent.id, f.a.id, tempId), /unavailable/)
    assert.throws(() => r.context.get(agent.id, f.b.id, publicId), /unavailable/)
    assert.throws(() => r.context.get(agent.id, f.b.id, `file:${agent.id}:/memory.md`), /unavailable/)
    const session = f.session(f.b.id); await session.refresh()
    const orientation = await session.orientation()
    assert.ok(!orientation.includes('Global user memory') && !orientation.includes('public fact'))
    const registry = await createToolRegistry({ workspace: await r.registry.workspace(agent.id), context: session,
      signal: session.signal, settings: { ...defaultHarnessSettings, terminal: true }, approve: async () => true, onTool: () => {} })
    try {
      const names = registry.definitions.map(tool => tool.name)
      for (const name of ['read_file','grep','glob','ls','terminal','write_file','edit_file','update_memory','propose_identity_change']) assert.ok(!names.includes(name), name)
      for (const name of ['read_context','search_context','list_context','save_note','update_chat_summary']) assert.ok(names.includes(name), name)
      const result = await registry.execute({ id: 'bypass', name: 'read_file', arguments: '{"file_path":"/memory.md"}' })
      assert.equal(result.success, false)
    } finally { await registry.close() }
    await r.shareSection(agent.id, f.closed.id)
    assert.ok(r.context.list(agent.id, f.a.id, {}, 'quartz').sources.some(s => s.id === privateId))
  } finally { await f.close() }
})

test('source-supported memory retains independent confirmations, removes sole evidence and preserves manual edits', async () => {
  const f = await fixture()
  try {
    const r = f.runtime, ids: string[] = [], chats: string[] = []
    for (let i = 0; i < 5; i++) { const chat = await r.createConversation(f.agent.id); chats.push(chat.id); ids.push(f.message(chat.id, `coding-${i}`, 'I like coding.')) }
    await r.context.sync(f.agent.id)
    const memory = () => r.context.get(f.agent.id, f.a.id, `file:${f.agent.id}:/memory.md`)
    await r.context.mutateMemory(f.agent.id, f.a.id, memory().revision, [{ operation: 'upsert', text: 'The user likes coding.', source_ids: ids }], f.session().signal)
    await r.deleteConversation(f.agent.id, chats[0])
    assert.match((await readFile(join(f.root, 'memory.md'))).toString(), /likes coding/)
    assert.equal(r.context.memoryItems(f.agent.id)[0].source_ids.length, 4)
    for (const chat of chats.slice(1)) await r.deleteConversation(f.agent.id, chat)
    assert.doesNotMatch((await readFile(join(f.root, 'memory.md'))).toString(), /likes coding/)
    const source = f.message(f.a.id, 'tea', 'I prefer tea.')
    await r.context.mutateMemory(f.agent.id, f.a.id, memory().revision, [{ operation: 'upsert', text: 'The user prefers tea.', source_ids: [source] }], f.session().signal)
    await writeFile(join(f.root, 'memory.md'), 'Manually confirmed: the user prefers tea.')
    r.store.saver.db.prepare('DELETE FROM messages WHERE id=?').run('tea')
    await r.context.sync(f.agent.id)
    assert.equal(await readFile(join(f.root, 'memory.md'), 'utf8'), 'Manually confirmed: the user prefers tea.')
    await assert.rejects(r.context.mutateMemory(f.agent.id, f.a.id, '0'.repeat(64), [], f.session().signal), /changed/)
    const echo = f.message(f.a.id, 'echo', 'The user likes coding.', 'assistant')
    assert.throws(() => r.context.supports(f.agent.id, f.a.id, [echo], true), /direct user/)
  } finally { await f.close() }
})

test('summary freshness, original source deletion, cache invalidation, and restart indexing use current state', async () => {
  const f = await fixture()
  try {
    const r = f.runtime, id = f.message(f.a.id, 'decision', 'Use SQLite for storage.')
    await r.context.sync(f.agent.id)
    r.context.saveSummary(f.agent.id, f.a.id, 'Storage uses SQLite.', 'decision', null, [id])
    const session = f.session(); await session.refresh(); session.rebuild = false
    session.read(`summary:${f.a.id}`); session.save()
    f.message(f.a.id, 'correction', 'Use lexical retrieval first.')
    await r.context.sync(f.agent.id)
    assert.throws(() => r.context.get(f.agent.id, f.a.id, `summary:${f.a.id}`), /unavailable/)
    await session.refresh(); assert.equal(session.rebuild, true)
    const note = await r.context.saveNote(f.agent.id, f.a.id, 'agent', 'storage.md', 'SQLite guidance', null, [id], session.signal)
    session.read(note.source_id); session.rebuild = false
    r.store.saver.db.prepare('DELETE FROM messages WHERE id=?').run('decision')
    await r.context.sync(f.agent.id); await session.refresh()
    assert.equal(session.rebuild, true)
    assert.equal(r.context.list(f.agent.id, f.a.id, {}, 'SQLite').sources.length, 0)
    await assert.rejects(readFile(join(f.root, 'notes', 'storage.md'), 'utf8'), { code: 'ENOENT' })
    assert.ok(!r.context.list(f.agent.id, f.a.id).sources.some(source => source.id === note.source_id))
  } finally { await f.close() }
})

test('budget counts schemas, reserves headroom and cuts only after paired native tool results', () => {
  const connection = { baseUrl: '', apiKey: '', model: 'unknown', contextWindow: 16000 }
  const plain = contextBudget(connection, defaultHarnessSettings, [], 'policy', [])
  const withTools = contextBudget(connection, defaultHarnessSettings, [], 'policy', [{ name: 'read', description: 'x'.repeat(10000), parameters: {}, permission: 'read', run: async () => '' }])
  assert.equal(plain.inputBudget, 12000); assert.ok(withTools.inputTokens > plain.inputTokens + 3000)
  assert.match(plain.counting, /estimate/)
  const input = [{ role: 'user' }, { role: 'assistant', tool_calls: [{ id: 'a' }, { id: 'b' }] }, { role: 'tool', tool_call_id: 'a' }, { role: 'tool', tool_call_id: 'b' }, { role: 'user' }, { role: 'assistant' }]
  assert.equal(compactionCut(input, 3), 1)
  assert.equal(compactionCut(input, 2), 4)
})

test('packaged ripgrep supports ignores, regex, case, pages, explicit dotfiles and rejects links/cancellation', async () => {
  const f = await fixture()
  try {
    const root = join(f.directory, 'code'); await mkdir(root)
    await writeFile(join(root, '.gitignore'), 'ignored/\nsrc/skip.ts\n')
    await mkdir(join(root, 'ignored')); await writeFile(join(root, 'ignored', 'skip.ts'), 'Alpha')
    await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'skip.ts'), 'Alpha')
    await mkdir(join(root, 'src')); await writeFile(join(root, 'src', 'a.ts'), 'Alpha\nbeta\nalpha\n')
    await writeFile(join(root, 'src', 'skip.ts'), 'Alpha')
    await writeFile(join(root, 'src', '.env.example'), 'PORT=1234')
    await symlink(f.root, join(root, 'src', 'escape'))
    const paths = new RepositoryPaths(await realpath(root), await realpath(join(f.directory, 'profile')))
    const args = { path: '', glob: '**/*', text: 'alpha', case_sensitive: false, limit: 1 }
    const page = await searchRepository(paths, args, f.session().signal)
    assert.equal(page.results[0].path, 'src/a.ts'); assert.equal(page.results[0].line, 1); assert.ok(page.next_cursor)
    const second = await searchRepository(paths, { ...args, cursor: page.next_cursor! }, f.session().signal)
    assert.equal(second.results[0].line, 3)
    const scoped = await searchRepository(paths, { ...args, path: 'src', limit: 50 }, f.session().signal)
    assert.equal(scoped.results.length, 2, 'scoped search honors the repository root ignore file')
    const regex = await searchRepository(paths, { ...args, text: '^b.ta$', regex: true }, f.session().signal)
    assert.equal(regex.results[0].line, 2)
    const hidden = await searchRepository(paths, { path: 'src', glob: '**/*', hidden: true, text: 'PORT', limit: 5 }, f.session().signal)
    assert.equal(hidden.results[0].path, 'src/.env.example')
    const ignored = await searchRepository(paths, { path: 'ignored', glob: '**/*', include_ignored: true, text: 'Alpha', limit: 5 }, f.session().signal)
    assert.equal(ignored.results.length, 1)
    await assert.rejects(searchRepository(paths, { ...args, text: '[', regex: true }, f.session().signal), /regex|parse/i)
    assert.equal((await searchRepository(paths, { ...args, text: '--pre=/not-a-command' }, f.session().signal)).results.length, 0)
    const stopped = new AbortController(); stopped.abort()
    await assert.rejects(searchRepository(paths, args, stopped.signal))
    await writeFile(join(root, 'src', 'a.ts'), 'changed')
    await assert.rejects(searchRepository(paths, { ...args, cursor: page.next_cursor! }, f.session().signal), /stale/)
  } finally { await f.close() }
})


test('reopen is idempotent and recovery indexes visible saved messages without provider state', async () => {
  const f = await fixture()
  try {
    const source = f.message(f.a.id,'reopen-user','A stable quartz fact.')
    f.runtime.store.saveMessage(f.a.id,{id:'recovery-reply',role:'assistant',content:'Interrupted visible reply',status:'running'})
    f.runtime.store.saveModelState(f.a.id,'fixture',[{type:'reasoning',encrypted_content:'never-index-private-reasoning'}])
    await f.runtime.context.sync(f.agent.id)
    const count = () => f.runtime.context.db.prepare('SELECT count(*) AS n FROM context_documents').get() as {n:number}
    const before = count().n
    f.runtime.close()
    f.runtime = await AgentRuntime.open(join(f.directory,'profile'))
    await f.runtime.context.sync(f.agent.id)
    assert.equal(count().n,before+1) // interrupted reply becomes eligible visible text
    assert.equal(f.runtime.context.get(f.agent.id,f.a.id,source).content,'A stable quartz fact.')
    assert.equal(f.runtime.context.list(f.agent.id,f.a.id,{},'never-index-private-reasoning').sources.length,0)
    f.runtime.close();f.runtime=await AgentRuntime.open(join(f.directory,'profile'))
    assert.equal(count().n,before+1)
  } finally { await f.runtime.stopAll();f.runtime.close();await rm(f.directory,{recursive:true,force:true}) }
})

test('duplicate facts merge support and concurrent stale memory updates cannot overwrite a winner', async () => {
  const f = await fixture()
  try {
    const one=f.message(f.a.id,'one-fact','I like coding.'),two=f.message(f.a.id,'two-fact','I like coding too.')
    await f.runtime.context.sync(f.agent.id)
    const memory=()=>f.runtime.context.get(f.agent.id,f.a.id,`file:${f.agent.id}:/memory.md`)
    const update=(expected:string,id:string,text='The user likes coding.')=>f.runtime.context.mutateMemory(f.agent.id,f.a.id,expected,[{operation:'upsert',text,source_ids:[id]}],f.session().signal)
    await update(memory().revision,one)
    await update(memory().revision,two)
    assert.equal(f.runtime.context.memoryItems(f.agent.id).length,1)
    assert.equal(f.runtime.context.memoryItems(f.agent.id)[0].source_ids.length,2)
    const version=memory().revision
    const results=await Promise.allSettled([update(version,one,'First concurrent update'),update(version,two,'Second concurrent update')])
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
    assert.equal(results.filter(result=>result.status==='rejected').length,1)
    f.runtime.context.db.prepare('DELETE FROM messages WHERE id=?').run('one-fact')
    await f.runtime.context.sync(f.agent.id)
    assert.match(memory().content,/The user likes coding/)
  } finally { await f.close() }
})
