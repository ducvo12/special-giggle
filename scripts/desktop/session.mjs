import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

export function desktopSession(directory, port, environment = {}, entry = '.', executable) {
  let app,
    socket,
    next = 0,
    stderr = ''
  const callbacks = new Map()

  async function wait(check, label, limit = 20_000) {
    const deadline = Date.now() + limit

    while (Date.now() < deadline) {
      if (await check()) {
        return
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }

    throw new Error(`Timed out: ${label}. ${stderr.slice(-2000)}`)
  }

  function rpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++next
      callbacks.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
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
    app = spawn(
      executable ?? './node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
      [...(executable ? [] : [entry]), `--remote-debugging-port=${port}`, `--user-data-dir=${directory}`],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, ...environment, ELECTRON_RUN_AS_NODE: '' }
      }
    )
    app.stderr.on('data', data => {
      stderr += data
    })
    let page
    await wait(async () => {
      try {
        page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
          page => page.type === 'page'
        )

        return Boolean(page)
      } catch {
        return false
      }
    }, 'desktop startup')
    socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      const callback = callbacks.get(message.id)

      if (callback) {
        callbacks.delete(message.id)
        message.error ? callback.reject(message.error) : callback.resolve(message.result)
      }
    })
    await wait(
      () => evaluate('document.querySelector(".agent-dropdown-trigger")?.disabled === false'),
      'agent registry loaded'
    )
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

  async function quit() {
    socket?.close()
    socket = undefined

    if (app && app.exitCode === null && app.signalCode === null) {
      const exited = new Promise(resolve => app.once('exit', resolve))
      app.kill()
      await exited
    }

    app = undefined
  }

  return { launch, quit, rpc, evaluate, click, fill, wait }
}
