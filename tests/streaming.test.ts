import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readEventStream, streamChat } from '../src/backend/model-api.ts'

function chunks(text: string, step = 1) {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += step) controller.enqueue(bytes.slice(offset, offset + step))
    controller.close()
  } })
}

test('SSE handles fragmented UTF-8, CRLF, comments, and terminal markers', async () => {
  const events = ': keepalive\r\ndata: {"choices":[{"delta":{"content":"Hi 🌲"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" there"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
  let output = ''
  await readEventStream(chunks(events), text => { output += text })
  assert.equal(output, 'Hi 🌲 there')
})

test('SSE rejects premature EOF and provider errors while retaining partial output', async () => {
  let output = ''
  await assert.rejects(readEventStream(chunks('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'), text => { output += text }), /before the reply finished/)
  assert.equal(output, 'partial')
  await assert.rejects(readEventStream(chunks('data: {"error":{"message":"secret detail"}}\n\n'), () => {}), /server reported an error/)
  await assert.rejects(readEventStream(chunks('data: invalid\n\n'), () => {}), /invalid streaming event/)
})

test('streaming API sends clean history and abort disconnects the response', async () => {
  let disconnected!: () => void
  const closed = new Promise<void>(resolve => { disconnected = resolve })
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body)
    assert.equal(payload.stream, true)
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'Hello' }])
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
    response.on('close', disconnected)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const controller = new AbortController()
  let output = ''
  try {
    await assert.rejects(streamChat({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'test', apiKey: '' }, [{ role: 'user', content: 'Hello', model: 'not-for-api' }], controller.signal, text => { output += text; controller.abort() }), { name: 'AbortError' })
    assert.equal(output, 'first')
    await closed
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
