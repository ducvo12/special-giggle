import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { ModelScheduler } from '../src/backend/harness/scheduler.ts'
import { defaultHarnessSettings } from '../src/shared/harness.ts'

const tick = () => new Promise(resolve => setTimeout(resolve, 10))
async function until(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await tick() }
  throw new Error('Timed out waiting for the fixture boundary')
}
function chunk(res: ServerResponse, delta: unknown, finish_reason: string | null = null) {
  res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`)
}
function answer(res: ServerResponse, content = 'Done') {
  chunk(res, { content }); chunk(res, {}, 'stop'); res.end('data: [DONE]\n\n')
}
function call(res: ServerResponse, id: string, name: string, args: unknown) {
  chunk(res, { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] })
  chunk(res, {}, 'tool_calls'); res.end('data: [DONE]\n\n')
}
async function fixture(handler: (body: any, res: ServerResponse) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'granite-pass2-'))
  const runtime = await AgentRuntime.open(directory)
  const agent = await runtime.createAgent('Lifecycle')
  const requests: any[] = []
  const server = createServer(async (req, res) => {
    let text = ''
    for await (const data of req) text += data
    const body = JSON.parse(text); requests.push(body)
    res.setHeader('Content-Type', 'text/event-stream')
    handler(body, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const connection = { connectionId: 'fixture', baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'mock', apiKey: '' }
  return { runtime, agent, requests, directory, connection,
    async close() {
      await runtime.stopAll(); runtime.close(); server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }
}

test('model leases are FIFO, cancellable and share local endpoint capacity', async () => {
  const scheduler = new ModelScheduler()
  const connection = { baseUrl: 'http://localhost:1234/v1', model: 'mock', apiKey: '' }
  const a = new AbortController(), b = new AbortController(), c = new AbortController()
  const release = await scheduler.acquire(connection, a.signal, () => {})
  const positions: number[] = []
  const second = scheduler.acquire({ ...connection, baseUrl: 'http://127.0.0.1:1234/v1' }, b.signal, () => {})
  const rejected = assert.rejects(second)
  const third = scheduler.acquire(connection, c.signal, position => positions.push(position))
  assert.equal(positions.at(-1), 2)
  b.abort()
  await rejected
  assert.equal(positions.at(-1), 1)
  release()
  const finish = await third
  finish(); finish()
})

test('queued chats retain one job and ordered prompts; active steering keeps the original task', { timeout: 15000 }, async () => {
  const held: ServerResponse[] = []
  const f = await fixture((body, res) => {
    const users = body.messages.filter((item: any) => item.role === 'user').map((item: any) => item.content)
    if (users.at(-1) === 'hold' || users.includes('Make the button blue') && !users.includes('Actually green')) {
      chunk(res, { content: 'Provisional' }); held.push(res)
    } else answer(res, users.join(' | '))
  })
  try {
    const a = await f.runtime.createConversation(f.agent.id)
    const b = await f.runtime.createConversation(f.agent.id)
    const first = f.runtime.run('a', f.agent.id, a.id, f.connection, 'hold', () => {})
    await until(() => held.length === 1)
    const second = f.runtime.run('b', f.agent.id, b.id, f.connection, 'first queued', () => {})
    await until(() => f.runtime.listRuns().some(run => run.id === 'b' && run.queue?.position === 1))
    const extra = await f.runtime.run('b-steer', f.agent.id, b.id, f.connection, 'second queued', () => {})
    assert.equal(extra.runId, 'b')
    const section = await f.runtime.createSection(f.agent.id, 'While running', 'shared')
    await f.runtime.moveConversation(f.agent.id, b.id, { sectionId: section.id, projectId: null })
    await assert.rejects(f.runtime.moveConversation(f.agent.id, a.id, { sectionId: section.id, projectId: null }), /Finish/)
    answer(held[0]); await first; await second
    assert.match(f.runtime.store.get(f.agent.id, b.id).messages.find(message => message.id === 'b')!.content, /first queued \| second queued/)
    const active = f.runtime.run('blue', f.agent.id, a.id, f.connection, 'Make the button blue', () => {})
    await until(() => held.length === 2)
    const steered = await f.runtime.run('green', f.agent.id, a.id, f.connection, 'Actually green', () => {})
    assert.equal(steered.runId, 'blue')
    await active
    const users = f.requests.at(-1).messages.filter((item: any) => item.role === 'user').map((item: any) => item.content)
    assert.ok(users.indexOf('Make the button blue') < users.indexOf('Actually green'))
    assert.equal(f.runtime.listRuns().find(run => run.id === 'blue')!.phase, 'complete')
    const transcript = f.runtime.store.get(f.agent.id, a.id).messages
    assert.equal(transcript.filter(message => message.role === 'assistant' && message.runId === 'blue' && message.status === 'complete').length, 1)
    assert.equal(transcript.at(-2)!.content, 'Actually green')
    assert.equal(transcript.at(-1)!.role, 'assistant')
  } finally { await f.close() }
})

test('approval frees model capacity and steering invalidates the old action', { timeout: 15000 }, async () => {
  const f = await fixture((body, res) => {
    const last = body.messages.at(-1)
    if (last.role === 'user' && last.content === 'write') call(res, 'write-1', 'write_file', { file_path: '/notes/do-not-create.md', content: 'obsolete' })
    else answer(res)
  })
  try {
    await f.runtime.saveSettings(f.agent.id, { ...defaultHarnessSettings, approveWrites: true })
    const a = await f.runtime.createConversation(f.agent.id)
    const b = await f.runtime.createConversation(f.agent.id)
    let approval: any
    const first = f.runtime.run('approve', f.agent.id, a.id, f.connection, 'write', delta => { if (delta.approval) approval = delta.approval })
    await until(() => Boolean(approval))
    await f.runtime.run('other', f.agent.id, b.id, f.connection, 'question', () => {})
    await f.runtime.run('cancel-write', f.agent.id, a.id, f.connection, 'Just answer instead', () => {})
    await first
    assert.throws(() => f.runtime.approvals.answer('approve', approval.id, true), /no longer pending/)
    await assert.rejects(f.runtime.read(f.agent.id, '/notes/do-not-create.md'))
  } finally { await f.close() }
})

test('empty and incomplete model responses fail without running their tool fragments', { timeout: 15000 }, async () => {
  const f = await fixture((body, res) => {
    const last = body.messages.at(-1)
    if (last.content === 'empty') answer(res, '')
    else {
      chunk(res, { content: 'Partial', tool_calls: [{ index: 0, id: 'fragment', function: { name: 'write_file', arguments: '{' } }] })
      chunk(res, {}, 'length'); res.end('data: [DONE]\n\n')
    }
  })
  try {
    const chat = await f.runtime.createConversation(f.agent.id)
    await assert.rejects(f.runtime.run('empty', f.agent.id, chat.id, f.connection, 'empty', () => {}), /no answer/)
    await assert.rejects(f.runtime.run('fragment', f.agent.id, chat.id, f.connection, 'fragment', () => {}), /output limit/)
    assert.equal(f.runtime.store.get(f.agent.id, chat.id).messages.at(-1)!.tools!.length, 0)
    assert.equal(f.requests.length, 2, 'partial output is never automatically retried')
    await assert.rejects(f.runtime.run('switch', f.agent.id, chat.id, { ...f.connection, model: 'other' }, 'switch', () => {}), /model is fixed/)
  } finally { await f.close() }
})

test('startup preserves never-started prompts without dispatch and does not repeat a dismissed notice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-pass2-restart-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Restart')
    const chat = await runtime.createConversation(agent.id)
    const run = { id: 'saved', agentId: agent.id, conversationId: chat.id, phase: 'queued' as const,
      model: 'mock', connectionId: 'fixture', createdAt: Date.now(), startedAt: null, endedAt: null, messageIds: [] }
    runtime.store.runs.accept(run, 'Saved request')
    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.equal(runtime.listRuns()[0].phase, 'not_started')
    assert.equal(runtime.store.get(agent.id, chat.id).messages[0].delivery, 'pending')
    assert.deepEqual(runtime.store.runs.recovery(), { active: 0, pending: 1 })
    runtime.store.runs.dismissRecovery()
    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.deepEqual(runtime.store.runs.recovery(), { active: 0, pending: 0 })
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('a transient request gets one retry, while Stop fences a pending generation', { timeout: 15000 }, async () => {
  let attempts = 0
  let holding = false
  const f = await fixture((body, res) => {
    const user = body.messages.findLast((message: any) => message.role === 'user').content
    if (user === 'retry' && ++attempts === 1) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'temporary_server_error' } }))
    } else if (user === 'stop') {
      holding = true
      chunk(res, { content: 'Partial before Stop' })
    } else answer(res)
  })
  try {
    const chat = await f.runtime.createConversation(f.agent.id)
    await f.runtime.run('retry', f.agent.id, chat.id, f.connection, 'retry', () => {})
    assert.equal(attempts, 2)
    const pending = f.runtime.run('stop', f.agent.id, chat.id, f.connection, 'stop', () => {})
    await until(() => holding)
    f.runtime.stop('stop')
    assert.deepEqual(await pending, { stopped: true })
    assert.equal(f.runtime.listRuns().find(run => run.id === 'stop')!.phase, 'stopped')
    const count = f.requests.length
    await tick()
    assert.equal(f.requests.length, count)
    assert.equal(f.runtime.store.get(f.agent.id, chat.id).messages.find(message => message.id === 'stop')!.status, 'stopped')
  } finally { await f.close() }
})

test('changed permissions supersede a pending approval and reach the next model request', { timeout: 15000 }, async () => {
  const f = await fixture((body, res) => {
    if (body.messages.at(-1).role === 'user') call(res, 'permission-change', 'write_file', { file_path: '/notes/not-approved.md', content: 'No' })
    else answer(res)
  })
  try {
    await f.runtime.saveSettings(f.agent.id, { ...defaultHarnessSettings, approveWrites: true })
    const chat = await f.runtime.createConversation(f.agent.id)
    let approval: any
    const running = f.runtime.run('permissions', f.agent.id, chat.id, f.connection, 'write', delta => { if (delta.approval) approval = delta.approval })
    await until(() => Boolean(approval))
    await f.runtime.saveSettings(f.agent.id, { ...defaultHarnessSettings, instructions: 'Use these updated rules.' })
    assert.throws(() => f.runtime.approvals.answer('permissions', approval.id, true), /no longer pending/)
    await running
    await assert.rejects(f.runtime.read(f.agent.id, '/notes/not-approved.md'))
    assert.match(f.requests.at(-1).messages[0].content, /Use these updated rules/)
    assert.equal(f.runtime.listRuns().find(run => run.id === 'permissions')!.phase, 'complete')
  } finally { await f.close() }
})

test('concurrent native edits preserve independent changes to the same memory file', async () => {
  const { fileTools } = await import('../src/backend/harness/tools/workspace.ts')
  const { AgentFilesystem } = await import('../src/backend/workspace/filesystem.ts')
  const directory = await mkdtemp(join(tmpdir(), 'granite-shared-writes-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Shared writer')
    const root = (await runtime.registry.workspace(agent.id)).root
    const original = await runtime.read(agent.id, '/memory.md')
    await runtime.saveMarkdown(agent.id, '/memory.md', 'Tea\nCoffee', original)
    const edit = () => fileTools(new AgentFilesystem(root)).find(tool => tool.name === 'edit_file')!
    await Promise.all([
      edit().run({ file_path: '/memory.md', old_string: 'Tea', new_string: 'Green tea' }),
      edit().run({ file_path: '/memory.md', old_string: 'Coffee', new_string: 'Black coffee' })
    ])
    assert.equal(await runtime.read(agent.id, '/memory.md'), 'Green tea\nBlack coffee')
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})
