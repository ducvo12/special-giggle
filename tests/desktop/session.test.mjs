import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import test from 'node:test'
import { desktopSession } from '../../scripts/desktop/session.mjs'

// Only the CDP transport is simulated: no application or renderer build is needed.
function fixture(overrides = {}, port = 0) {
  function makeChild() {
    const child = new EventEmitter()
    child.stderr = new EventEmitter()
    child.pid = 123
    child.exitCode = child.signalCode = null
    child.signals = []
    child.kill = signal => {
      child.signals.push(signal)
      child.signalCode = signal
      child.emit('exit', null, signal)
      return true
    }
    return child
  }
  let child = makeChild()
  const children = []
  let socket
  class Socket extends EventTarget {
    readyState = 0
    constructor() {
      super()
      socket = this
      queueMicrotask(() => {
        this.readyState = 1
        this.dispatchEvent(new Event('open'))
      })
    }
    send(raw) {
      const { id, method } = JSON.parse(raw)
      if (method === 'Runtime.evaluate') {
        queueMicrotask(() => this.message({ id, result: { result: { value: true } } }))
      }
    }
    message(value) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
    }
    close() {
      this.readyState = 3
      this.dispatchEvent(new Event('close'))
    }
  }
  const desktop = desktopSession('/unused', port, {}, '.', undefined, {
    timeout: 100,
    shutdownTimeout: 20,
    spawn: () => {
      if (children.length) child = makeChild()
      children.push(child)
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
    fetch: async () => new Response(JSON.stringify([{ type: 'page', webSocketDebuggerUrl: 'ws://fixture' }])),
    WebSocket: Socket,
    ...overrides
  })
  return { desktop, children, get child() { return child }, get socket() { return socket } }
}

test('launch, evaluate, out-of-order RPC replies, and idempotent quit', async () => {
  const f = fixture()
  await f.desktop.launch()
  assert.equal(await f.desktop.evaluate('true'), true)
  const first = f.desktop.rpc('First')
  const second = f.desktop.rpc('Second')
  await Promise.resolve()
  f.socket.message({ id: 4, result: { value: 'second' } })
  f.socket.message({ id: 3, result: { value: 'first' } })
  assert.deepEqual(await Promise.all([first, second]), [{ value: 'first' }, { value: 'second' }])
  await Promise.all([f.desktop.quit(), f.desktop.quit()])
  assert.deepEqual(f.child.signals, ['SIGTERM'])
  await assert.rejects(f.desktop.rpc('AfterQuit'), /session closed/)
})

test('the same session supports repeated launch/quit cycles with isolated lifecycle state', async () => {
  const f = fixture()
  await f.desktop.launch()
  const firstChild = f.child
  const firstSocket = f.socket
  const firstPending = assert.rejects(f.desktop.rpc('FirstPending'), /session closed/)
  await f.desktop.quit()
  await firstPending

  await f.desktop.launch()
  assert.notEqual(f.child, firstChild)
  assert.notEqual(f.socket, firstSocket)
  // Delayed notifications from the old transports must not fail the new session.
  firstChild.emit('error', new Error('old process error'))
  firstChild.stderr.emit('data', 'old stderr')
  firstSocket.close()
  firstSocket.dispatchEvent(new MessageEvent('message', { data: '{' }))
  assert.equal(await f.desktop.evaluate('true'), true)
  const secondPending = assert.rejects(f.desktop.rpc('SecondPending'), /WebSocket closed/)
  f.socket.close()
  await secondPending
  await f.desktop.quit()

  await f.desktop.launch()
  assert.equal(await f.desktop.evaluate('true'), true)
  await Promise.all([f.desktop.quit(), f.desktop.quit()])
  assert.deepEqual(f.children.map(child => child.signals), [['SIGTERM'], ['SIGTERM'], ['SIGTERM']])
})

test('an occupied debugging port prevents spawning and can be retried after release', async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const f = fixture({}, server.address().port)
  try {
    await assert.rejects(f.desktop.launch(), /Debugging port .* unavailable:.*EADDRINUSE/)
    assert.equal(f.children.length, 0)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
  await f.desktop.launch()
  assert.equal(f.children.length, 1)
  await f.desktop.quit()
})

for (const event of ['close', 'error', 'malformed', 'exit', 'process error', 'quit']) {
  test(`${event} rejects all pending calls and waits`, async () => {
    const f = fixture()
    await f.desktop.launch()
    const checks = [f.desktop.rpc('One'), f.desktop.rpc('Two'), f.desktop.wait(() => new Promise(() => {}), 'hung')]
      .map(promise => assert.rejects(promise, /WebSocket|CDP message|process|session closed/))
    await Promise.resolve()
    if (event === 'close') f.socket.close()
    if (event === 'error') f.socket.dispatchEvent(new Event('error'))
    if (event === 'malformed') f.socket.dispatchEvent(new MessageEvent('message', { data: '{' }))
    if (event === 'exit') {
      f.child.exitCode = 1
      f.child.emit('exit', 1, null)
    }
    if (event === 'process error') f.child.emit('error', new Error('broken process'))
    if (event === 'quit') await f.desktop.quit()
    await Promise.all(checks)
    await f.desktop.quit()
  })
}

test('RPC timeout removes the call; a late reply does not corrupt the next call', async () => {
  const f = fixture()
  await f.desktop.launch()
  await assert.rejects(f.desktop.rpc('NeverReplies'), /Timed out: CDP NeverReplies/)
  f.socket.message({ id: 2, result: { ignored: true } })
  assert.equal(await f.desktop.evaluate('true'), true)
  await f.desktop.quit()
})

