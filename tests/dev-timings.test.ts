import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toggleDevTimings, beginTiming, recordDelta, finishTiming, bindTiming, timingFor, recordVisible
} from '../src/renderer/src/features/chat/devTimings.ts'

test('dev timings are opt-in, follow persisted message IDs, and include the smooth reveal tail', context => {
  let now = 1000
  context.mock.method(performance, 'now', () => now)
  context.mock.method(Date, 'now', () => now + 100000)
  beginTiming('disabled')
  assert.equal(timingFor('disabled'), undefined)

  toggleDevTimings()
  beginTiming('request')
  now = 1100
  recordDelta({ requestId: 'request', text: '', activity: { reasoningCharacters: 10, answerCharacters: 0 } })
  now = 1400
  recordDelta({ requestId: 'request', text: 'Hello' })
  now = 1420
  recordVisible('request', 1)
  now = 1500
  recordDelta({ requestId: 'request', text: ' world' })
  now = 1600
  finishTiming('request')
  bindTiming('request', 'saved-message')
  now = 1750
  recordVisible('saved-message', 11)
  const timing = timingFor('saved-message')!
  assert.equal(timing, timingFor('request'))
  assert.equal(timing.firstChunk! - timing.start, 400)
  assert.equal(timing.lastChunk! - timing.start, 500)
  assert.equal(timing.thinking, 300)
  assert.equal(timing.lastVisible! - timing.firstVisible!, 330)
  assert.equal(timing.endedAt, 101600)
  finishTiming('request')
  assert.equal(timing.endedAt, 101600)

  toggleDevTimings()
  beginTiming('disabled-again')
  assert.equal(timingFor('disabled-again'), undefined)
})
