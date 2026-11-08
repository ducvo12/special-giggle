import type { IpcCalls, WorkerRequest } from '../src/shared/ipc.ts'
import type { AgentDeletionResult } from '../src/shared/agent.ts'
import type { Result } from '../src/shared/chat.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('worker and renderer contracts retain checked actions, tuples and result types', () => {
  const request: WorkerRequest = { id: 'request', action: 'workspace:save', args: ['agent', '/notes/a.md', 'content', null] }
  // @ts-expect-error Unknown worker actions cannot be sent.
  const unknown: WorkerRequest = { id: 'request', action: 'unknown', args: [] }
  // @ts-expect-error File saves need their expected revision/content.
  const incomplete: WorkerRequest = { id: 'request', action: 'workspace:save', args: ['agent'] }
  type Deletion = Awaited<ReturnType<IpcCalls['agents:delete']>>
  const deletion: Deletion = { ok: true, value: { cleanupPending: true } }
  const result: Result<AgentDeletionResult> = deletion
  assert.equal(request.action, 'workspace:save')
  assert.equal(result.value.cleanupPending, true)
  void unknown
  void incomplete
})
