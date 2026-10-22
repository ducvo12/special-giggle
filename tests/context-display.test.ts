import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextDisplay, latestContextResponse } from '../src/renderer/src/features/chat/context-display.ts'

const base = { loading: false, hasResponse: false, busy: false }
const rows = ['used', 'limit', 'input', 'output', 'cached', 'reasoning', 'maxOutput'] as const

test('new chat shows dots while loading and zero usage once the window is known', () => {
  const pending = contextDisplay({ ...base, loading: true })
  for (const row of rows) assert.equal(pending[row], '...')
  const ready = contextDisplay({ ...base, limit: 100000, maxOutput: 10000 })
  assert.equal(ready.limit, '100,000')
  for (const row of rows.filter(row => row !== 'limit')) assert.equal(ready[row], '0')
  assert.equal(ready.percentage, 0)
})

test('a completed response without usage clears usage fields but preserves the loaded context window', () => {
  const missing = contextDisplay({ ...base, hasResponse: true, limit: 100000, maxOutput: 10000 })
  for (const row of rows.filter(row => row !== 'limit')) assert.equal(missing[row], '—')
  assert.equal(missing.limit, '100,000')
  assert.equal(missing.percentage, undefined)
  const pending = contextDisplay({ ...base, hasResponse: true, busy: true, limit: 100000 })
  for (const row of rows.filter(row => row !== 'limit')) assert.equal(pending[row], '—')
  assert.equal(pending.limit, '100,000')
})

test('reported usage replaces placeholders and does not fabricate absent breakdowns', () => {
  const reported = contextDisplay({ ...base, hasResponse: true, limit: 1000, usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500, cachedTokens: 0 } })
  assert.equal(reported.percentage, 50)
  assert.equal(reported.used, '500')
  assert.equal(reported.cached, '0')
  assert.equal(reported.reasoning, '—')
  const unknownLimit = contextDisplay({ ...base, hasResponse: true, usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500 } })
  assert.equal(unknownLimit.used, '500')
  assert.equal(unknownLimit.limit, '—')
  assert.equal(unknownLimit.percentage, undefined)
})


test('streaming a follow-up preserves the previous completed usage until completion', () => {
  const usage = { inputTokens: 400, outputTokens: 100, totalTokens: 500 }
  const previous = { id: 'previous', role: 'assistant' as const, model: 'test', content: 'First answer', status: 'complete' as const, contextUsage: usage }
  const followup = { id: 'next', role: 'assistant' as const, model: 'test', content: 'Next answer', status: 'running' as const, contextUsage: { inputTokens: 700, outputTokens: 100, totalTokens: 800 } }
  assert.equal(latestContextResponse([previous, followup], 'test'), previous)
  const finished = { ...followup, status: 'complete' as const }
  assert.equal(latestContextResponse([previous, finished], 'test'), finished)
  const missing = { ...finished, contextUsage: undefined }
  assert.equal(latestContextResponse([previous, missing], 'test'), missing)
  assert.equal(latestContextResponse([previous], 'other-model'), undefined)
})

test('loading a new reply keeps numbers and an unused ready chat stays zero during its first reply', () => {
  const before = contextDisplay({ ...base, hasResponse: true, limit: 1000, usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500 } })
  const during = contextDisplay({ ...base, hasResponse: true, busy: true, loading: true, limit: 1000, usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500 } })
  assert.deepEqual(during, before)
  const firstReply = contextDisplay({ ...base, busy: true, limit: 1000 })
  assert.equal(firstReply.used, '0')
  assert.equal(firstReply.limit, '1,000')
})
