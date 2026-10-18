import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Acceptance test: agent creation, identity editing, and both introductions go
// through actual React controls. Only connection setup uses the public bridge.
const live = process.argv.includes('--live')
const packaged = process.argv.includes('--packaged')
const question = 'what is your name and who are you'
const directory = await mkdtemp(join(tmpdir(), 'granite-agents-ui-'))
const answers = {}
let app, socket, stderr = '', server
let next = 0
const callbacks = new Map()
const wait = async (check, label, limit = 20_000) => {
  const until = Date.now() + limit
  while (Date.now() < until) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${label}. ${stderr.slice(-3000)}`)
}
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++next
    callbacks.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function launch() {
  const executable = packaged ? './release/mac-arm64/Granite.app/Contents/MacOS/Granite' : './node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
  app = spawn(executable, [...packaged ? [] : ['.'], '--remote-debugging-port=9442', `--user-data-dir=${directory}`], {
    stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
  })
  app.stderr.on('data', data => { stderr += data })
  let page
  await wait(async () => {
    try { page = (await (await fetch('http://127.0.0.1:9442/json')).json()).find(page => page.type === 'page'); return Boolean(page) }
    catch { return false }
  }, 'desktop startup')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), callback = callbacks.get(message.id)
    if (callback) { callbacks.delete(message.id); message.error ? callback.reject(message.error) : callback.resolve(message.result) }
  })
  await wait(() => evaluate('Boolean(document.querySelector(".agent-switcher select option")) && !document.querySelector(".agent-switcher select").disabled'), 'agent registry loaded')
}
async function click(text) {
  assert.ok(await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`), `Button available: ${text}`)
}
async function fill(selector, value, kind = 'input') {
  await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Control not found');
    Object.getOwnPropertyDescriptor(${kind === 'textarea' ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
}
async function selectAgent(id) {
  await evaluate(`(() => { const element = document.querySelector('.agent-switcher select'); element.value = ${JSON.stringify(id)}; element.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await wait(() => evaluate('!document.querySelector(".agent-switcher select").disabled'), 'agent switch')
}
async function ask(name) {
  console.log(`START ${name}: ${question}`)
  const start = Date.now()
  const before = await evaluate('document.querySelectorAll(".assistant").length')
  await fill('textarea[aria-label="Message"]', question, 'textarea')
  await click('Send ↗')
  await wait(() => evaluate(`!document.querySelector('.stop-button') && document.querySelectorAll('.assistant').length > ${before}`), `${name} reply`, 150_000)
  const error = await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""')
  assert.equal(error, '')
  const text = await evaluate('document.querySelector(".assistant:last-of-type > div:last-of-type")?.textContent ?? ""')
  assert.match(text, new RegExp(`\\b${name}\\b`, 'i'))
  assert.match(text, /assistant|agent|help|companion/i)
  if (name === 'Nova') assert.ok((text.match(/\p{Extended_Pictographic}/gu) ?? []).length >= 2, 'Nova follows the emoji identity')
  answers[name] = { text, elapsedMs: Date.now() - start }
  const screenshot = await rpc('Page.captureScreenshot', { format: 'png' })
  await writeFile(`/tmp/granite-agents-${name.toLowerCase()}-${live ? 'live' : 'mock'}.png`, Buffer.from(screenshot.data, 'base64'))
  console.log('ANSWER', name, JSON.stringify(answers[name]))
}
async function quit() {
  socket.close(); app.kill(); await new Promise(resolve => app.once('exit', resolve))
  await new Promise(resolve => setTimeout(resolve, 300))
}
try {
  let connection
  if (live) {
    assert.ok(process.env.GRANITE_MODEL_BASE_URL && process.env.GRANITE_MODEL_ID, 'Set model URL and ID for a live test')
    connection = { name: 'LM Studio acceptance test', baseUrl: process.env.GRANITE_MODEL_BASE_URL, model: process.env.GRANITE_MODEL_ID, apiKey: process.env.GRANITE_MODEL_API_KEY ?? '' }
  } else {
    server = createServer(async (request, response) => {
      let raw = ''; for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw), content = body.messages[0].content
      const system = typeof content === 'string' ? content : content.map(block => block.text ?? '').join('')
      const profile = JSON.parse(system.match(/<agent_profile>\n(.*?)\n<\/agent_profile>/s)[1])
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const [delta, finish_reason] of [[{ role: 'assistant', content: `I am ${profile.name}, your personal assistant.${system.includes('at least three friendly emojis') ? ' 🌟 😊 🚀' : ''}` }, null], [{}, 'stop']]) {
        response.write(`data: ${JSON.stringify({ id: 'test', model: 'mock', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
      }
      response.end('data: [DONE]\n\n')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    connection = { name: 'Mock model', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'mock', apiKey: '' }
  }
  await launch()
  const saved = await evaluate(`window.granite.connections.save(${JSON.stringify(connection)})`)
  assert.ok(saved.ok)
  await rpc('Page.reload')
  await wait(() => evaluate('document.querySelector("textarea[aria-label=Message]")?.disabled === false'), 'connection ready')
  await ask('Atlas')
  await evaluate('document.querySelector(".agent-switcher button").click()')
  await fill('input[aria-label="Agent name"]', 'Nova')
  await click('Create agent')
  await wait(() => evaluate('document.querySelector(".identity-editor")?.value.includes("# Nova")'), 'new agent identity')
  const identity = '# Nova\nYou are Nova, a cheerful, curious personal assistant.\nUse at least three friendly emojis in every response, especially introductions, such as 🌟 😊 🚀.\nBe helpful, honest, and clear. Your name is Nova.\n'
  await fill('textarea[aria-label="Agent identity"]', identity, 'textarea')
  assert.ok(await evaluate('document.querySelector(".agent-switcher select").disabled'), 'Unsaved identity edits are protected')
  await click('Save identity')
  await wait(() => evaluate('document.querySelector("[role=status]")?.textContent.includes("Identity saved")'), 'identity saved')
  const novaId = await evaluate('document.querySelector(".agent-switcher select").value')
  assert.equal(await readFile(join(directory, 'agents', novaId, 'identity.md'), 'utf8'), identity)
  assert.doesNotMatch(await readFile(join(directory, 'agents', 'atlas', 'identity.md'), 'utf8'), /three friendly emojis/)
  await click('Back to chat')
  assert.equal(await evaluate('document.querySelectorAll(".assistant").length'), 0, 'Nova starts with its own conversation')
  await ask('Nova')
  await selectAgent('atlas')
  assert.match(await evaluate('document.querySelector(".assistant:last-of-type").textContent'), /Atlas/)
  assert.doesNotMatch(await evaluate('document.querySelector(".assistant:last-of-type").textContent'), /Nova/)
  await quit(); await launch()
  await selectAgent(novaId)
  assert.match(await evaluate('document.querySelector(".assistant:last-of-type").textContent'), /Nova/)
  const identityResult = await evaluate(`window.granite.workspace.read(${JSON.stringify(novaId)}, '/identity.md')`)
  assert.equal(identityResult.value, identity)
  const report = { mode: live ? 'live LM Studio' : 'mock', packaged, question, model: connection.model, answers, passed: true }
  await writeFile(`/tmp/granite-agents-${live ? 'live' : 'mock'}-results.json`, JSON.stringify(report, null, 2))
  console.log('PASS agent creation through UI, persisted identity edits, both introductions, emoji style, separate conversations, agent switching, restart recovery')
} catch (error) { console.error(stderr); throw error }
finally {
  socket?.close(); if (app?.exitCode === null) app.kill()
  server?.closeAllConnections(); server?.close()
  await new Promise(resolve => setTimeout(resolve, 300))
  await rm(directory, { recursive: true, force: true })
}
