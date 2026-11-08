import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readModelEvents } from '../src/backend/harness/providers/stream.ts'
import { chatCompletionsAdapter } from '../src/backend/harness/providers/chat-completions.ts'

function responseFor(text: string, contentType?: string) {
  const bytes = new TextEncoder().encode(text)

  return new Response(new ReadableStream({
    start(controller) {
      // Split every byte to exercise fragmented fields, delimiters, and UTF-8.
      for (const byte of bytes) {
        controller.enqueue(Uint8Array.of(byte))
      }

      controller.close()
    }
  }), { headers: contentType ? { 'Content-Type': contentType } : {} })
}

test('harness accepts headerless SSE and still requires its completion event', async () => {
  const events: any[] = []
  const response = responseFor(
    '\uFEFF\r\n: keepalive\r\nevent: response.output_text.delta\r\n' +
    'data: {"type":"response.output_text.delta","delta":"Hello 🌱"}\r\n\r\n' +
    'data: {"type":"response.completed","response":{"status":"completed"}}\r\n\r\n'
  )
  assert.equal(response.headers.get('content-type'), null)
  await readModelEvents(response, event => {
    events.push(event)

    return event.type === 'response.completed'
  })
  assert.equal(events[0].delta, 'Hello 🌱')
  assert.equal(events[1].response.status, 'completed')
})

test('harness handles SSE media type casing and charset parameters', async () => {
  const response = responseFor('data: {"type":"response.completed"}\n\n', 'Text/Event-Stream; charset=utf-8')
  await readModelEvents(response, event => event.type === 'response.completed')
})

test('harness rejects headerless HTML and JSON without exposing response bodies', async () => {
  for (const body of ['<!DOCTYPE html><html>private-error-detail</html>', '{"secret":"private-error-detail"}']) {
    await assert.rejects(
      readModelEvents(responseFor(body), () => assert.fail('No event should be dispatched')),
      error => /valid event stream/.test(String(error)) && !String(error).includes('private-error-detail')
    )
  }

  await assert.rejects(
    readModelEvents(responseFor('{"status":"completed"}', 'application/json'), () => true),
    /did not return an event stream/
  )
})

test('headerless SSE disconnects and invalid events remain failures', async () => {
  let partial = ''
  await assert.rejects(
    readModelEvents(responseFor('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n'), event => {
      partial += event.delta

      return false
    }),
    /before the model finished/
  )
  assert.equal(partial, 'Partial')
  await assert.rejects(
    readModelEvents(responseFor('data: invalid-json\n\n'), () => false),
    /invalid stream/
  )
})

test('Chat Completions separates reasoning from fragmented UTF-8 answers and native history', async context => {
  const events = [
    { choices: [{ delta: { reasoning_content: 'considering' } }] },
    { choices: [{ delta: { reasoning: ' options' } }] },
    { choices: [{ delta: { content: 'Hi 🌲' } }] },
    { choices: [{ delta: { content: ' there' }, finish_reason: 'stop' }] }
  ]
  const stream = ': keepalive\r\n' + events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
  context.mock.method(globalThis, 'fetch', async () => responseFor(stream, 'text/event-stream'))
  let text = ''
  let reasoningCharacters = 0
  const adapter = chatCompletionsAdapter({
    connection: { baseUrl: 'http://localhost/v1', model: 'test', apiKey: '' },
    signal: new AbortController().signal,
    onText: delta => { text += delta },
    onReasoning: count => { reasoningCharacters += count }
  })

  const result = await adapter.step([], '', [])

  assert.equal(text, 'Hi 🌲 there')
  assert.equal(result.text, text)
  assert.equal(reasoningCharacters, 19)
  assert.deepEqual(result.output, [{ role: 'assistant', content: text }])
})

test('Chat Completions keeps partial output when completion is missing, limited, or a provider error', async context => {
  const endings = [
    { event: '', error: /before the model finished/ },
    { event: { choices: [{ delta: {}, finish_reason: 'length' }] }, error: /output limit/ },
    { event: { error: { message: 'private-provider-detail' } }, error: /server reported an error/ }
  ]
  let ending: unknown
  context.mock.method(globalThis, 'fetch', async () => responseFor(
    'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n' +
    (ending ? `data: ${JSON.stringify(ending)}\n\n` : ''),
    'text/event-stream'
  ))

  for (const scenario of endings) {
    ending = scenario.event
    let text = ''
    const adapter = chatCompletionsAdapter({
      connection: { baseUrl: 'http://localhost/v1', model: 'test', apiKey: '' },
      signal: new AbortController().signal,
      onText: delta => { text += delta },
      onReasoning() {}
    })

    await assert.rejects(adapter.step([], '', []), error => {
      assert.match(String(error), scenario.error)
      assert.doesNotMatch(String(error), /private-provider-detail/)
      return true
    })
    assert.equal(text, 'Partial')
  }
})

test('active Chat Completions transport sends authenticated native history and abort disconnects it', { timeout: 5000 }, async () => {
  let disconnected!: () => void
  const closed = new Promise<void>(resolve => { disconnected = resolve })
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    assert.equal(request.url, '/v1/chat/completions')
    assert.equal(request.headers.authorization, 'Bearer test-key')
    assert.equal(body.stream, true)
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'Instructions' },
      { role: 'user', content: 'Hello' }
    ])
    response.on('close', disconnected)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const controller = new AbortController()
  let text = ''
  const adapter = chatCompletionsAdapter({
    connection: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'test', apiKey: 'test-key' },
    signal: controller.signal,
    onText: delta => {
      text += delta
      controller.abort()
    },
    onReasoning() {}
  })

  try {
    await assert.rejects(adapter.step([adapter.user('Hello')], 'Instructions', []), /connection was interrupted/)
    assert.equal(text, 'first')
    assert.equal(controller.signal.aborted, true)
    await closed
  } finally {
    controller.abort()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
