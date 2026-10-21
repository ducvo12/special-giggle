import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from '../src/backend/agents/store.ts'
import { ResponseClock } from '../src/renderer/src/features/chat/response-clock.ts'

test('response clock measures send to final render independently of dev timing and network completion', () => {
  let now = 100
  const clock = new ResponseClock(() => now)
  const persisted: unknown[] = []
  clock.begin('request')
  now = 200
  clock.rendered('request', 'Hello')
  clock.bind('request', 'saved-id', 'Hello world', (...args) => persisted.push(args))
  assert.equal(persisted.length, 0, 'backend completion must not stop the display timer')
  now = 450
  clock.rendered('saved-id', 'Hello world')
  assert.deepEqual(persisted, [['saved-id', 350]])
  now = 900
  clock.rendered('saved-id', 'Hello world')
  assert.equal(clock.elapsed('request'), 350)
  assert.equal(persisted.length, 1)
  assert.equal(clock.get('saved-id')?.requestId, 'request')
})

test('a final chunk painted before the backend result keeps its actual render time', () => {
  let now = 0
  const clock = new ResponseClock(() => now)
  clock.begin('request')
  now = 120
  clock.rendered('request', 'Complete')
  now = 500
  let duration = -1
  clock.bind('request', 'saved-id', 'Complete', (_id, ms) => { duration = ms })
  assert.equal(duration, 120)
})

test('response duration persists in SQLite, preserves message content and ordering, and cannot be overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'granite-response-duration-'))
  const path = join(dir, 'test.sqlite')
  const store = new AgentStore(path)
  try {
    const conversation = store.create('atlas')
    const { message } = store.begin('atlas', conversation.id, 'Question', 'model')
    assert.throws(() => store.saveResponseDuration('atlas', conversation.id, message.id, 1234), /Completed response/)
    message.content = 'Answer'
    store.finish(conversation.id, message, 'complete')
    const before = store.get('atlas', conversation.id)
    assert.equal(before.messages[1].responseDurationMs, undefined)
    for (const invalid of [-1, NaN, Infinity, 0.5]) {
      assert.throws(() => store.saveResponseDuration('atlas', conversation.id, message.id, invalid), /Invalid/)
    }
    assert.throws(() => store.saveResponseDuration('other', conversation.id, message.id, 1234), /not found/)
    assert.throws(() => store.saveResponseDuration('atlas', conversation.id, before.messages[0].id, 1234), /Completed response/)
    store.saveResponseDuration('atlas', conversation.id, message.id, 1234)
    store.saveResponseDuration('atlas', conversation.id, message.id, 9999)
    const reopened = new AgentStore(path)
    try {
      const after = reopened.get('atlas', conversation.id)
      assert.equal(after.messages[1].responseDurationMs, 1234)
      assert.deepEqual(after.messages[1], { ...before.messages[1], responseDurationMs: 1234 })
      assert.equal(after.updatedAt, before.updatedAt)
      assert.deepEqual(after.messages[0], before.messages[0])
    } finally { reopened.saver.db.close() }
  } finally {
    store.saver.db.close()
    await rm(dir, { recursive: true, force: true })
  }
})
