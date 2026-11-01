import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentMessage } from '../src/shared/agent.ts'
import type { ContextReference } from '../src/shared/context.ts'
import { groupSources, replyQuestions } from '../src/renderer/src/features/chat/context-sources.ts'

const message = (id: string, conversationId: string, title = 'What is my favorite color?'): ContextReference => ({
  id: `message:${id}`, messageId: id, conversationId, title, revision: 'revision', kind: 'message'
})

test('source directory groups messages/summaries by chat ID, keeping identical chat titles distinct', () => {
  const original = message('original', 'a')
  const sources: ContextReference[] = [original, message('echo', 'a'), { ...message('summary', 'a'), id: 'summary:a', messageId: undefined, kind: 'summary' },
    message('other-chat', 'b'), { id: 'memory', title: '/memory.md', path: '/memory.md', revision: 'v1', kind: 'memory' }, original]
  const groups = groupSources(sources)
  assert.equal(groups.length, 3)
  assert.equal(groups[0].kind, 'chat')
  assert.deepEqual(groups[0].sources.map(source => source.id), ['message:original', 'message:echo', 'summary:a'])
  assert.equal(groups[1].title, groups[0].title)
  assert.notEqual(groups[1].key, groups[0].key)
  assert.equal(groups[2].title, 'Memory')
  assert.equal(sources.length, 6, 'grouping preserves the stored retrieval record')
})

test('current run questions and steering are omitted without hiding earlier history in the same chat', () => {
  const messages: AgentMessage[] = [
    { id: 'old-question', role: 'user', content: 'My favorite color is pink', runId: 'old' },
    { id: 'old-reply', role: 'assistant', content: 'Saved', runId: 'old' },
    { id: 'question', role: 'user', content: 'What color?', runId: 'current' },
    { id: 'partial', role: 'assistant', content: 'Let me look', runId: 'current' },
    { id: 'steer', role: 'user', content: 'Check the old chat too', runId: 'current' },
    { id: 'reply', role: 'assistant', content: 'Pink', runId: 'current' }
  ]
  const sources = [message('old-question', 'here'), message('question', 'here'), { ...message('steer', 'here'), messageId: undefined }]
  const groups = groupSources(sources, replyQuestions(messages).get('reply'))
  assert.deepEqual(groups.flatMap(group => group.sources.map(source => source.messageId)), ['old-question'])
  assert.equal(sources.length, 3)
  assert.equal(groupSources([sources[1]], replyQuestions(messages).get('reply')).length, 0)
})

test('legacy replies exclude only their preceding question and retain separate knowledge files', () => {
  const messages: AgentMessage[] = [
    { id: 'first', role: 'user', content: 'First question' },
    { id: 'first-answer', role: 'assistant', content: 'First answer' },
    { id: 'latest', role: 'user', content: 'Current question' },
    { id: 'answer', role: 'assistant', content: 'Current answer' }
  ]
  const sources: ContextReference[] = [message('first', 'here'), message('latest', 'here'),
    { id: 'note:a', kind: 'note', path: '/notes/research.md', title: 'Research', revision: 'a' },
    { id: 'note:b', kind: 'note', path: '/sections/one/notes/research.md', title: 'Research', revision: 'b' }]
  const groups = groupSources(sources, replyQuestions(messages).get('answer'))
  assert.equal(groups.length, 3)
  assert.equal(groups[0].sources[0].messageId, 'first')
  assert.notEqual(groups[1].key, groups[2].key)
  assert.equal(groups[2].title, '/sections/one/notes/research.md')
})
