import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Conversation } from '../src/shared/agent.ts'
import type { Project, Section } from '../src/shared/organization.ts'
import { readTreeSort, sortTreeEntries } from '../src/renderer/src/app/tree-sort.ts'

const chats: Conversation[] = [
  { id: 'a', agentId: 'agent', title: 'Zebra', sectionId: 's1', projectId: null, updatedAt: 5000, createdAt: 100, lastChattedAt: 200, retention: 'permanent', expiresAt: null },
  { id: 'b', agentId: 'agent', title: 'Alpha', sectionId: 's2', projectId: 'project', updatedAt: 300, createdAt: 200, lastChattedAt: 300, retention: 'permanent', expiresAt: null },
  { id: 'c', agentId: 'agent', title: 'Empty', sectionId: 's1', projectId: null, updatedAt: 9000, createdAt: 300, lastChattedAt: null, retention: 'permanent', expiresAt: null }
]
const ids = (entries: { id: string }[]) => entries.map(entry => entry.id)
test('tree sorting distinguishes activity, creation and natural alphabetical order, in both directions', () => {
  assert.deepEqual(ids(sortTreeEntries(chats, chats, { by: 'activity', direction: 'desc' })), ['b', 'a', 'c'])
  assert.deepEqual(ids(sortTreeEntries(chats, chats, { by: 'activity', direction: 'asc' })), ['c', 'a', 'b'])
  assert.deepEqual(ids(sortTreeEntries(chats, chats, { by: 'created', direction: 'desc' })), ['c', 'b', 'a'])
  assert.deepEqual(ids(sortTreeEntries(chats, chats, { by: 'created', direction: 'asc' })), ['a', 'b', 'c'])
  assert.deepEqual(ids(sortTreeEntries(chats, chats, { by: 'name', direction: 'asc' })), ['b', 'c', 'a'])
  assert.deepEqual(ids(sortTreeEntries(chats, chats, { by: 'name', direction: 'desc' })), ['a', 'c', 'b'])
  assert.deepEqual(ids(chats), ['a', 'b', 'c'])
})
test('folder activity includes nested project chats and sorting tolerates invalid saved settings', () => {
  const sections: Section[] = ['s1', 's2', 's3'].map((id, index) => ({ id, agentId: 'agent', name: `Section ${index}`, kind: 'custom', mode: 'shared', createdAt: index }))
  assert.deepEqual(ids(sortTreeEntries(sections, chats, { by: 'activity', direction: 'desc' })), ['s2', 's1', 's3'])
  const project: Project = { id: 'project', agentId: 'agent', sectionId: 's2', name: 'Project', repositoryPath: null, createdAt: 1 }
  assert.deepEqual(ids(sortTreeEntries([project, chats[0]], chats, { by: 'activity', direction: 'desc' })), ['project', 'a'])
  for (const value of [null, 'bad JSON', '{}', 'null', '{"by":"invalid","direction":"asc"}']) assert.deepEqual(readTreeSort(value), { by: 'activity', direction: 'desc' })
  assert.deepEqual(readTreeSort('{"by":"name","direction":"asc"}'), { by: 'name', direction: 'asc' })
})
