import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QuestionQueue } from '../src/backend/harness/questions.ts'
import type { UserQuestion } from '../src/shared/run.ts'

test('reject resolves only that question without aborting the run', async () => {
  const queue = new QuestionQueue()
  const controller = new AbortController()
  let current: UserQuestion | null = null
  const pending = queue.ask('run', [{ title: 'Which framework?' }], controller.signal, value => { current = value })
  const id = current!.id
  assert.throws(() => queue.reject('other-run', id), /no longer pending/)
  queue.reject('run', id)
  const result = await pending
  assert.equal(result.rejected, true)
  assert.equal(result.withdrawn, true)
  assert.equal(result.answers, undefined)
  assert.equal(controller.signal.aborted, false)
  assert.equal(current, null)
  assert.throws(() => queue.answer('run', id, ['React']), /no longer pending/)
  assert.throws(() => queue.reject('run', id), /no longer pending/)
  const next = queue.ask('run', [{ title: 'What next?' }], controller.signal, value => { current = value })
  queue.answer('run', current!.id, ['Continue'])
  assert.deepEqual((await next).answers, ['Continue'])
})

test('rejecting a question leaves other runs waiting for their answers', async () => {
  const queue = new QuestionQueue()
  const controller = new AbortController()
  let firstId = '', secondId = ''
  const first = queue.ask('a', [{ title: 'First?' }], controller.signal, value => { if (value) firstId = value.id })
  const second = queue.ask('b', [{ title: 'Second?' }], controller.signal, value => { if (value) secondId = value.id })
  queue.reject('a', firstId)
  assert.equal((await first).rejected, true)
  queue.answer('b', secondId, ['Yes'])
  assert.deepEqual((await second).answers, ['Yes'])
})

test('standalone text answers are required unless the agent marks them optional', async () => {
  const queue = new QuestionQueue()
  const controller = new AbortController()
  let id = ''
  const pending = queue.ask('run', [
    { title: 'Required text' },
    { title: 'Optional text', optional: true },
    { title: 'Explicitly required text', optional: false }
  ], controller.signal, value => { if (value) id = value.id })
  assert.throws(() => queue.answer('run', id, ['', '', 'Required']), /invalid/)
  assert.throws(() => queue.answer('run', id, ['Required', '', '   ']), /invalid/)
  assert.throws(() => queue.answer('run', id, ['Required']), /invalid/)
  queue.answer('run', id, ['Required', '   ', 'Required too'])
  assert.deepEqual((await pending).answers, ['Required', '', 'Required too'])
})

test('custom text in multiple-choice questions can always be empty', async () => {
  const queue = new QuestionQueue()
  const controller = new AbortController()
  let id = ''
  const pending = queue.ask('run', [
    { title: 'Choose a framework', options: ['React', 'Vue'] },
    { title: 'Choose a language', options: ['TypeScript', 'JavaScript'], optional: false }
  ], controller.signal, value => { if (value) id = value.id })
  queue.answer('run', id, ['', '  '])
  const result = await pending
  assert.deepEqual(result.answers, ['', ''])
  assert.equal(result.withdrawn, undefined)
  assert.equal(result.rejected, undefined)
})

test('aborting and withdrawing questions clean up only their owning requests', async () => {
  const queue = new QuestionQueue()
  const firstController = new AbortController()
  const secondController = new AbortController()
  const firstEvents: (UserQuestion | null)[] = []
  const secondEvents: (UserQuestion | null)[] = []
  const first = queue.ask('first', [{ title: 'First?' }], firstController.signal, value => firstEvents.push(value))
  const second = queue.ask('second', [{ title: 'Second?' }], secondController.signal, value => secondEvents.push(value))
  const firstId = firstEvents[0]!.id
  const secondId = secondEvents[0]!.id
  const reason = new Error('Stopped by user')
  const aborted = assert.rejects(first, error => error === reason)

  firstController.abort(reason)
  await aborted
  assert.equal(firstEvents.at(-1), null)
  assert.throws(() => queue.answer('first', firstId, ['Late answer']), /no longer pending/)
  assert.equal(secondEvents.length, 1, 'Another run is still waiting')

  queue.withdraw('second')
  const withdrawn = await second
  assert.equal(withdrawn.withdrawn, true)
  assert.equal(withdrawn.rejected, undefined)
  assert.equal(withdrawn.answers, undefined)
  assert.equal(secondEvents.at(-1), null)
  assert.throws(() => queue.reject('second', secondId), /no longer pending/)
  secondController.abort()
  queue.withdraw('second')
  assert.equal(secondEvents.length, 2, 'Settled requests remove their abort listener and pending entry')
})
