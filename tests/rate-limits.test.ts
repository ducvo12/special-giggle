import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRateLimitHeaders } from '../src/backend/models/rate-limits.ts'
import { ConnectionUsageStore } from '../src/backend/connections/usage.ts'
import { modelRequest } from '../src/backend/harness/providers/http.ts'
import { HarnessError } from '../src/backend/harness/types.ts'
import { currentUsageWindows, type RateLimitWindow } from '../src/shared/connection-usage.ts'

const now = 1_800_000_000_000

test('rate limits retain exact counts, zero remaining, and compound reset durations', () => {
  assert.deepEqual(parseRateLimitHeaders(new Headers({
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '70',
    'x-ratelimit-reset-requests': '1m30.5s',
    'x-ratelimit-limit-tokens': '2000',
    'x-ratelimit-remaining-tokens': '0',
    'x-ratelimit-reset-tokens': '250ms',
    'x-ratelimit-limit-project-tokens': '10000',
    'x-ratelimit-remaining-project-tokens': '9000'
  }), now), [
    { kind: 'requests', limit: 100, remaining: 70, resetsAt: now + 90_500 },
    { kind: 'tokens', limit: 2000, remaining: 0, resetsAt: now + 250 },
    { kind: 'project-tokens', limit: 10000, remaining: 9000 }
  ])
})

test('absent or malformed limits never become a made-up allowance', () => {
  assert.deepEqual(parseRateLimitHeaders(new Headers()), [])
  for (const [limit, remaining, reset] of [
    ['0', '0', '1s'], ['100', '-1', '1s'], ['100', '101', '1s'],
    ['100', '1.5', '1s'], ['Infinity', '1', '1s'], ['100', '', '1s'],
    ['100', '70', '0s'], ['100', '70', 'tomorrow'], ['100', '70', '1700000000'],
    ['100', '70', '1s untrusted text'], ['9007199254740992', '70', '1s']
  ]) {
    assert.deepEqual(parseRateLimitHeaders(new Headers({
      'x-ratelimit-limit-requests': limit,
      'x-ratelimit-remaining-requests': remaining,
      'x-ratelimit-reset-requests': reset
    }), now), [], `${limit}/${remaining}/${reset}`)
  }
})

test('readings expire at each reset and after five minutes without assuming a refill', () => {
  const usage = {
    connectionId: 'one', model: 'test', observedAt: now,
    windows: [
      { kind: 'requests' as const, limit: 100, remaining: 70, resetsAt: now + 60_000 },
      { kind: 'tokens' as const, limit: 1000, remaining: 200 }
    ]
  }
  assert.equal(currentUsageWindows(usage, now + 59_999).length, 2)
  assert.deepEqual(currentUsageWindows(usage, now + 60_000), [usage.windows[1]])
  assert.deepEqual(currentUsageWindows(usage, now + 300_000), [])
})

test('connection edits and deletion invalidate readings and reject results from old runs', () => {
  const store = new ConnectionUsageStore()
  const first = store.bind('one', 'old-model')
  const second = store.bind('two', 'another-model')
  const windows: RateLimitWindow[] = [{ kind: 'requests', limit: 100, remaining: 70 }]
  assert.equal(store.observe(first, windows, now), true)
  assert.equal(store.observe(second, windows, now), true)
  store.invalidate('one')
  assert.equal(store.observe(first, windows, now + 1), false)
  assert.deepEqual(store.list(now).map(usage => usage.connectionId), ['two'])
  assert.equal(store.observe(store.bind('one', 'new-model'), windows, now + 1), true)
  assert.equal(store.list(now + 1).find(usage => usage.connectionId === 'one')?.model, 'new-model')
  assert.deepEqual(store.list(now + 300_001), [])
})

test('the model transport reports limits on successful and exhausted responses without exposing other headers', async context => {
  let status = 200
  const observed: RateLimitWindow[][] = []
  context.mock.method(globalThis, 'fetch', async () => new Response(
    status === 200 ? '' : JSON.stringify({ error: { code: 'rate_limit_exceeded' } }),
    { status, headers: {
      'x-ratelimit-limit-requests': '100',
      'x-ratelimit-remaining-requests': status === 200 ? '70' : '0',
      'authorization': 'fixture-secret'
    } }
  ))
  const options = {
    connection: { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'test' },
    signal: new AbortController().signal,
    onText() {}, onReasoning() {}, onRateLimits: (windows: RateLimitWindow[]) => observed.push(windows)
  }
  await modelRequest(options, 'responses', {})
  status = 429
  await assert.rejects(modelRequest(options, 'chat/completions', {}), HarnessError)
  assert.deepEqual(observed, [
    [{ kind: 'requests', limit: 100, remaining: 70 }],
    [{ kind: 'requests', limit: 100, remaining: 0 }]
  ])
  assert.equal(JSON.stringify(observed).includes('fixture-secret'), false)
})
