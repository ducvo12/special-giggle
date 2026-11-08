import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { AgentClient } from '../src/main/agent-client.ts'
import type { WorkerRequest } from '../src/shared/ipc.ts'

class Worker extends EventEmitter {
  requests: WorkerRequest[] = []
  killed = false
  postMessage(request: WorkerRequest) {
    this.requests.push(request)
    if (request.action === 'init' || request.action === 'shutdown') {
      queueMicrotask(() => this.emit('message', { id: request.id, result: { ok: true, value: true } }))
    }
  }
  kill() { this.killed = true; this.emit('exit', 0); return true }
}

test('concurrent callers share initialization, ordinary requests have no lifecycle deadline, and retired deltas are ignored', async () => {
  const children: Worker[] = []
  const deltas: unknown[] = []
  const client = new AgentClient('/unused', delta => deltas.push(delta), () => {
    const child = new Worker()
    children.push(child)
    return child
  }, { boot: 20, shutdown: 20 })
  const first = client.call('agents:list')
  const second = client.call('runs:list')
  await delay(50)
  assert.equal(children.length, 1)
  const child = children[0]
  assert.deepEqual(child.requests.map(request => request.action), ['init', 'agents:list', 'runs:list'])
  for (const request of child.requests.slice(1)) child.emit('message', { id: request.id, result: { ok: true, value: [] } })
  assert.deepEqual(await first, { ok: true, value: [] })
  assert.deepEqual(await second, { ok: true, value: [] })
  const pending = client.call('agents:list')
  await Promise.resolve()
  child.emit('exit', 1)
  assert.equal((await pending).ok, false)
  const replacement = client.call('agents:list')
  await delay(0)
  child.emit('message', { delta: { requestId: 'old', text: 'obsolete' } })
  assert.deepEqual(deltas, [])
  const next = children[1]
  next.emit('message', { id: next.requests.at(-1)!.id, result: { ok: true, value: [] } })
  assert.equal((await replacement).ok, true)
  assert.equal((await client.shutdown()).ok, true)
  assert.equal((await client.call('agents:list')).ok, false)
})

test('unused shutdown does not spawn, and hanging boot/shutdown settle all callers', async () => {
  let spawned = 0
  const unused = new AgentClient('/unused', () => {}, () => { spawned++; return new Worker() })
  await unused.shutdown()
  assert.equal(spawned, 0)

  const child = new Worker()
  child.postMessage = request => { child.requests.push(request) }
  const client = new AgentClient('/unused', () => {}, () => child, { boot: 30, shutdown: 10 })
  const pending = client.call('agents:list')
  const closing = client.shutdown()
  assert.equal(client.shutdown(), closing)
  assert.equal((await closing).ok, false)
  assert.equal((await pending).ok, false)
  assert.equal(child.killed, true)
})

test('boot timeout and synchronous send failure retire their worker without replaying requests', async () => {
  for (const failure of ['hang', 'send'] as const) {
    const child = new Worker()
    child.postMessage = request => {
      child.requests.push(request)
      if (failure === 'send') throw new Error('Broken pipe')
    }
    const client = new AgentClient('/unused', () => {}, () => child, { boot: 10, shutdown: 10 })
    const result = await client.call('agents:list')
    assert.equal(result.ok, false)
    assert.equal(child.killed, true)
    assert.deepEqual(child.requests.map(request => request.action), ['init'])
    await client.shutdown()
  }
})
