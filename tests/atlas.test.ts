import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AtlasRuntime } from '../src/backend/atlas-runtime.ts'
import type { StreamDelta } from '../src/shared/chat.ts'

test('workspace contains file tools, rejects traversal and links, and protects identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-boundary-'))
  const atlas = await AtlasRuntime.open(dir)
  try {
    assert.match(await atlas.read('/identity.md'), /Atlas/)
    assert.ok((await atlas.entries('/')).some(file => file.path === '/notes/'))
    await atlas.workspace.write('/notes/hello.md', 'inside')
    await writeFile(join(dir, 'outside.md'), 'outside-secret')
    await symlink(dir, join(atlas.workspace.root, 'escape'))
    await symlink(join(atlas.workspace.root, 'identity.md'), join(atlas.workspace.root, 'alias.md'))
    for (const path of ['/../outside.md', '/escape/outside.md', '/alias.md']) await assert.rejects(atlas.read(path))
    for (const path of ['/identity.md', '/IDENTITY.md', '/alias.md', '/escape/new.md', '/../new.md']) await assert.rejects(atlas.workspace.write(path, 'no'))
    await assert.rejects(atlas.workspace.edit('/identity.md', 'Atlas', 'Other'))
    await assert.rejects(atlas.workspace.delete('/identity.md'))
    await assert.rejects(atlas.workspace.uploadFiles([['/identity.md', new Uint8Array()]]))
    await assert.rejects(atlas.workspace.glob('../**'))
    const search = await atlas.workspace.grep('outside-secret')
    assert.equal(search.matches?.length ?? 0, 0)
    assert.ok(!(await atlas.entries('/')).some(file => /escape|alias/.test(file.path)))
  } finally { atlas.close(); await rm(dir, { recursive: true, force: true }) }
})

