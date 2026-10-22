import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopSession } from './desktop/session.mjs'

const directory = await mkdtemp(join(tmpdir(), 'granite-select-position-'))
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
const { launch, quit, rpc, evaluate, click, wait } = desktopSession(directory, 9445)
const trigger = '[role="combobox"][aria-label="Active connection"]'

async function openConnections() {
  // Let navigation, resizing, and scrollIntoView effects finish before opening.
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
  await click('Active connection')
}

async function checkPosition(selector, upwards) {
  await wait(() => evaluate(`Boolean(document.querySelector('.custom-select-menu'))`), 'menu opened')
  const bounds = await evaluate(`(() => {
    const trigger = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const menu = document.querySelector('.custom-select-menu').getBoundingClientRect();
    return {
      gap: ${upwards ? 'trigger.top - menu.bottom' : 'menu.top - trigger.bottom'},
      top: menu.top, bottom: menu.bottom, left: menu.left, right: menu.right,
      viewportWidth: innerWidth, viewportHeight: innerHeight
    };
  })()`)
  assert.ok(Math.abs(bounds.gap - 4) < 1, `Menu stays 4px from its trigger: ${JSON.stringify(bounds)}`)
  assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.viewportHeight, 'menu fits vertically')
  assert.ok(bounds.left >= 8 && bounds.right <= bounds.viewportWidth - 8, 'menu fits horizontally')
}

try {
  await launch()
  const agent = await evaluate(`window.granite.agents.create('Menu position test')`)
  assert.ok(agent.ok)
  for (const name of ['Desktop', 'ChatGPT']) {
    const saved = await evaluate(`window.granite.connections.save(${JSON.stringify({ name, baseUrl, model: 'mock-model', apiKey: '' })})`)
    assert.ok(saved.ok)
  }
  await rpc('Page.reload')
  await wait(() => evaluate(`document.querySelector('${trigger}')?.disabled === false`), 'composer ready')

  for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
    await rpc('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
    await click('New chat')
    await openConnections()
    await checkPosition(trigger, true)
    await click('Active connection')
    await openConnections()
    await checkPosition(trigger, true)
    await click('Active connection')

    await click('⚙ Settings')
    await wait(() => evaluate(`Boolean(document.querySelector('.settings-main'))`), 'settings')
    await click('← Back to chat')
    await openConnections()
    await checkPosition(trigger, true)
    // Select by label to exercise the actual portal and its selection handler.
    const selectedName = viewport.width === 1280 ? 'ChatGPT' : 'Desktop'
    await evaluate(`[...document.querySelectorAll('.custom-select-option')].find(option => option.textContent.includes(${JSON.stringify(selectedName)})).click()`)
    await wait(() => evaluate(`!document.querySelector('.custom-select-menu')`), 'selection closes menu')
    assert.equal(await evaluate(`document.querySelector('${trigger}').textContent.trim()`), selectedName)
  }

  await click('⚙ Settings')
  await click('+ Add connection')
  const typeSelector = '.connection-editor [role="combobox"]'
  await evaluate(`document.querySelector('${typeSelector}').click()`)
  await checkPosition(typeSelector, false)
  console.log('PASS: first open, reopen, Settings round trip, connection selection, two viewport sizes, and downward menus stay anchored to their triggers.')
} finally {
  await quit()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
