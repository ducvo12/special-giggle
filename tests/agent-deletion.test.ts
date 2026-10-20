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
    await assert.rejects(runtime.createConversation(target.id), /Finish the current operation|ENOENT/)
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
