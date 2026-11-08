import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { desktopSession } from './desktop/session.mjs'

const directory = await mkdtemp(join(tmpdir(), 'granite-model-picker-'))
const application = join(directory, 'application')
const profile = join(directory, 'profile')
const requests = []
let catalog = [
  { slug: 'account-model-a', display_name: 'Account Model A', visibility: 'list' },
  { slug: 'account-model-b', display_name: 'Account Model B', visibility: 'list' }
]
let unavailable = false

const server = createServer(async (request, response) => {
  assert.equal(request.headers.authorization, 'Bearer mock-account-token')

  if (request.url === '/v1/models') {
    response.writeHead(unavailable ? 503 : 200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ models: catalog }))

    return
  }

  assert.equal(request.url, '/v1/responses')
  let raw = ''

  for await (const chunk of request) {
    raw += chunk
  }

  const body = JSON.parse(raw)
  assert.equal(request.headers.accept, 'text/event-stream')
  requests.push(body)
  const text = `Reply from ${body.model}`
  // Match the live subscription endpoint: SSE without a Content-Type header.
  response.writeHead(200)
  response.end(`data: ${JSON.stringify({
    type: 'response.completed',
    response: {
      status: 'completed',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }]
      }]
    }
  })}\n\n`)
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

// Instrument a disposable build, never the real installation or profile. Both
// main and worker use the same mock account catalog and inference server.
await mkdir(application)
await mkdir(profile)
await cp('out', join(application, 'out'), { recursive: true })
await symlink(resolve('node_modules'), join(application, 'node_modules'))
await writeFile(join(application, 'package.json'), JSON.stringify({ main: 'out/main/index.js' }))
const redirect = `
const fixtureFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(input).replace('https://api.openai.com', ${JSON.stringify(origin)});
  if (!url.startsWith(${JSON.stringify(origin + '/')})) throw new Error('Unexpected fixture network request: ' + url);
  return fixtureFetch(url, init);
};
`
const seed = `
require('electron').app.whenReady().then(() => {
  const fs = require('node:fs');
  const path = require('node:path').join(${JSON.stringify(profile)}, 'chatgpt-accounts.json');
  if (fs.existsSync(path)) return;
  const encrypted = require('electron').safeStorage.encryptString(JSON.stringify({
    access: 'mock-account-token', refresh: 'mock-refresh', identity: 'mock-identity',
    expiresAt: Date.now() + 3600000,
    scopes: ['chatgpt.tokens.use.direct', 'resource.invoke']
  })).toString('base64');
  fs.writeFileSync(path, JSON.stringify({hostId: 'test-host', accounts: [{
    id: 'mock-account', clientId: 'mock-client', subject: 'mock-user',
    email: 'mock@example.com', encrypted
  }]}));
});
`

for (const file of ['index.js', 'agent-worker.js']) {
  const path = join(application, 'out/main', file)
  await writeFile(path, redirect + (file === 'index.js' ? seed : '') + await readFile(path, 'utf8'))
}

let session
async function launch() {
  session = desktopSession(profile, 9444, {}, application)
  await session.launch()
  await session.rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
}
const quit = () => session?.quit()
const evaluate = (...args) => session.evaluate(...args)
const click = (...args) => session.click(...args)
const fill = (...args) => session.fill(...args)
const wait = (...args) => session.wait(...args)
const modelSelector = '[role="combobox"][aria-label="ChatGPT model"]'