test('protocol errors reject only the affected RPC', async () => {
  const f = fixture()
  await f.desktop.launch()
  const rejected = assert.rejects(f.desktop.rpc('BadMethod'), /CDP error.*unknown method/)
  await Promise.resolve()
  f.socket.message({ id: 2, error: { message: 'unknown method' } })
  await rejected
  assert.equal(await f.desktop.evaluate('true'), true)
  await f.desktop.quit()
})

test('send errors reject all pending RPCs', async () => {
  const f = fixture()
  await f.desktop.launch()
  const pending = assert.rejects(f.desktop.rpc('Pending'), /send failed/)
  await Promise.resolve()
  f.socket.send = () => { throw new Error('send failed') }
  await assert.rejects(f.desktop.rpc('SendFailure'), /send failed/)
  await pending
  await f.desktop.quit()
})

test('wait bounds both a hanging check and repeated false results', async () => {
  const f = fixture()
  await assert.rejects(f.desktop.wait(() => new Promise(() => {}), 'hanging check', 30), /Timed out: hanging check/)
  await assert.rejects(f.desktop.wait(() => false, 'false check', 30), /Timed out: false check/)
  await assert.rejects(f.desktop.wait(() => { throw new Error('check failed') }, 'throws'), /check failed/)
  await f.desktop.quit()
})

test('renderer readiness cannot hang launch', async () => {
  class Socket extends EventTarget {
    readyState = 1
    send() {}
    close() {}
  }
  const f = fixture({ WebSocket: Socket })
  await assert.rejects(f.desktop.launch(), /Timed out: (desktop shell loaded|CDP Runtime.evaluate)/)
  assert.deepEqual(f.child.signals, ['SIGTERM'])
})

test('RPC before launch fails immediately', async () => {
  const f = fixture()
  await assert.rejects(f.desktop.rpc('BeforeLaunch'), /WebSocket is not open/)
  await f.desktop.quit()
})

for (const response of ['fetch hangs', 'body hangs', 'no page', 'bad JSON', 'HTTP error']) {
  test(`discovery is bounded when ${response}`, async () => {
    const f = fixture({ fetch: async () => {
      if (response === 'fetch hangs') return new Promise(() => {})
      if (response === 'body hangs') return { ok: true, json: () => new Promise(() => {}) }
      if (response === 'bad JSON') return new Response('{')
      if (response === 'HTTP error') return new Response('[]', { status: 503 })
      return new Response(JSON.stringify([{ type: 'worker' }]))
    } })
    await assert.rejects(f.desktop.launch(), /Timed out: desktop startup/)
    assert.deepEqual(f.child.signals, ['SIGTERM'])
    await f.desktop.quit()
  })
}

test('real HTTP discovery request that never responds is bounded', async () => {
  const server = createServer(() => {})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  let signal
  const f = fixture({ fetch: (_, options) => {
    signal = options.signal
    return fetch(`http://127.0.0.1:${server.address().port}/json`, options)
  } })
  try {
    await assert.rejects(f.desktop.launch(), /Timed out: desktop startup/)
    assert.equal(signal.aborted, true)
  } finally {
    await f.desktop.quit()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

for (const event of ['hang', 'close', 'error']) {
  test(`WebSocket handshake ${event} is bounded and cleans up the child`, async () => {
    class Socket extends EventTarget {
      readyState = 0
      constructor() {
        super()
        if (event !== 'hang') queueMicrotask(() => this.dispatchEvent(new Event(event)))
      }
      close() {}
    }
    const f = fixture({ WebSocket: Socket })
    await assert.rejects(f.desktop.launch(), /WebSocket/)
    assert.deepEqual(f.child.signals, ['SIGTERM'])
  })
}

test('spawn failure is reported promptly', async () => {
  const f = fixture({ spawn: () => spawn('/nonexistent/granite-desktop-session-test') })
  await assert.rejects(f.desktop.launch(), /Desktop process error:.*ENOENT/)
  await f.desktop.quit()
})

test('synchronous spawn errors preserve the original failure', async () => {
  const f = fixture({ spawn: () => { throw new Error('invalid executable') } })
  await assert.rejects(f.desktop.launch(), /invalid executable/)
  await f.desktop.quit()
})

test('startup exit includes only bounded recent stderr', async () => {
  const f = fixture({ fetch: () => new Promise(() => {}) })
  const spawned = once(f.child, 'spawn')
  const launched = f.desktop.launch()
  await spawned
  f.child.stderr.emit('data', 'old marker' + 'x'.repeat(100_000) + 'recent marker')
  f.child.exitCode = 7
  f.child.emit('exit', 7, null)
  await assert.rejects(launched, error => {
    assert.match(error.message, /exited \(7\).*recent marker/)
    assert.ok(error.message.length < 2100)
    assert.ok(!error.message.includes('old marker'))
    return true
  })
})

test('shutdown escalates a real child ignoring SIGTERM to SIGKILL', async () => {
  let child
  let notifyStarted
  const started = new Promise(resolve => { notifyStarted = resolve })
  const f = fixture({
    timeout: 2_000,
    shutdownTimeout: 100,
    spawn: () => {
      child = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); process.stderr.write('ready'); setInterval(() => {}, 1000)`], { stdio: ['ignore', 'ignore', 'pipe'] })
      notifyStarted()
      return child
    }
  })
  const launched = f.desktop.launch()
  await started
  await once(child.stderr, 'data')
  await launched
  await f.desktop.quit()
  assert.equal(child.signalCode, 'SIGKILL')
})

test('shutdown reports a child that never exits without hanging', async () => {
  const f = fixture()
  f.child.kill = signal => { f.child.signals.push(signal); return true }
  await f.desktop.launch()
  await assert.rejects(f.desktop.quit(), /did not exit after SIGKILL/)
  assert.deepEqual(f.child.signals, ['SIGTERM', 'SIGKILL'])
})
