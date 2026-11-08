import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

// The optional final argument supplies short deadlines and transport fakes for lifecycle tests.
export function desktopSession(directory, port, environment = {}, entry = '.', executable, options = {}) {
  const timeout = options.timeout ?? 20_000
  const shutdownTimeout = options.shutdownTimeout ?? 2_000
  const startProcess = options.spawn ?? spawn
  const fetchTargets = options.fetch ?? fetch
  const Socket = options.WebSocket ?? WebSocket
  let app,
    socket,
    next = 0,
    stderr = '',
    failure,
    quitting,
    launching = false
  const callbacks = new Map()
  let rejectFailure, failed
  function resetFailure() {
    failure = undefined
    failed = new Promise((_, reject) => { rejectFailure = reject })
    failed.catch(() => {})
  }
  resetFailure()

  function fail(error) {
    if (failure) return
    failure = error instanceof Error ? error : new Error(String(error))
    rejectFailure(failure)
    for (const callback of callbacks.values()) callback.reject(failure)
    callbacks.clear()
  }

  async function bounded(operation, label, limit = timeout) {
    if (failure) throw failure
    let timer
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        failed,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out: ${label}. ${stderr.slice(-2000)}`)), limit)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  async function wait(check, label, limit = timeout) {
    const deadline = Date.now() + limit

    while (Date.now() < deadline) {
      if (await bounded(check, label, deadline - Date.now())) {
        return
      }

      const remaining = Math.max(1, deadline - Date.now())
      await bounded(() => new Promise(resolve => setTimeout(resolve, Math.min(100, remaining))), label, remaining)
    }

    throw new Error(`Timed out: ${label}. ${stderr.slice(-2000)}`)
  }

  async function rpc(method, params = {}) {
    const id = ++next
    try {
      return await bounded(() => new Promise((resolve, reject) => {
        if (!socket || socket.readyState !== 1) {
          reject(new Error('Desktop WebSocket is not open'))
          return
        }
        callbacks.set(id, { resolve, reject })
        try {
          socket.send(JSON.stringify({ id, method, params }))
        } catch (error) {
          fail(error)
        }
      }), `CDP ${method}`)
    } finally {
      callbacks.delete(id)
    }
  }

  async function evaluate(expression) {
    const result = await rpc('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })

    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails))
    }

    return result.result.value
  }

  async function launch() {
    if (launching) throw new Error('Desktop session is already launching')
    launching = true
    try {
      if (quitting) await quitting
      if (app) throw new Error('Desktop session is already running')
      quitting = undefined
      stderr = ''
      resetFailure()
      await start()
    } finally {
      launching = false
    }
  }

  async function start() {
    try {
      // Refuse an existing listener rather than discovering another application's CDP page.
      const probe = createServer()
      try {
        await bounded(() => new Promise((resolve, reject) => {
          probe.once('error', error => reject(new Error(`Debugging port ${port} unavailable: ${error.message}`)))
          probe.listen(port, '127.0.0.1', () => probe.close(resolve))
        }), 'debugging port availability')
      } finally {
        probe.close()
      }
      app = startProcess(
        executable ?? './node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
        [...(executable ? [] : [entry]), `--remote-debugging-port=${port}`, `--user-data-dir=${directory}`],
        {
          stdio: ['ignore', 'ignore', 'pipe'],
          env: { ...process.env, ...environment, ELECTRON_RUN_AS_NODE: '' }
        }
      )
      const child = app
      child.stderr.on('data', data => {
        if (app !== child) return
        stderr = (stderr + data).slice(-16_000)
      })
      child.on('error', error => {
        if (app === child) fail(new Error(`Desktop process error: ${error.message}`))
      })
      child.once('exit', (code, signal) => {
        if (app === child) fail(new Error(`Desktop process exited (${signal ?? code}). ${stderr.slice(-2000)}`))
      })
      const spawned = new Promise(resolve => child.once('spawn', resolve))
      await bounded(() => spawned, 'desktop process spawn')

      let page
      const discovery = new AbortController()
      try {
        await wait(async () => {
          try {
            const response = await fetchTargets(`http://127.0.0.1:${port}/json`, { signal: discovery.signal })
            if (!response.ok) return false
            page = (await response.json()).find(
              page => page.type === 'page' && typeof page.webSocketDebuggerUrl === 'string'
            )

            return Boolean(page)
          } catch {
            return false
          }
        }, 'desktop startup')
      } finally {
        discovery.abort()
      }
      socket = new Socket(page.webSocketDebuggerUrl)
      const connection = socket
      connection.addEventListener('error', () => {
        if (socket === connection) fail(new Error('Desktop WebSocket error'))
      })
      connection.addEventListener('close', () => {
        if (socket === connection) fail(new Error('Desktop WebSocket closed'))
      })
      connection.addEventListener('message', event => {
        if (socket !== connection) return
        try {
          const message = JSON.parse(event.data)
          const callback = callbacks.get(message.id)

          if (callback) {
            callbacks.delete(message.id)
            message.error ? callback.reject(new Error(`CDP error: ${JSON.stringify(message.error)}`)) : callback.resolve(message.result)
          }
        } catch (error) {
          fail(new Error(`Invalid CDP message: ${error.message}`))
        }
      })
      await bounded(() => new Promise(resolve => {
        if (socket.readyState === 1) resolve()
        else socket.addEventListener('open', resolve, { once: true })
      }), 'desktop WebSocket open')
      await wait(
        () => evaluate('document.querySelector(".agent-dropdown-trigger")?.disabled === false'),
        'agent registry loaded'
      )
    } catch (error) {
      try {
        await quit()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `${error.message}; ${cleanupError.message}`)
      }
      throw error
    }
  }

  async function click(text) {
    assert.ok(
      await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(text)} || item.getAttribute('aria-label') === ${JSON.stringify(text)});
      if (!button || button.disabled) return false;
      button.click(); return true;
    })()`),
      `Button available: ${text}`
    )
  }

  async function fill(selector, value, kind = 'input') {
    const constructor = {
      input: 'HTMLInputElement',
      textarea: 'HTMLTextAreaElement',
      select: 'HTMLSelectElement'
    }[kind]
    assert.ok(constructor)
    await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Control not found');
      Object.getOwnPropertyDescriptor(${constructor}.prototype, 'value').set.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event(${JSON.stringify(kind === 'select' ? 'change' : 'input')}, { bubbles: true }));
    })()`)
  }

  function quit() {
    if (quitting) return quitting
    fail(new Error('Desktop session closed'))
    quitting = (async () => {
      try { socket?.close() } catch { /* A failed handshake may already be closed. */ }
      socket = undefined
      if (!app || app.exitCode !== null || app.signalCode !== null || !app.pid) {
        app = undefined
        return
      }

      const child = app
      let timer
      const exited = new Promise(resolve => child.once('exit', resolve))
      async function settle() {
        try {
          return await Promise.race([
            exited.then(() => true),
            new Promise(resolve => { timer = setTimeout(() => resolve(false), shutdownTimeout) })
          ])
        } finally { clearTimeout(timer) }
      }
      child.kill('SIGTERM')
      if (!await settle()) {
        child.kill('SIGKILL')
        if (!await settle()) throw new Error('Desktop process did not exit after SIGKILL')
      }
      app = undefined
    })()
    return quitting
  }

  return { launch, quit, rpc, evaluate, click, fill, wait }
}
