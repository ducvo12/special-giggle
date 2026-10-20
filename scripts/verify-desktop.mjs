import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const directory = await mkdtemp(join(tmpdir(), 'granite-atlas-ui-'))
await mkdir(join(directory, 'agents', 'atlas'), { recursive: true })

let disconnected = false,
  app,
  socket,
  stderr = ''

let number = 0

const packaged = process.argv.includes('--packaged')

const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json')

    return res.end(JSON.stringify({ data: [{ id: 'mock-atlas' }] }))
  }

  let raw = ''

  for await (const data of req) {
    raw += data
  }

  const body = JSON.parse(raw),
    user = body.messages.findLast(m => m.role === 'user')?.content,
    last = body.messages.at(-1)
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const chunk = (delta, finish_reason = null) =>
    res.write(
      `data: ${JSON.stringify({ id: 'test', model: 'mock-atlas', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    )
  const done = text => {
    chunk({ role: 'assistant', content: text })
    chunk({}, 'stop')
    res.end('data: [DONE]\n\n')
  }
  const tool = (name, args) => {
    chunk({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: 'call-' + ++number,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) }
        }
      ]
    })
    chunk({}, 'tool_calls')
    res.end('data: [DONE]\n\n')
  }

  if (user === 'Slow') {
    chunk({ role: 'assistant', content: 'Partial answer' })
    const timer = setInterval(() => chunk({ content: ' more' }), 150)
    res.on('close', () => {
      clearInterval(timer)
      disconnected = true
    })

    return
  }

  if (last.role !== 'tool') {
    if (user === 'Save note') {
      return tool('write_file', { file_path: '/notes/ui.md', content: 'A saved note from Atlas.' })
    }

    if (user === 'Remember tea') {
      return tool('edit_file', {
        file_path: '/memory.md',
        old_string: 'No preferences saved yet.',
        new_string: 'The user prefers jasmine tea.'
      })
    }
  }

  if (last.role === 'tool') {
    return done('Saved successfully.')
  }

  if (user === 'Preference?') {
    return done(
      JSON.stringify(body.messages[0].content).includes('jasmine')
        ? 'You prefer jasmine tea.'
        : 'No preference.'
    )
  }

  chunk({ role: 'assistant', reasoning_content: 'A brief thought.' })
  done('Every small step is a promise kept to your future self.')
})

await new Promise(r => server.listen(0, '127.0.0.1', r))

const api = server.address().port

const wait = async (check, label) => {
  for (let i = 0; i < 160; i++) {
    if (await check()) {
      return
    }

    await new Promise(r => setTimeout(r, 100))
  }

  throw new Error(`Timed out ${label}. ${stderr.slice(-4000)}`)
}

let next = 0

const callbacks = new Map()

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
  const exe = packaged
    ? './release/mac-arm64/Granite.app/Contents/MacOS/Granite'
    : './node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
  app = spawn(
    exe,
    [...(packaged ? [] : ['.']), '--remote-debugging-port=9441', `--user-data-dir=${directory}`],
    { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }
  )
  app.stderr.on('data', data => (stderr += data))
  let page
  await wait(async () => {
    try {
      page = (await (await fetch('http://127.0.0.1:9441/json')).json()).find(p => p.type === 'page')

      return !!page
    } catch {
      return false
    }
  }, 'startup')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => socket.addEventListener('open', r, { once: true }))
  socket.addEventListener('message', e => {
    const m = JSON.parse(e.data),
      cb = callbacks.get(m.id)

    if (cb) {
      callbacks.delete(m.id)
      m.error ? cb.reject(m.error) : cb.resolve(m.result)
    }
  })
  await wait(() => evaluate('Boolean(document.querySelector(".sidebar"))'), 'React mount')
  await wait(
    () => evaluate('!document.querySelector("header .quiet-button")?.disabled'),
    'Atlas load'
  )
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent??""'), '')
}

async function click(text) {
  assert.ok(
    await evaluate(
      `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`
    ),
    `button ${text}`
  )
}

async function send(text, finish = true) {
  await evaluate(
    `(()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`
  )
  await click('Send ↗')

  if (finish) {
    await wait(() => evaluate('!document.querySelector(".stop-button")'), 'reply finish')
    assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent??""'), '')
  }
}

async function quit() {
  socket.close()
  app.kill()
  await new Promise(r => app.once('exit', r))
  await new Promise(r => setTimeout(r, 300))
}

try {
  await launch()
  const saved = await evaluate(
    `window.granite.connections.save({name:'Test model',baseUrl:'http://127.0.0.1:${api}/v1',model:'mock-atlas',apiKey:''})`
  )
  assert.ok(saved.ok)
  // Reload to exercise persisted connection discovery and the actual composer.
  await rpc('Page.reload')
  await wait(
    () => evaluate('document.querySelector("textarea")?.disabled===false'),
    'connection restored'
  )
  await send('Quote')
  assert.match(
    await evaluate('document.querySelector(".assistant").textContent'),
    /Every small step/
  )
  await send('Save note')
  assert.ok(await evaluate('Boolean(document.querySelector(".tool-activity"))'))
  assert.match(await readFile(join(directory, 'agents/atlas/notes/ui.md'), 'utf8'), /saved note/)
  await send('Remember tea')
  await click('New chat')
  await send('Preference?')
  assert.match(await evaluate('document.querySelector(".assistant").textContent'), /jasmine/)
  await send('Slow', false)
  await wait(
    () =>
      evaluate(
        'document.querySelector(".assistant:last-of-type")?.textContent.includes("Partial answer")'
      ),
    'partial text'
  )
  await click('■ Stop')
  await wait(() => evaluate('!document.querySelector(".stop-button")'), 'Stop')
  assert.ok(disconnected)
  assert.match(
    await evaluate('document.querySelector(".assistant:last-of-type").textContent'),
    /Reply interrupted/
  )
  const shot = await rpc('Page.captureScreenshot', { format: 'png' })
  await writeFile(
    `/tmp/granite-atlas-${packaged ? 'packaged' : 'dev'}.png`,
    Buffer.from(shot.data, 'base64')
  )
  await click('▧ Workspace')
  await wait(
    () => evaluate('document.querySelector(".file-preview pre")?.textContent.includes("# Atlas")'),
    'identity viewer'
  )
  await click('· memory.md')
  await wait(
    () => evaluate('document.querySelector(".file-preview pre")?.textContent.includes("jasmine")'),
    'memory viewer'
  )
  assert.equal(await evaluate('typeof require'), 'undefined')
  await quit()
  await launch()
  await wait(
    () =>
      evaluate(
        'document.querySelector(".assistant:last-of-type")?.textContent.includes("Reply interrupted")'
      ),
    'restart transcript'
  )
  await send('Preference?')
  assert.match(
    await evaluate('document.querySelector(".assistant:last-of-type").textContent'),
    /jasmine/
  )
  console.log(
    `PASS ${packaged ? 'packaged' : 'development'}: utility worker, quote streaming, real file tool, persistent memory, new-chat recall, Stop disconnect, workspace viewer, restart and continuation, isolated renderer.`
  )
} catch (error) {
  console.error(stderr)
  throw error
} finally {
  socket?.close()

  if (app?.exitCode === null) {
    app.kill()
  }

  server.closeAllConnections()
  server.close()
  await new Promise(r => setTimeout(r, 300))
  await rm(directory, { recursive: true, force: true })
}