async function chooseModel(name, expectedNames = ['Account Model A', 'Account Model B']) {
  await wait(() => evaluate('document.querySelector(".effort-trigger")?.disabled === false'), 'model picker ready')
  await evaluate('document.querySelector(".effort-trigger").click()')
  await click('ChatGPT model')
  await wait(() => evaluate(`Boolean(document.querySelector('[role=listbox][aria-label="ChatGPT model"]'))`), 'model options')
  const names = await evaluate('[...document.querySelectorAll("[role=listbox] [role=option] > span:first-child")].map(item => item.textContent.trim())')
  assert.deepEqual(names, expectedNames)
  assert.ok(await evaluate(`(() => {
    const option = [...document.querySelectorAll('[role=listbox] [role=option]')].find(item => item.firstElementChild.textContent.trim() === ${JSON.stringify(name)});
    if (!option || option.getAttribute('aria-disabled') === 'true') return false;
    option.click(); return true;
  })()`))
  await wait(() => evaluate(`document.querySelector(${JSON.stringify(modelSelector)})?.textContent.trim() === ${JSON.stringify(name)}`), 'model selected')
  await evaluate('document.querySelector(".effort-trigger").click()')
}

async function send(text) {
  const before = requests.length
  const replies = await evaluate('document.querySelectorAll(".assistant").length')
  await fill('textarea[aria-label="Message"]', text, 'textarea')
  await wait(() => evaluate('document.querySelector("button[type=submit]")?.disabled === false'), 'send ready')
  await click('Send message')
  await wait(() => evaluate(`!document.querySelector('.stop-button') && document.querySelectorAll('.assistant').length > ${replies}`), 'reply rendered')
  assert.equal(requests.length, before + 1)
  assert.match(await evaluate('document.querySelector(".assistant:last-of-type").textContent'), /Reply from account-model-/)
}

async function assertLocked(model) {
  assert.equal(await evaluate(`document.querySelector('[aria-label="Active connection"]').disabled`), true, 'Used chat locks its connection')
  assert.equal(await evaluate('document.querySelector(".effort-model-name").textContent'), model)
  // Catalog fixtures have no reasoning controls, so a bound model cannot open.
  assert.equal(await evaluate('document.querySelector(".effort-trigger").disabled'), true, 'Used chat locks its model')
}

