import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConnectionStore } from '../src/backend/connections/store.ts'

// Test double: exercises credential boundaries without accessing the OS keychain.
const secrets = {
  available: () => true,
  encrypt: (text: string) => Buffer.from(text.split('').reverse().join('')),
  decrypt: (data: Buffer) => data.toString().split('').reverse().join('')
}

const draft = {
  name: 'Desktop',
  baseUrl: 'http://127.0.0.1:1234/v1',
  apiKey: 'sensitive-test-key',
  model: 'local-model'
}

test('saved connections survive reload, hide keys, preserve edits, and delete cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-connections-'))

  try {
    const store = new ConnectionStore(directory, secrets)
    const saved = await store.save(draft)
    assert.equal(saved.hasKey, true)
    assert.ok(!('apiKey' in saved) && !('encryptedKey' in saved))
    assert.doesNotMatch(
      await readFile(join(directory, 'connections.json'), 'utf8'),
      /sensitive-test-key/
    )
    const reloaded = new ConnectionStore(directory, secrets)
    assert.deepEqual(await reloaded.list(), [saved])
    assert.equal((await reloaded.resolve(saved.id)).apiKey, draft.apiKey)
    await reloaded.save({ ...draft, id: saved.id, name: 'Renamed', apiKey: '' })
    assert.equal((await reloaded.resolve(saved.id)).apiKey, draft.apiKey)
    assert.equal(
      (
        await reloaded.resolveDraft({
          ...draft,
          id: saved.id,
          baseUrl: 'http://another-server/v1',
          apiKey: ''
        })
      ).apiKey,
      ''
    )
    await assert.rejects(
      reloaded.save({ ...draft, id: saved.id, baseUrl: 'http://another-server/v1', apiKey: '' }),
      /Re-enter/
    )
    await reloaded.save({ ...draft, id: saved.id, apiKey: '', removeKey: true })
    assert.equal((await reloaded.resolve(saved.id)).apiKey, '')
    await reloaded.delete(saved.id)
    assert.deepEqual(await reloaded.list(), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('unavailable encryption and corrupt storage fail without writing credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-connections-'))

  try {
    const store = new ConnectionStore(directory, { ...secrets, available: () => false })
    await assert.rejects(store.save(draft), /Secure credential storage is unavailable/)
    assert.deepEqual(await store.list(), [])
    await store.save({ ...draft, apiKey: '' })
    await writeFile(join(directory, 'connections.json'), 'invalid')
    await assert.rejects(new ConnectionStore(directory, secrets).list(), /not been overwritten/)
    assert.equal(await readFile(join(directory, 'connections.json'), 'utf8'), 'invalid')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('one ChatGPT connection resolves different models without changing its saved default or credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-account-models-'))

  try {
    const store = new ConnectionStore(directory, secrets)
    const saved = await store.save({
      name: 'My ChatGPT account',
      provider: 'chatgpt',
      accountId: 'account-one',
      baseUrl: '',
      apiKey: '',
      model: ''
    })

    for (const model of ['account-model-a', 'account-model-b']) {
      const connection = await store.resolve(saved.id, model)
      assert.equal(connection.model, model)
      assert.equal(connection.accountId, 'account-one')
      assert.equal(connection.apiKey, '')
      assert.equal(connection.protocol, 'responses')
    }

    const restored = new ConnectionStore(directory, secrets)
    assert.deepEqual(await restored.list(), [saved])
    assert.equal((await restored.resolve(saved.id)).model, '')
    await assert.rejects(restored.resolve(saved.id, ''), /valid model/)
    await assert.rejects(restored.resolve(saved.id, 'a'.repeat(201)), /valid model/)
    const api = await store.save(draft)
    await assert.rejects(store.resolve(api.id, 'another-model'), /ChatGPT account/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('ChatGPT accounts have one connection while edits and different accounts remain allowed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-unique-accounts-'))
  try {
    const store = new ConnectionStore(directory, secrets)
    const account = { name: 'Personal', provider: 'chatgpt' as const, accountId: 'personal', baseUrl: '', apiKey: '', model: '' }
    const attempts = await Promise.allSettled([store.save(account), store.save({ ...account, name: 'Duplicate' })])
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
    const rejected = attempts.find(result => result.status === 'rejected')
    assert.match(String(rejected?.reason), /already has a connection/)
    const [saved] = await store.list()
    await store.save({ ...account, id: saved.id, name: 'Updated', model: 'default-model' })
    const other = await store.save({ ...account, accountId: 'work', name: 'Work' })
    await assert.rejects(store.save({ ...account, id: other.id }), /already has a connection/)
    assert.equal((await store.list()).length, 2)
    assert.equal((await store.resolve(saved.id)).model, 'default-model')
    const reloaded = new ConnectionStore(directory, secrets)
    await assert.rejects(reloaded.save(account), /already has a connection/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
