import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialHistory, rebuildHistory } from '../src/backend/harness/history.ts'
import { chatCompletionsAdapter } from '../src/backend/harness/providers/chat-completions.ts'
import { responsesAdapter } from '../src/backend/harness/providers/responses.ts'
import type { NativeItem } from '../src/backend/harness/types.ts'

for (const [protocol, factory] of [['chat-completions', chatCompletionsAdapter], ['responses', responsesAdapter]] as const) {
  test(`${protocol} history retains native action/result pairs, evicts retrieved tails and clones saved state`, () => {
    const model = factory({ connection: { baseUrl: '', model: 'test', apiKey: '' }, signal: new AbortController().signal, onText() {}, onReasoning() {} })
    const batch: NativeItem[] = protocol === 'responses'
      ? [{ type: 'function_call', call_id: 'one', name: 'repo_edit', arguments: '{}' }, { type: 'function_call_output', call_id: 'one', output: 'Done' }]
      : [{ role: 'assistant', tool_calls: [{ id: 'one', function: { name: 'repo_edit', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'one', content: 'Done' }]
    const state = [model.user('Obsolete context'), ...batch]
    const cloned = initialHistory([], state, model)
    if (protocol === 'responses') cloned[0].content[0].text = 'Changed clone'
    else cloned[0].content = 'Changed clone'
    assert.deepEqual(state[0], model.user('Obsolete context'))
    assert.deepEqual(rebuildHistory([], state, model), batch)
    if (protocol === 'responses') batch[0].name = 'read_context'
    else batch[0].tool_calls[0].function.name = 'read_context'
    assert.deepEqual(rebuildHistory([], state, model), [])
    const history = initialHistory([
      { id: 'pending', role: 'user', content: 'Not processed', delivery: 'pending' },
      { id: 'cancelled', role: 'user', content: 'Cancelled', delivery: 'cancelled' },
      { id: 'reply', role: 'assistant', content: 'Provisional', interrupted: true }
    ], undefined, model)
    assert.equal(history.length, 1)
    assert.match(JSON.stringify(history), /Interrupted reply; not a completed answer/)
  })
}
