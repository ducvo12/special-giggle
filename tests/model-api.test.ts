import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { listModels, listModelCatalog, safely } from '../src/backend/models/api.ts'

test('model discovery sends authentication, retains metadata, and handles failures without exposing provider details', async () => {
  let status = 200
  let body = JSON.stringify({ data: [{ id: 'test-model', supported_reasoning_levels: ['medium', 'high'], default_reasoning_level: 'medium' }] })
  const server = createServer((request, response) => {
    assert.equal(request.method, 'GET')
    assert.equal(request.url, '/v1/models')
    assert.equal(request.headers.authorization, 'Bearer test-key')
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json')
    response.end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const connection = {
    baseUrl: `http://127.0.0.1:${address.port}/v1/`,
    apiKey: 'test-key',
    model: 'test-model'
  }

  try {
    assert.deepEqual(await listModels(connection), ['test-model'])
    assert.deepEqual(await listModelCatalog(connection), [{
      id: 'test-model', name: 'test-model',
      reasoningLevels: [{ effort: 'medium' }, { effort: 'high' }],
      defaultReasoningLevel: 'medium'
    }])
    status = 401
    body = '{"error":"private provider detail"}'
    const result = await safely(() => listModels(connection))
    assert.equal(result.ok, false)

    if (!result.ok) {
      assert.match(result.error, /401/)
      assert.doesNotMatch(result.error, /private provider detail/)
    }

    status = 200
    body = 'private provider detail'
    await assert.rejects(listModels(connection), error => {
      assert.match(String(error), /did not return JSON/)
      assert.doesNotMatch(String(error), /private provider detail/)
      return true
    })
    body = '{"data":{}}'
    await assert.rejects(listModels(connection), /unexpected model list/)

    assert.equal(
      (await safely(() => listModels({ ...connection, baseUrl: 'file:///tmp' }))).ok,
      false
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    )
  }
})
