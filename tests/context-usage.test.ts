import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseContextUsage } from '../src/backend/models/usage.ts'
import { contextMetadata } from '../src/backend/models/catalog.ts'
import { responsesAdapter } from '../src/backend/harness/providers/responses.ts'
import { chatCompletionsAdapter } from '../src/backend/harness/providers/chat-completions.ts'
import type { ContextUsage } from '../src/shared/chat.ts'

test('context metadata uses provider limits and never invents unknown model capacity', () => {
  assert.deepEqual(contextMetadata({ effective_context_window: 200000, context_window: 250000, max_output_tokens: 10000 }), { contextWindow: 200000, maxOutputTokens: 10000 })
  assert.deepEqual(contextMetadata({ context_length: 32000 }), { contextWindow: 32000 })
  assert.deepEqual(contextMetadata({ context_window: -1, max_output_tokens: Infinity }), {})
  assert.deepEqual(contextMetadata({}), {})
})

test('usage normalization handles both protocols, cached zeroes, reasoning, and malformed values', () => {
  assert.deepEqual(parseContextUsage({ input_tokens: 100, output_tokens: 40, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 30 } }), {
    inputTokens: 100, outputTokens: 40, totalTokens: 140, cachedTokens: 0, reasoningTokens: 30
  })
  assert.deepEqual(parseContextUsage({ prompt_tokens: 100, completion_tokens: 20 }), { inputTokens: 100, outputTokens: 20, totalTokens: 120 })
  for (const usage of [undefined, {}, { input_tokens: -1, output_tokens: 1 }, { input_tokens: '20', output_tokens: 1 }]) assert.equal(parseContextUsage(usage), undefined)
})

function events(items: unknown[]) {
  return new Response(items.map(item => `data: ${typeof item === 'string' ? item : JSON.stringify(item)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}

test('Responses reports per-step usage, rather than accumulating overlapping context', async context => {
  const usage: ContextUsage[] = []
  context.mock.method(globalThis, 'fetch', async () => events([
    { type: 'response.output_text.delta', delta: 'Hello' },
    { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 200, output_tokens: 30 } } }
  ]))
  const adapter = responsesAdapter({ connection: { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'test' }, signal: new AbortController().signal, onText() {}, onReasoning() {}, onUsage: item => usage.push(item) })
  await adapter.step([], '', [])
  await adapter.step([], '', [])
  assert.deepEqual(usage, [{ inputTokens: 200, outputTokens: 30, totalTokens: 230 }, { inputTokens: 200, outputTokens: 30, totalTokens: 230 }])
})

test('Chat Completions reads the usage chunk after finish_reason and supports providers omitting DONE', async context => {
  const usage: ContextUsage[] = []
  let includeDone = true
  context.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(JSON.parse(String(init.body)).stream_options.include_usage, true)
    return events([
      { choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } },
      ...(includeDone ? ['[DONE]'] : [])
    ])
  })
  const adapter = chatCompletionsAdapter({ connection: { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'test' }, signal: new AbortController().signal, onText() {}, onReasoning() {}, onUsage: item => usage.push(item) })
  assert.equal((await adapter.step([], '', [])).text, 'Hello')
  includeDone = false
  assert.equal((await adapter.step([], '', [])).text, 'Hello')
  assert.deepEqual(usage, [{ inputTokens: 50, outputTokens: 10, totalTokens: 60 }, { inputTokens: 50, outputTokens: 10, totalTokens: 60 }])
})
