import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountModelCatalog } from '../src/backend/models/account-catalog.ts'
import type { Connection, ModelOption } from '../src/shared/chat.ts'

const connection = (accountId = 'account-a', model = 'model-a'): Connection => ({
  provider: 'chatgpt', accountId, model, baseUrl: '', apiKey: '', effort: 'high'
})

test('startup discovery is shared by model pickers and repeated messages for each account', async () => {
  const calls: string[] = []
  const cache = new AccountModelCatalog({
    async modelCatalog(id) { calls.push(id); return [{ id: 'model-a', name: id }] },
    async resolve() { return 'mock-token' }
  })
  await cache.warm(['account-a', 'account-b', 'account-a'])
  assert.deepEqual(calls, ['account-a', 'account-b'])
  for (let i = 0; i < 3; i++) {
    const draft = connection()
    await cache.prepare(draft)
    assert.equal(draft.baseUrl, 'https://api.openai.com/v1')
    assert.equal(draft.protocol, 'responses')
    assert.equal(draft.effort, 'high')
    assert.equal(draft.apiKey, 'mock-token')
    assert.equal((await cache.get('account-a'))[0].name, 'account-a')
  }
  assert.equal(calls.length, 2, 'messages must not fetch the catalog again')
  const automatic = connection('account-b', '')
  await cache.prepare(automatic)
  assert.equal(automatic.model, 'model-a')
})

test('manual refresh replaces availability; stale models are rejected without an inference or extra lookup', async () => {
  let models = [{ id: 'model-a', name: 'First' }]
  let calls = 0
  let tokens = 0
  const cache = new AccountModelCatalog({
    async modelCatalog() { calls++; return models },
    async resolve() { tokens++; return 'mock-token' }
  })
  await cache.warm(['account-a'])
  models = [{ id: 'model-b', name: 'Second' }]
  assert.equal((await cache.get('account-a'))[0].id, 'model-a')
  await cache.get('account-a', true)
  await assert.rejects(cache.prepare(connection()), /no longer available/)
  assert.equal(tokens, 0)
  await cache.prepare(connection('account-a', 'model-b'))
  assert.equal(tokens, 1)
  assert.equal(calls, 2)
})

test('overlapping startup, picker, and refresh requests share one fetch and returned data cannot mutate the cache', async () => {
  let complete!: (models: ModelOption[]) => void
  let calls = 0
  const cache = new AccountModelCatalog({
    modelCatalog() { calls++; return new Promise(resolve => { complete = resolve }) },
    async resolve() { return 'mock-token' }
  })
  const startup = cache.warm(['account-a'])
  const picker = cache.get('account-a')
  const refresh = cache.get('account-a', true)
  await Promise.resolve()
  assert.equal(calls, 1)
  complete([{ id: 'model-a', name: 'First' }])
  await startup
  const returned = await picker
  returned[0].name = 'Changed'
  assert.equal((await refresh)[0].name, 'First')
  assert.equal((await cache.get('account-a'))[0].name, 'First')
})

test('failed startup is surfaced without automatic repeated discovery; explicit refresh retries it', async () => {
  let calls = 0
  const cache = new AccountModelCatalog({
    async modelCatalog() { if (++calls === 1) throw new Error('offline'); return [{ id: 'model-a', name: 'First' }] },
    async resolve() { return 'mock-token' }
  })
  assert.equal((await cache.warm(['account-a']))[0].status, 'rejected')
  await assert.rejects(cache.get('account-a'), /offline/)
  await assert.rejects(cache.prepare(connection()), /offline/)
  assert.equal(calls, 1)
  await cache.get('account-a', true)
  await cache.prepare(connection())
  assert.equal(calls, 2)
})

test('only model-access failures refresh the account, and sign-in changes discard previous availability', async () => {
  let calls = 0
  const cache = new AccountModelCatalog({
    async modelCatalog() { return [{ id: `model-${++calls}`, name: 'Available' }] },
    async resolve() { return 'mock-token' }
  })
  await cache.warm(['account-a'])
  await cache.refreshAfterError(connection(), { ok: true, value: undefined })
  await cache.refreshAfterError(connection(), { ok: false, error: 'HTTP 429' })
  await cache.refreshAfterError({ ...connection(), provider: 'openai' }, { ok: false, error: 'Denied', code: 'model_access' })
  assert.equal(calls, 1)
  await cache.refreshAfterError(connection(), { ok: false, error: 'Denied', code: 'model_access' })
  assert.equal((await cache.get('account-a'))[0].id, 'model-2')
  cache.invalidate('account-a')
  assert.equal((await cache.get('account-a'))[0].id, 'model-3')
  assert.equal(calls, 3)
})

test('a failed recovery refresh preserves the original model error and can be retried manually', async () => {
  let fail = false
  const cache = new AccountModelCatalog({
    async modelCatalog() { if (fail) throw new Error('catalog offline'); return [{ id: 'model-a', name: 'First' }] },
    async resolve() { return 'mock-token' }
  })
  await cache.warm(['account-a'])
  fail = true
  await cache.refreshAfterError(connection(), { ok: false, error: 'Model denied', code: 'model_access' })
  await assert.rejects(cache.get('account-a'), /catalog offline/)
  fail = false
  assert.equal((await cache.get('account-a', true))[0].id, 'model-a')
})
