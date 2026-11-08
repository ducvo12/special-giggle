import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { atomicJson } from '../src/backend/auth/storage.ts'

test('failed or cancelled JSON publication cleans staging and preserves prior data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-json-publish-'))
  try {
    await atomicJson(directory, 'saved.json', { value: 'Original' })
    const signal = new AbortController()
    signal.abort()
    await assert.rejects(atomicJson(directory, 'saved.json', { value: 'Obsolete' }, signal.signal))
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'saved.json'), 'utf8')), { value: 'Original' })
    const duringStaging = new AbortController()
    await assert.rejects(atomicJson(directory, 'saved.json', {
      toJSON() { duringStaging.abort(); return { value: 'Cancelled while staging' } }
    }, duringStaging.signal))
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'saved.json'), 'utf8')), { value: 'Original' })
    await mkdir(join(directory, 'blocked.json'))
    await assert.rejects(atomicJson(directory, 'blocked.json', {}))
    assert.deepEqual((await readdir(directory)).sort(), ['blocked.json', 'saved.json'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
