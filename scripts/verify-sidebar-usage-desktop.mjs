import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopSession } from './desktop/session.mjs'

const directory = await mkdtemp(join(tmpdir(), 'granite-sidebar-usage-'))
const server = createServer(async (request, response) => {
  if (request.url.endsWith('/models')) {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'usage-test' }] }))
    return
  }

  let raw = ''
  for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw)
  const expiring = raw.includes('Expire reading')
  if (!request.url.startsWith('/unsupported/')) {
    response.setHeader('x-ratelimit-limit-requests', '100')
    response.setHeader('x-ratelimit-remaining-requests', request.url.startsWith('/one/') ? '70' : '45')
    response.setHeader('x-ratelimit-reset-requests', expiring ? '1.5s' : '4m')
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  if (request.url.endsWith('/responses')) {
    response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Usage check complete.' })}\n\n`)
    response.end(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } })}\n\n`)
    return
  }
  response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Usage check complete.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
})
const desktop = desktopSession(directory, 9468, { ELECTRON_RENDERER_URL: '' })
const { evaluate, click, fill, wait } = desktop

try {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  await desktop.launch()
  const seeded = await evaluate(`(async () => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error); return result.value }
    const agent = unwrap(await window.granite.agents.create('Atlas'))
    unwrap(await window.granite.agents.saveIdentity(agent.id, 'Be concise.', ''))
    const connections = []
    for (const [path, name, protocol] of [['one', 'Primary account', 'chat-completions'], ['two', 'Second account', 'responses'], ['unsupported', 'Local model', 'chat-completions']]) {
      connections.push(unwrap(await window.granite.connections.save({
        name, protocol, baseUrl: 'http://127.0.0.1:${server.address().port}/' + path + '/v1', model: 'usage-test', apiKey: ''
      })))
    }
    localStorage.setItem('granite.agent', agent.id)
    localStorage.setItem('granite.connection', connections[0].id)
    return { agent, connections }
  })()`)
  await desktop.rpc('Page.reload')
  await wait(() => evaluate('document.querySelector(".send-button")?.disabled === true && document.querySelector("textarea")?.disabled === false'), 'sidebar and composer loaded')
  assert.equal(await evaluate('document.querySelectorAll(".connection-usage-trigger").length'), 0)
  assert.equal(await evaluate(`Boolean(document.querySelector('button[aria-label="Agent options"]'))`), false)
  assert.equal(await evaluate('document.querySelector(".sidebar-footer").textContent.trim()'), '')

  const geometry = await evaluate(`(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, centerY: r.y + r.height / 2 } }
    return { settings: rect('.sidebar-settings'), footer: rect('.sidebar-footer'), arrow: rect('.agent-dropdown-trigger .chevron-icon'), plus: rect('.agent-tree-header > .tree-action') }
  })()`)
  assert.ok(geometry.settings.left <= geometry.footer.left + 1)
  assert.ok(Math.abs(geometry.settings.centerY - geometry.footer.centerY) <= 6)
  assert.ok(geometry.plus.left - geometry.arrow.right <= 10)
  await click('Settings')
  await wait(() => evaluate('Boolean(document.querySelector(".settings-main"))'), 'settings opened')
  await click('New chat')
  await fill('textarea[aria-label="Message"]', 'Check usage', 'textarea')
  await wait(() => evaluate('document.querySelector(".send-button")?.disabled === false'), 'send enabled')
  await click('Send message')
  await wait(() => evaluate('document.querySelectorAll(".connection-usage-trigger").length === 1 && !document.querySelector(".stop-button")'), 'first reading from the actual model request')
  assert.match(await evaluate('document.querySelector(".connection-usage-trigger").getAttribute("aria-label")'), /Connection 1: Primary account, 70% remaining/)
  const firstRight = await evaluate('document.querySelector(".connection-usage-trigger").getBoundingClientRect().right')

  async function run(connection, text) {
    const result = await evaluate(`(async () => {
      const chat = await window.granite.conversations.create(${JSON.stringify(seeded.agent.id)})
      if (!chat.ok) throw new Error(chat.error)
      return window.granite.stream(crypto.randomUUID(), ${JSON.stringify(seeded.agent.id)}, chat.value.id, ${JSON.stringify(connection.id)}, ${JSON.stringify(text)})
    })()`)
    assert.equal(result.ok, true, result.error)
  }

  await run(seeded.connections[1], 'Check second account')
  await run(seeded.connections[2], 'Check unsupported account')
  await wait(() => evaluate('document.querySelectorAll(".connection-usage-trigger").length === 2'), 'second supported connection visible')
  const circles = await evaluate(`Array.from(document.querySelectorAll('.connection-usage-trigger')).map(button => ({ label: button.getAttribute('aria-label'), left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right }))`)
  assert.equal(circles[0].right, firstRight)
  assert.ok(circles[1].right < circles[0].left, 'new indicators expand to the left')
  assert.match(circles[1].label, /Connection 2: Second account, 45% remaining/)
  await evaluate('document.querySelector(".connection-usage-trigger").focus()')
  const tooltip = await evaluate(`(() => {
    const tip = document.querySelector('.connection-usage-tooltip'); const r = tip.getBoundingClientRect();
    return { text: tip.textContent, display: getComputedStyle(tip).display, left: r.left, right: r.right, bottom: r.bottom, width: innerWidth }
  })()`)
  assert.equal(tooltip.display, 'grid')
  assert.match(tooltip.text, /Primary account/)
  assert.match(tooltip.text, /70 \/ 100/)
  assert.match(tooltip.text, /resets/)
  assert.ok(tooltip.left >= 0 && tooltip.right <= tooltip.width)
  const screenshot = process.argv.find(argument => argument.startsWith('--screenshot='))?.slice('--screenshot='.length)
  if (screenshot) {
    const captured = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
    await writeFile(screenshot, Buffer.from(captured.data, 'base64'))
  }
  await evaluate(`document.querySelector('.connection-usage-trigger').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".connection-usage-tooltip")).display'), 'none')

  await desktop.rpc('Page.reload')
  await wait(() => evaluate('document.querySelectorAll(".connection-usage-trigger").length === 2'), 'readings survive renderer reload')
  await run(seeded.connections[0], 'Expire reading')
  await wait(() => evaluate('document.querySelectorAll(".connection-usage-trigger").length === 1'), 'expired limit hidden', 5000)
  const deleted = await evaluate(`window.granite.connections.delete(${JSON.stringify(seeded.connections[1].id)})`)
  assert.equal(deleted.ok, true)
  await wait(() => evaluate('document.querySelectorAll(".connection-usage-trigger").length === 0'), 'deleted connection removed immediately')
  assert.deepEqual((await evaluate('window.granite.connections.usage()')).value, [])
  console.log('PASS: settings, compact agent controls, supported/unsupported connections, both model protocols, leftward expansion, exact tooltips, reload, expiry and deletion.')
} finally {
  await desktop.quit()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