try {
  await launch()
  await click('Create agent')
  await fill('input[aria-label="Agent name"]', 'Model switch test')
  await evaluate('document.querySelector(".connection-editor button").click()')
  await wait(() => evaluate('document.querySelector(".file-preview[aria-busy=false]")?.textContent.includes("This file is empty.")'), 'blank identity')
  const agentId = await evaluate('document.querySelector(".agent-dropdown-trigger").dataset.agentId')
  // The current OAuth UI initiates browser sign-in, with no saved-account picker.
  // Seed only the disposable mock account binding through the public bridge.
  const saved = await evaluate(`window.granite.connections.save(${JSON.stringify({ name: 'Mock account', provider: 'chatgpt', accountId: 'mock-account', model: '', baseUrl: '', apiKey: '', protocol: 'responses' })})`)
  assert.ok(saved.ok)
  await session.rpc('Page.reload')
  await wait(() => evaluate('document.querySelector(".agent-dropdown-trigger")?.disabled === false'), 'mock connection loaded')
  await click('Settings')
  await click('Edit')
  await wait(() => evaluate('document.querySelector(".chatgpt-account")?.textContent.includes("mock@example.com")'), 'mock account loaded in editor')
  await click('Save connection')
  await wait(() => evaluate(`document.querySelectorAll('[aria-label="Connected providers"] .provider-card').length === 1 && !document.querySelector('.connection-editor')`), 'one account connection saved')
  await click('Back to workspace')
  await chooseModel('Account Model B')
  await send('First request')
  assert.equal(requests.at(-1).model, 'account-model-b')
  await assertLocked('Account Model B')

  await send('Second request')
  assert.equal(requests.at(-1).model, 'account-model-b')
  assert.match(JSON.stringify(requests.at(-1).input), /First request/)
  await assertLocked('Account Model B')
  const firstChat = (await evaluate(`window.granite.conversations.list(${JSON.stringify(agentId)})`)).value[0].id
  const boundRequests = requests.length
  const rejected = await evaluate(`window.granite.stream('reject-mid-chat-model-change', ${JSON.stringify(agentId)}, ${JSON.stringify(firstChat)}, ${JSON.stringify(saved.value.id)}, 'Must not switch this chat', 'account-model-a', '', 'message')`)
  assert.equal(rejected.ok, false, 'Backend rejects a different model for a used chat')
  assert.match(rejected.error, /fixed.*conversation|fixed for this conversation/i)
  assert.equal(requests.length, boundRequests, 'Rejected model change never reaches inference')
  await click('New chat')
  assert.equal(await evaluate(`document.querySelector('[aria-label="Active connection"]').disabled`), false)
  await chooseModel('Account Model A')
  await send('Different model in a new chat')
  assert.equal(requests.at(-1).model, 'account-model-a')
  assert.doesNotMatch(JSON.stringify(requests.at(-1).input), /First request|Second request/)
  await assertLocked('Account Model A')
  const first = await evaluate(`window.granite.conversations.get(${JSON.stringify(agentId)}, ${JSON.stringify(firstChat)})`)
  assert.ok(first.ok)
  const boundMessages = first.value.messages.filter(message => message.model)
  assert.ok(boundMessages.length > 0)
  assert.ok(boundMessages.every(message => message.model === 'account-model-b'))
  assert.deepEqual((await evaluate('window.granite.connections.list()')).value.map(item => item.model), [''])

  await quit()
  catalog = catalog.slice(1)
  await launch()
  await wait(() => evaluate('document.querySelector(".effort-model-name")?.textContent === "account-model-a"'), 'bound model survives restart and catalog removal')
  await assertLocked('account-model-a')
  const before = requests.length
  await fill('textarea[aria-label="Message"]', 'Model removed from account', 'textarea')
  await wait(() => evaluate('document.querySelector("button[type=submit]")?.disabled === false'), 'bound-model request ready')
  await click('Send message')
  await wait(() => evaluate('document.querySelector(".error")?.textContent.includes("no longer available")'), 'unavailable model rejected')
  await wait(() => evaluate('!document.querySelector(".stop-button")'), 'rejected request finished')
  assert.equal(requests.length, before)

  await click('Settings')
  await click('Reload')
  await wait(() => evaluate('document.querySelector("[role=status]")?.textContent.includes("Reloaded · 1 models")'), 'catalog refreshed')
  await click('Back to workspace')
  await assertLocked('account-model-a')
  await click('New chat')
  await chooseModel('Account Model B', ['Account Model B'])
  unavailable = true
  await click('Settings')
  await click('Reload')
  await wait(() => evaluate('document.querySelector(".error")?.textContent.includes("HTTP 503")'), 'catalog failure shown')
  await click('Back to workspace')
  // Reload to exercise startup against the cached discovery failure as well as
  // the Settings error, instead of relying on the previous rendered catalog.
  await session.rpc('Page.reload')
  await wait(() => evaluate('document.querySelector(".error")?.textContent.includes("HTTP 503")'), 'failed catalog blocks new chat')
  await click('New chat')
  await fill('textarea[aria-label="Message"]', 'Must wait for catalog recovery', 'textarea')
  assert.equal(await evaluate('document.querySelector("button[type=submit]").disabled'), true, 'Cannot send without a usable catalog')
  assert.equal(requests.length, before)
  unavailable = false
  await click('Settings')
  await click('Reload')
  await wait(() => evaluate('document.querySelector("[role=status]")?.textContent.includes("Reloaded · 1 models")'), 'catalog retry')
  await click('Back to workspace')
  await send('Recovered catalog in a new chat')
  assert.equal(requests.at(-1).model, 'account-model-b')
  await assertLocked('Account Model B')
  assert.ok(requests.every(request => request.store === false && request.stream === true))
  console.log('PASS mock only: one ChatGPT connection, custom model picker, used-chat model/connection locks, same-model continuity, different model in a new chat, restart binding, catalog refresh/failure/retry, and backend rejection of unavailable models.')
} finally {
  await quit()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
