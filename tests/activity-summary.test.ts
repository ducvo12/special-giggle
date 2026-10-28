import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RepositoryReport, RepositoryCommandSnapshot } from '../src/shared/repository.ts'
import { activePreviews, activitySummary } from '../src/renderer/src/features/chat/activity-summary.ts'

function report(runId: string, added: number, state: RepositoryReport['state'] = 'settled'): RepositoryReport {
  return { runId, projectId: 'project', name: 'Project', state, preExisting: 0,
    changes: [{ path: 'file.ts', kind: 'modified', binary: false, added, removed: 2, diff: '+example' }] }
}
function command(id: string, status: RepositoryCommandSnapshot['status']): RepositoryCommandSnapshot {
  return { id, status, command: `command ${id}`, cwd: '/', interactive: false, publication: 'applied', inputRevision: 1, output: '' }
}

test('activity uses the latest change totals and preserves older outcomes needing review', () => {
  const old = report('old', 100)
  const attention = report('attention', 10, 'attention')
  const latest = report('latest', 3)
  const summary = activitySummary([old, attention, latest])
  assert.equal(summary.added, 3)
  assert.equal(summary.removed, 2)
  assert.deepEqual(summary.visible.map(item => item.runId), ['attention', 'latest'])
  const empty = activitySummary([])
  assert.equal(empty.added, 0)
  assert.equal(empty.removed, 0)
  assert.deepEqual(empty.active, [])
})

test('active terminals stay visible even when newer commands complete', () => {
  const older = { ...report('older', 0), commands: [command('active', 'running'), command('starting', 'starting'), command('publishing', 'publishing')] }
  const latest = { ...report('latest', 0), commands: Array.from({ length: 8 }, (_, i) => command(`${i}`, 'complete')) }
  const summary = activitySummary([older, latest])
  assert.equal(summary.active.length, 3)
  assert.deepEqual(summary.active.map(item => item.id), ['active', 'starting', 'publishing'])
  assert.equal(summary.active[0].runId, 'older')
})

test('inactive terminal processes and apps are excluded', () => {
  const item = { ...report('run', 0), commands: [command('done', 'complete'), command('failed', 'failed'), command('stopped', 'stopped')] }
  assert.deepEqual(activitySummary([item]).active, [])
  const previews = (['starting', 'ready', 'failed', 'stopped', 'interrupted'] as const).map(status => ({
    id: status, agentId: 'agent', conversationId: 'chat', projectId: 'project', runId: 'run', command: 'npm run dev',
    cwd: '/', port: 3000, url: 'http://localhost:3000', status, revision: '', capturedAt: 0, stale: false, output: ''
  }))
  assert.deepEqual(activePreviews(previews).map(item => item.id), ['starting', 'ready'])
})
