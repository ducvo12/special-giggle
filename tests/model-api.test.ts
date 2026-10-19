import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chat, listModels, safely } from '../src/backend/models/api.ts'

test('API adapter discovers models, sends history and authentication, and handles failures', async () => {
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer test-key')
    response.setHeader('Content-Type', 'application/json')

    if (request.url === '/v1/models') {
      return response.end(JSON.stringify({ data: [{ id: 'test-model' }] }))
    }

    let body = ''

    for await (const chunk of request) {
      body += chunk
    }

    const payload = JSON.parse(body)
    assert.equal(request.url, '/v1/chat/completions')
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'Hello' }])

    if (payload.model === 'bad-model') {
      response.statusCode = 401

      return response.end('{"error":"private provider detail"}')
    }

    assert.equal(payload.stream, false)
    response.end(
      JSON.stringify({ choices: [{ message: { content: 'Hello from the mock model' } }] })
    )
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
    assert.equal(
      await chat(connection, [{ role: 'user', content: 'Hello' }]),
      'Hello from the mock model'
    )
    const result = await safely(() =>
      chat({ ...connection, model: 'bad-model' }, [{ role: 'user', content: 'Hello' }])
    )
    assert.equal(result.ok, false)

    if (!result.ok) {
      assert.match(result.error, /401/)
      assert.doesNotMatch(result.error, /private provider detail/)
    }

    assert.equal(
      (await safely(() => listModels({ ...connection, baseUrl: 'file:///tmp' }))).ok,
      false
    )
    assert.equal((await safely(() => chat(connection, []))).ok, false)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    )
  }
})
