import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modelRequest } from '../src/backend/harness/providers/http.ts'
import { ModelAccessError } from '../src/backend/harness/types.ts'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'

const connection = { provider: 'chatgpt' as const, baseUrl: 'https://api.openai.com/v1',
  model: 'model-a', apiKey: 'mock-token', accountId: 'account-a', protocol: 'responses' as const }

test('model access errors are distinguishable from auth, quota, malformed requests, and service failures', async context => {
  let status = 404
  let error: any = { code: 'model_not_found', message: 'private provider detail' }
  context.mock.method(globalThis, 'fetch', async () => Response.json({ error }, { status }))
  const options = { connection, signal: new AbortController().signal, onText() {}, onReasoning() {} }
  for (const [http, payload, access] of [
    [404, { code: 'model_not_found' }, true],
    [403, { code: 'permission_denied' }, true],
    [400, { param: 'model', code: 'invalid_request_error' }, true],
    [400, { param: 'service_tier', code: 'invalid_request_error' }, false],
    [401, { code: 'invalid_api_key' }, false],
    [429, { code: 'insufficient_quota' }, false],
    [503, { code: 'server_error' }, false]
  ] as const) {
    status = http
    error = { ...payload, message: 'private provider detail' }
    await assert.rejects(modelRequest(options, 'responses', {}), failure => {
      assert.equal(failure instanceof ModelAccessError, access)
      assert.doesNotMatch(String(failure), /private provider detail/)
      return true
    })
  }
})

test('HTTP and streamed model denials retain their type through the runtime without retrying generation', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-model-access-'))
  const runtime = await AgentRuntime.open(directory)
  let streamed = false
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (!streamed) return Response.json({ error: { code: 'model_not_found', message: 'private provider detail' } }, { status: 404 })
    return new Response('data: {"type":"response.output_text.delta","delta":"Partial answer"}\n\n' +
      'data: {"type":"response.failed","response":{"error":{"code":"model_not_found","message":"private provider detail"}}}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } })
  })
  try {
    const agent = await runtime.createAgent('Model access')
    for (const mode of [false, true]) {
      streamed = mode
      const chat = await runtime.createConversation(agent.id)
      let text = ''
      await assert.rejects(runtime.run(`model-access-${mode}`, agent.id, chat.id, connection, 'Hello', delta => {
        text += delta.text
      }), ModelAccessError)
      assert.equal(text, mode ? 'Partial answer' : '')
      const reply = runtime.store.get(agent.id, chat.id).messages.at(-1)!
      assert.equal(reply.status, 'error')
      assert.doesNotMatch(reply.error ?? '', /private provider detail/)
    }
    assert.equal(calls, 2, 'an access denial must not automatically resend generation')
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})
