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
