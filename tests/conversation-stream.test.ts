import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConversationStream } from '../src/renderer/src/app/conversation-stream.ts'
import type { AgentMessage } from '../src/shared/agent.ts'

const snapshot = (): AgentMessage[] => [
  { id: 'question', role: 'user', content: 'Hello' },
  { id: 'run', role: 'assistant', content: '', status: 'running', tools: [] }
]

test('streaming reply remains isolated when another chat is visible and resumes from its full snapshot', () => {
  const stream = new ConversationStream('run', 'atlas', 'chat-a', snapshot())
  let visible = stream.messages
  const other: AgentMessage[] = [{ id: 'other-answer', role: 'assistant', content: 'Unrelated answer' }]
  stream.apply({ requestId: 'run', text: 'First' })
  visible = other
  stream.apply({ requestId: 'run', text: ' second' })
  stream.apply({ requestId: 'run', text: '', tool: { id: 'tool', name: 'read', input: '{}', status: 'running' } })
  stream.apply({ requestId: 'run', text: '', tool: { id: 'tool', name: 'read', input: '{}', output: 'result', status: 'complete' }, contextUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } })
  assert.equal(visible, other)
  assert.equal(visible[0].content, 'Unrelated answer')
  assert.equal(stream.matches('atlas', 'chat-b'), false)
  assert.equal(stream.matches('different-agent', 'chat-a'), false)
  assert.equal(stream.matches('atlas', 'chat-a'), true)
  visible = stream.messages
  assert.equal(visible[1].content, 'First second')
  assert.equal(visible[1].tools?.length, 1)
  assert.equal(visible[1].tools?.[0].output, 'result')
  assert.equal(visible[1].contextUsage?.totalTokens, 15)
  assert.equal(visible[0].content, 'Hello')
})

test('stale request events cannot modify the active reply or any other assistant message', () => {
  const history: AgentMessage = { id: 'history', role: 'assistant', content: 'Earlier' }
  const stream = new ConversationStream('run', 'atlas', '', [history, ...snapshot()])
  const original = stream.messages
  stream.apply({ requestId: 'old-run', text: 'wrong' })
  assert.equal(stream.messages, original)
  stream.conversationId = 'new-chat'
  assert.equal(stream.matches('atlas', ''), false)
  stream.apply({ requestId: 'run', text: 'Answer' })
  assert.equal(stream.messages[0], history)
  assert.equal(stream.messages[2].content, 'Answer')
  assert.equal(original[2].content, '', 'snapshots already shown by React remain immutable')
})
