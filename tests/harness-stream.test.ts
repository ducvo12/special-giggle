import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readModelEvents } from '../src/backend/harness/providers/stream.ts'

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
