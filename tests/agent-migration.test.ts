import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'

test('existing Atlas files, conversations, and checkpoints survive multi-agent migration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-agent-migration-'))

  try {
    const root = join(directory, 'agents', 'atlas')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'identity.md'), '# Atlas\nMy existing custom identity.\n')
    await writeFile(join(root, 'memory.md'), 'The user likes mint tea.')
    const previous = SqliteSaver.fromConnString(join(directory, 'atlas.sqlite'))
    previous.db
      .exec(`CREATE TABLE atlas_conversations (id TEXT PRIMARY KEY, title TEXT, updatedAt INTEGER, graphId TEXT, recover INTEGER DEFAULT 0);
      CREATE TABLE atlas_messages (id TEXT PRIMARY KEY, conversationId TEXT, createdAt INTEGER, data TEXT);`)
    previous.db
      .prepare('INSERT INTO atlas_conversations VALUES (?, ?, ?, ?, 0)')
      .run('old-chat', 'Existing conversation', 1, 'old-thread')
    previous.db
      .prepare('INSERT INTO atlas_messages VALUES (?, ?, ?, ?)')
      .run(
        'old-message',
        'old-chat',
        1,
        JSON.stringify({ id: 'old-message', role: 'user', content: 'My old message' })
      )
    await previous.put(
      { configurable: { thread_id: 'old-thread' } },
      {
        v: 4,
        id: 'migration-checkpoint',
        ts: new Date().toISOString(),
        channel_values: { preserved: true },
        channel_versions: {},
        versions_seen: {}
      },
      { source: 'input', step: 0, parents: {} }
    )
    previous.db.close()
    const runtime = await AgentRuntime.open(directory)

    try {
      assert.equal(runtime.store.list('atlas')[0].title, 'Existing conversation')
      assert.equal(runtime.store.get('atlas', 'old-chat').messages[0].content, 'My old message')
      assert.match(await runtime.read('atlas', '/identity.md'), /existing custom identity/)
      assert.match(await runtime.read('atlas', '/memory.md'), /mint tea/)
      assert.equal(
        (await runtime.store.saver.getTuple({ configurable: { thread_id: 'old-thread' } }))
          ?.checkpoint.channel_values.preserved,
        true
      )
      const second = await runtime.registry.create('Nova')
      assert.deepEqual(runtime.store.list(second.id), [])
      assert.throws(() => runtime.store.get(second.id, 'old-chat'), /not found/)
    } finally {
      runtime.close()
    }

    const reloaded = await AgentRuntime.open(directory)
    assert.equal(reloaded.store.list('atlas').length, 1)
    reloaded.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
