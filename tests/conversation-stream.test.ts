import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyStreamDelta } from '../src/renderer/src/app/conversation-stream.ts'
import type { AgentMessage } from '../src/shared/agent.ts'

const snapshot = (): AgentMessage[] => [
  { id: 'question', role: 'user', content: 'Hello' },
  { id: 'run', role: 'assistant', content: '', status: 'running', tools: [] }
]

test('streamed text, tools and context usage accumulate on the running reply', () => {
  const original = snapshot()
  let messages = applyStreamDelta(original, { requestId: 'run', text: 'First' })
  messages = applyStreamDelta(messages, { requestId: 'run', text: ' second' })
  messages = applyStreamDelta(messages, { requestId: 'run', text: '', tool: { id: 'tool', name: 'read', input: '{}', status: 'running' } })
  messages = applyStreamDelta(messages, { requestId: 'run', text: '', tool: { id: 'tool', name: 'read', input: '{}', output: 'result', status: 'complete' }, contextUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } })
  assert.equal(messages[1].content, 'First second')
  assert.equal(messages[1].tools?.length, 1)
  assert.equal(messages[1].tools?.[0].output, 'result')
  assert.equal(messages[1].contextUsage?.totalTokens, 15)
  assert.equal(messages[0], original[0])
  assert.equal(original[1].content, '', 'snapshots already shown by React remain immutable')
})

test('stale request events cannot modify the active reply or any other assistant message', () => {
  const history: AgentMessage = { id: 'history', role: 'assistant', content: 'Earlier' }
  const original = [history, ...snapshot()]
  assert.equal(applyStreamDelta(original, { requestId: 'old-run', text: 'wrong' }), original)
  const messages = applyStreamDelta(original, { requestId: 'run', text: 'Answer' })
  assert.equal(messages[0], history)
  assert.equal(messages[2].content, 'Answer')
  assert.equal(original[2].content, '')
})