test('real Deep Agents tool loop persists files, memory, checkpoints, Stop, and restart recovery', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-runtime-'))
  const requests: any[] = []
  let slowStarted: (() => void) | undefined
  let disconnected = false
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); requests.push(body)
    const user = body.messages.findLast((m: any) => m.role === 'user')?.content
    const last = body.messages.at(-1)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    function chunk(delta: unknown, finish_reason: string | null = null) { res.write(`data: ${JSON.stringify({ id: 'chat-mock', object: 'chat.completion.chunk', model: 'mock', choices: [{ index: 0, delta, finish_reason }] })}\n\n`) }
    function done(text: string) { chunk({ role: 'assistant', content: text }); chunk({}, 'stop'); res.end('data: [DONE]\n\n') }
    if (user === 'Limit') { chunk({ role: 'assistant', content: 'Partial bounded output' }); chunk({}, 'length'); res.end('data: [DONE]\n\n'); return }
    if (user === 'Reason only') { chunk({ role: 'assistant', reasoning_content: 'private-reasoning-test' }); chunk({}, 'stop'); res.end('data: [DONE]\n\n'); return }
    if (user === 'Provider error') { res.end('data: '+JSON.stringify({error:{message:'sensitive-provider-test-key'}})+'\n\n'); return }
    if (user === 'Slow' || (user === 'Write then slow' && last.role === 'tool')) {
      chunk({ role: 'assistant', content: 'Partial reply' })
      const timer = setInterval(() => chunk({ content: '...' }), 50)
      res.on('close', () => { clearInterval(timer); disconnected = true }); return
    }
    const call = (name: string, args: unknown) => { chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + requests.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); chunk({}, 'tool_calls'); res.end('data: [DONE]\n\n') }
    if (last.role !== 'tool') {
      if (user === 'Write then slow') return call('write_file', { file_path: '/notes/keep-after-stop.md', content: 'This completed write must survive Stop.' })
      if (user === 'List notes') return call('ls', { path: '/notes/' })
      if (user === 'Find note') return call('glob', { pattern: '*.md', path: '/notes/' })
      if (user === 'Search notes') return call('grep', { pattern: 'hike', path: '/notes/' })
      if (user === 'Plan') return call('write_todos', { todos: [{ content: 'Save the note', status: 'completed' }] })
      if (user === 'Save note') return call('write_file', { file_path: '/notes/demo.md', content: 'Remember the picnic.' })
      if (user === 'Read note') return call('read_file', { file_path: '/notes/demo.md' })
      if (user === 'Update note') return call('edit_file', { file_path: '/notes/demo.md', old_string: 'picnic', new_string: 'hike' })
      if (user === 'Remember tea') return call('edit_file', { file_path: '/memory.md', old_string: 'No preferences saved yet.', new_string: 'The user prefers green tea.' })
      if (user === 'Tool without answer') return call('read_file', { file_path: '/notes/demo.md' })
      if (user === 'Change identity') return call('edit_file', { file_path: '/identity.md', old_string: 'Atlas', new_string: 'Other' })
    }
    if (user === 'Tool without answer' && last.role === 'tool') return done('')
    if (last.role === 'tool') return done('Tool result: ' + JSON.stringify(last.content))
    if (user === 'Preference?') return done(JSON.stringify(body.messages[0].content).includes('green tea') ? 'You prefer green tea.' : 'No preference.')
    done('Keep walking toward the light you want to become.')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const connection = { baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'mock', apiKey: '' }
  let atlas = await AtlasRuntime.open(dir)
  const deltas: StreamDelta[] = []
  const events = (delta: StreamDelta) => { deltas.push(delta); if (delta.text.includes('Partial')) slowStarted?.() }
  try {
    const chat = atlas.store.create()
    await atlas.run('quote', chat.id, connection, 'Quote', events)
    assert.match(atlas.store.get(chat.id).messages.at(-1)!.content, /Keep walking/)
    const toolNames = requests[0].tools.map((tool: any) => tool.function.name)
    for (const name of ['ls', 'read_file', 'write_file', 'edit_file', 'glob', 'grep', 'write_todos']) assert.ok(toolNames.includes(name), name)
    for (const name of ['task', 'execute', 'delete_file']) assert.ok(!toolNames.includes(name), name)
    await atlas.run('save', chat.id, connection, 'Save note', events)
    assert.match(await atlas.read('/notes/demo.md'), /picnic/)
    assert.ok(deltas.some(delta => delta.tool?.name === 'write_file' && delta.tool.status === 'complete'))
    await atlas.run('read', chat.id, connection, 'Read note', events)
    assert.match(atlas.store.get(chat.id).messages.at(-1)!.content, /picnic/)
    await atlas.run('update', chat.id, connection, 'Update note', events)
    assert.match(await atlas.read('/notes/demo.md'), /hike/)
    for (const prompt of ['List notes', 'Find note', 'Search notes', 'Plan']) {
      await atlas.run(prompt, chat.id, connection, prompt, events)
      const reply = atlas.store.get(chat.id).messages.at(-1)!
      assert.equal(reply.tools![0].status, 'complete')
      if (prompt !== 'Plan') assert.match(reply.content, /demo.md/)
    }
    await atlas.run('memory', chat.id, connection, 'Remember tea', events)
    assert.match(await atlas.read('/memory.md'), /green tea/)
    const second = atlas.store.create()
    await atlas.run('recall', second.id, connection, 'Preference?', events)
    assert.match(atlas.store.get(second.id).messages.at(-1)!.content, /green tea/)
    await atlas.run('identity', second.id, connection, 'Change identity', events)
    assert.match(await atlas.read('/identity.md'), /# Atlas/)
    assert.equal(atlas.store.get(second.id).messages.at(-1)!.tools![0].status, 'error')
    await atlas.run('empty-after-tool', second.id, connection, 'Tool without answer', events)
    assert.equal(atlas.store.get(second.id).messages.at(-1)!.status, 'complete')
    assert.match(atlas.store.get(second.id).messages.at(-1)!.notice!, /without a final message/)
    const checkpoint = await atlas.store.saver.getTuple({ configurable: { thread_id: (atlas.store.saver.db.prepare('SELECT graphId FROM atlas_conversations WHERE id = ?').get(chat.id) as any).graphId } })
    assert.ok(checkpoint, 'LangGraph checkpoint exists')
    assert.deepEqual(checkpoint.checkpoint.channel_values.todos, [{ content: 'Save the note', status: 'completed' }])
    const started = new Promise<void>(resolve => { slowStarted = resolve })
    const pending = atlas.run('slow', chat.id, connection, 'Write then slow', events)
    await started
    await assert.rejects(atlas.run('duplicate', chat.id, connection, 'Quote', events), /already working/)
    atlas.stop('slow'); assert.deepEqual(await pending, { stopped: true })
    assert.equal(atlas.store.get(chat.id).messages.at(-1)!.status, 'stopped')
    assert.match(atlas.store.get(chat.id).messages.at(-1)!.content, /Partial/)
    assert.equal(atlas.store.get(chat.id).messages.at(-1)!.tools![0].status, 'complete')
    assert.match(await atlas.read('/notes/keep-after-stop.md'), /survive Stop/)
    await new Promise(resolve => setTimeout(resolve, 100)); assert.ok(disconnected)
    atlas.close(); atlas = await AtlasRuntime.open(dir)
    assert.match(await atlas.read('/notes/demo.md'), /hike/)
    assert.match(await atlas.read('/notes/keep-after-stop.md'), /survive Stop/)
    assert.equal(atlas.store.list().length, 2)
    await atlas.run('after-restart', chat.id, connection, 'Quote', events)
    assert.ok(requests.at(-1).messages.some((m: any) => typeof m.content === 'string' && m.content.includes('previous run was interrupted')))
    assert.equal(atlas.store.get(chat.id).messages.at(-1)!.status, 'complete')
    assert.match(await atlas.read('/memory.md'), /green tea/)
    // Simulate a process dying with an in-progress tool. Recovery must not replay it.
    atlas.store.begin(chat.id, 'Interrupted request', 'mock')
    atlas.close(); atlas = await AtlasRuntime.open(dir)
    assert.equal(atlas.store.get(chat.id).messages.at(-1)!.status, 'interrupted')
    await atlas.run('crash-recovery', chat.id, connection, 'Quote', events)
    assert.equal(atlas.store.get(chat.id).messages.at(-1)!.status, 'complete')
    assert.equal(requests.filter(r => r.messages.at(-1)?.content === 'Interrupted request').length, 0)
    await assert.rejects(atlas.run('bounded', chat.id, connection, 'Limit', events), /output limit/)
    assert.equal(atlas.store.get(chat.id).messages.at(-1)!.status, 'error')
    await assert.rejects(atlas.run('reasoning', chat.id, connection, 'Reason only', events), /no answer/)
    assert.ok(deltas.some(delta => (delta.activity?.reasoningCharacters ?? 0) > 0))
    assert.doesNotMatch(JSON.stringify(atlas.store.get(chat.id)), /private-reasoning-test/)
    await assert.rejects(atlas.run('provider-error', chat.id, { ...connection, apiKey: 'sensitive-provider-test-key' }, 'Provider error', events), error => !String(error).includes('sensitive-provider-test-key'))
    assert.doesNotMatch(JSON.stringify(atlas.store.get(chat.id)), /sensitive-provider-test-key/)
  } finally { atlas.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }) }
})
