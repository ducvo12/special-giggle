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
globalThis.fetch = (input, init) => fixtureFetch(
  String(input).replace('https://api.openai.com', ${JSON.stringify(origin)}), init
);
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

const { launch, quit, evaluate, click, fill, wait } = desktopSession(profile, 9444, {}, application)
const modelSelector = 'select[aria-label="ChatGPT model"]'

try {
  await launch()
  await click('Create agent')
  await fill('input[aria-label="Agent name"]', 'Model switch test')
  await click('Create agent')
  await wait(() => evaluate('Boolean(document.querySelector(".identity-editor"))'), 'identity draft')
  await click('Save and continue')
  await wait(() => evaluate('Boolean(document.querySelector(".chat-main"))'), 'chat')
  await click('Connect model')
  await click('+ Add connection')
  await fill('.connection-editor select', 'chatgpt', 'select')
  await wait(() => evaluate('Boolean(document.querySelector("option[value=mock-account]"))'), 'account loaded')
  await evaluate(`(() => {
    const control = [...document.querySelectorAll('select')].find(item => item.querySelector('option[value="mock-account"]'));
    control.value = 'mock-account';
    control.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await click('Save connection')
  await wait(() => evaluate('Boolean(document.querySelector(".connection-card"))'), 'one account connection saved')
  await click('Back to chat')
  await wait(() => evaluate(`document.querySelector('${modelSelector}')?.options.length === 2`), 'account catalog')
  assert.equal(await evaluate(`document.querySelector('${modelSelector}').options[1].textContent.trim()`), 'Account Model B')

  await fill(modelSelector, 'account-model-b', 'select')
  await fill('textarea[aria-label="Message"]', 'First request', 'textarea')
  await click('Send ↗')
  await wait(() => evaluate('!document.querySelector(".stop-button")'), 'first reply')
  assert.equal(requests.at(-1).model, 'account-model-b')

  await fill(modelSelector, 'account-model-a', 'select')
  await fill('textarea[aria-label="Message"]', 'Second request', 'textarea')
  await click('Send ↗')
  await wait(() => evaluate('!document.querySelector(".stop-button")'), 'second reply')
  assert.equal(requests.at(-1).model, 'account-model-a')
  assert.match(JSON.stringify(requests.at(-1).input), /First request/)
  assert.deepEqual((await evaluate('window.granite.connections.list()')).value.map(item => item.model), [''])

  await quit()
  await launch()
  await wait(() => evaluate(`document.querySelector('${modelSelector}')?.value === 'account-model-a'`), 'remembered model')
  const before = requests.length
  catalog = catalog.slice(1)
  await fill('textarea[aria-label="Message"]', 'Model removed from account', 'textarea')
  await click('Send ↗')
  await wait(() => evaluate('document.querySelector(".error")?.textContent.includes("no longer available")'), 'unavailable model rejected')
  await wait(() => evaluate('!document.querySelector(".stop-button")'), 'rejected request finished')
  assert.equal(requests.length, before)

  await click('Refresh ChatGPT models')
  await wait(() => evaluate(`document.querySelector('${modelSelector}')?.value === 'account-model-b'`), 'catalog refreshed')
  unavailable = true
  await click('Refresh ChatGPT models')
  await wait(() => evaluate('document.querySelector(".error")?.textContent.includes("HTTP 503")'), 'catalog failure shown')
  assert.equal(await evaluate('document.querySelector("button[type=submit]").disabled'), true)
  unavailable = false
  await click('Refresh ChatGPT models')
  await wait(() => evaluate(`document.querySelector('${modelSelector}')?.value === 'account-model-b'`), 'catalog retry')
  assert.ok(requests.every(request => request.store === false && request.stream === true))
  console.log('PASS: one ChatGPT connection, account model names, switching, conversation continuity, restart, catalog refresh/failure, and backend rejection of unavailable models.')
} finally {
  await quit()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
