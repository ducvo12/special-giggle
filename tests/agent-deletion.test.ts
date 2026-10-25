import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'

function rowCounts(runtime: AgentRuntime) {
  const tables = runtime.store.saver.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]

  return Object.fromEntries(
    tables.map(({ name }) => {
      const row = runtime.store.saver.db
        .prepare(`SELECT count(*) AS count FROM "${name}"`)
        .get() as { count: number }

      return [name, row.count]
    })
  )
}

async function saveCheckpoint(runtime: AgentRuntime, graphId: string, id: string) {
  const config = await runtime.store.saver.put(
    { configurable: { thread_id: graphId } },
    {
      v: 4,
      id,
      ts: new Date().toISOString(),
      channel_values: { saved: true },
      channel_versions: {},
      versions_seen: {}
    },
    { source: 'input', step: 0, parents: {} }
  )
  await runtime.store.saver.putWrites(config, [['saved', 'offline test']], 'test-task')
}

test('empty → create → delete leaves no agent files or database rows, including recovery checkpoints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-agent-deletion-'))
  let runtime = await AgentRuntime.open(directory)

  try {
    assert.deepEqual(await runtime.registry.list(), [])
    assert.ok(Object.values(rowCounts(runtime)).every(count => count === 0))

    const agent = await runtime.createAgent('Offline test')
    const section = await runtime.createSection(agent.id, 'Section to delete', 'shared')
    await runtime.createProject(agent.id, section.id, 'Project to delete')
    const root = join(directory, 'agents', agent.id)
    await access(join(root, 'identity.md'))
    await mkdir(join(root, 'projects', 'nested'), { recursive: true })
    await writeFile(join(root, 'projects', 'nested', 'note.md'), 'A local file.')

    // Seed persisted history directly. No model connection or chat is needed.
    const chat = runtime.store.create(agent.id)
    const first = runtime.store.begin(agent.id, chat.id, 'Saved input', 'offline')
    await saveCheckpoint(runtime, first.graphId, 'first-checkpoint')
    runtime.store.finish(chat.id, first.message, 'stopped')

    const recovered = runtime.store.begin(agent.id, chat.id, 'Recovered input', 'offline')
    assert.notEqual(recovered.graphId, first.graphId)
    await saveCheckpoint(runtime, recovered.graphId, 'recovered-checkpoint')
    runtime.store.finish(chat.id, recovered.message, 'complete')
    runtime.store.create(agent.id)
    runtime.store.saveModelState(runtime.store.list(agent.id)[0].id, 'test', [
      { role: 'user', content: 'retained native state' }
    ])
    assert.ok(Object.values(rowCounts(runtime)).every(count => count > 0))

    // Ownership of both graph histories must survive a process restart.
    runtime.close()
    runtime = await AgentRuntime.open(directory)
    await runtime.deleteAgent(agent.id)

    assert.deepEqual(await runtime.registry.list(), [])
    assert.deepEqual(await readdir(join(directory, 'agents')), [])
    await assert.rejects(access(root), { code: 'ENOENT' })
    assert.ok(
      Object.values(rowCounts(runtime)).every(count => count === 0),
      JSON.stringify(rowCounts(runtime))
    )

    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.deepEqual(await runtime.registry.list(), [])
    assert.ok(Object.values(rowCounts(runtime)).every(count => count === 0))
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('deletion preserves other agents and rejects unsafe paths, active runs, and concurrent changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-agent-isolation-'))
  const runtime = await AgentRuntime.open(directory)

  try {
    const target = await runtime.createAgent('Delete me')
    const survivor = await runtime.createAgent('Keep me')
    const chat = runtime.store.create(survivor.id)
    const turn = runtime.store.begin(survivor.id, chat.id, 'Keep this history', 'offline')
    await saveCheckpoint(runtime, turn.graphId, 'surviving-checkpoint')
    runtime.store.finish(chat.id, turn.message, 'complete')
    runtime.store.create(target.id)

    runtime.active = { id: 'running', controller: new AbortController() }
    await assert.rejects(runtime.deleteAgent(target.id), /Finish the current operation/)
    runtime.active = null
    await assert.rejects(runtime.deleteAgent('../outside'), /Invalid agent/)

    const outside = join(directory, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'keep.txt'), 'Do not delete.')
    await symlink(outside, join(directory, 'agents', 'linked-agent'))
    await assert.rejects(runtime.deleteAgent('linked-agent'), /symbolic links/)
    await access(join(outside, 'keep.txt'))

    const deleting = runtime.deleteAgent(target.id)
    await assert.rejects(runtime.createAgent('Concurrent agent'), /Finish the current operation/)
    await assert.rejects(
      runtime.createConversation(target.id),
      /Finish the current operation|ENOENT/
    )
    await deleting

    await assert.rejects(runtime.createConversation(target.id))

    assert.deepEqual(await runtime.registry.list(), [survivor])
    assert.equal(runtime.store.list(survivor.id).length, 1)
    assert.equal(runtime.store.get(survivor.id, chat.id).messages.length, 2)
    assert.ok(await runtime.store.saver.getTuple({ configurable: { thread_id: turn.graphId } }))
    await access(join(directory, 'agents', survivor.id, 'identity.md'))
    assert.deepEqual(runtime.store.list(target.id), [])
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('database deletion failures roll back records and leave the agent folder intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-agent-delete-failure-'))
  const runtime = await AgentRuntime.open(directory)

  try {
    const agent = await runtime.createAgent('Keep on failure')
    runtime.store.create(agent.id)
    const before = rowCounts(runtime)
    runtime.store.saver.db.exec(`
      CREATE TEMP TRIGGER reject_deletion BEFORE DELETE ON conversations
      BEGIN SELECT RAISE(ABORT, 'Simulated database failure'); END;
    `)

    await assert.rejects(runtime.deleteAgent(agent.id), /Simulated database failure/)
    assert.deepEqual(rowCounts(runtime), before)
    await access(join(directory, 'agents', agent.id, 'identity.md'))
    assert.deepEqual(await runtime.registry.list(), [agent])

    runtime.store.saver.db.exec('DROP TRIGGER reject_deletion')
    await runtime.deleteAgent(agent.id)
    assert.ok(Object.values(rowCounts(runtime)).every(count => count === 0))
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('chat deletion removes all recovered history and preserves other chats and workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-chat-delete-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Chat owner')
    const other = await runtime.createAgent('Other owner')
    const chat = await runtime.createConversation(agent.id)
    const survivor = await runtime.createConversation(agent.id)
    const turn = runtime.store.begin(agent.id, chat.id, 'Delete this', 'offline')
    await saveCheckpoint(runtime, turn.graphId, 'original')
    runtime.store.finish(chat.id, turn.message, 'stopped')
    const recovered = runtime.store.begin(agent.id, chat.id, 'Retry', 'offline')
    await saveCheckpoint(runtime, recovered.graphId, 'recovered')
    runtime.store.finish(chat.id, recovered.message, 'complete')
    runtime.store.saveModelState(chat.id, 'offline', [{ role: 'user', content: 'History' }])

    await assert.rejects(runtime.deleteConversation(other.id, chat.id), /Conversation not found/)
    runtime.active = { id: 'running', controller: new AbortController() }
    await assert.rejects(runtime.deleteConversation(agent.id, chat.id), /Finish the current operation/)
    runtime.active = null

    const before = rowCounts(runtime)
    runtime.store.saver.db.exec(`CREATE TEMP TRIGGER reject_chat_deletion BEFORE DELETE ON conversations
      BEGIN SELECT RAISE(ABORT, 'Deletion failed'); END;`)
    await assert.rejects(runtime.deleteConversation(agent.id, chat.id), /Deletion failed/)
    assert.deepEqual(rowCounts(runtime), before)
    runtime.store.saver.db.exec('DROP TRIGGER reject_chat_deletion')

    await runtime.deleteConversation(agent.id, chat.id)
    const { messages: _messages, ...survivingMetadata } = survivor
    assert.deepEqual(runtime.store.list(agent.id), [survivingMetadata])
    assert.throws(() => runtime.store.get(agent.id, chat.id), /Conversation not found/)
    assert.equal(runtime.store.modelState(chat.id, 'offline'), undefined)
    for (const graphId of [turn.graphId, recovered.graphId]) {
      assert.equal(await runtime.store.saver.getTuple({ configurable: { thread_id: graphId } }), undefined)
    }
    for (const table of ['messages', 'conversation_threads', 'writes']) {
      const row = runtime.store.saver.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }
      assert.equal(row.count, table === 'conversation_threads' ? 1 : 0)
    }
    await access(join(directory, 'agents', agent.id, 'identity.md'))
    assert.equal((await runtime.registry.list()).length, 2)
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('chat renaming persists, validates names, and respects ownership and active operations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-chat-rename-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Owner')
    const other = await runtime.createAgent('Other')
    const chat = await runtime.createConversation(agent.id)
    const turn = runtime.store.begin(agent.id, chat.id, 'Original title', 'offline')
    runtime.store.finish(chat.id, turn.message, 'complete')
    const original = runtime.store.get(agent.id, chat.id)
    await assert.rejects(runtime.renameConversation(other.id, chat.id, 'Wrong owner'), /Conversation not found/)
    for (const title of ['', '   ', 'x'.repeat(201)]) {
      await assert.rejects(runtime.renameConversation(agent.id, chat.id, title), /Chat names/)
    }
    runtime.active = { id: 'running', controller: new AbortController() }
    await assert.rejects(runtime.renameConversation(agent.id, chat.id, 'Busy'), /Finish the current operation/)
    runtime.active = null
    await runtime.renameConversation(agent.id, chat.id, '  Renamed chat  ')
    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.deepEqual(runtime.store.get(agent.id, chat.id), { ...original, title: 'Renamed chat' })
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})
