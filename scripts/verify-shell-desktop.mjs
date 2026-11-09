import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopSession } from './desktop/session.mjs'

const directory = await mkdtemp(join(tmpdir(), 'granite-shell-'))
const desktop = desktopSession(directory, 9357)
const provider = createServer((request, response) => {
  assert.equal(request.url, '/v1/models')
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ data: [{ id: 'shell-test-model' }] }))
})

try {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  await desktop.launch()
  const state = await desktop.evaluate(`(async () => ({
    panes: Array.from(document.querySelectorAll('main[aria-label="Workspace"] section'), pane => pane.getAttribute('aria-label')),
    brand: document.querySelector('.app-brand')?.textContent.trim(),
    bridge: Object.keys(window.granite).sort(),
    node: typeof window.require,
    connections: await window.granite.connections.list(),
    accounts: await window.granite.chatgpt.accounts()
  }))()`)
  assert.deepEqual(state.panes, ['Pane 1', 'Pane 2'])
  assert.equal(state.brand, 'Archon')
  assert.deepEqual(state.bridge, ['chatgpt', 'connections', 'models', 'platform', 'window'])
  assert.equal(state.node, 'undefined')
  assert.deepEqual(state.connections, { ok: true, value: [] })
  assert.deepEqual(state.accounts, { ok: true, value: [] })

  async function paneBounds(title) {
    return desktop.evaluate(`(() => {
      const rect = document.querySelector('section[aria-label="' + ${JSON.stringify(title)} + '"]').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`)
  }

  async function beginDrag(title, x, y) {
    const rect = await paneBounds(title)
    const start = await desktop.evaluate(`(() => {
      const rect = document.querySelector('section[aria-label="' + ${JSON.stringify(title)} + '"] .pane-drag-handle').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`)
    const offset = { x: start.x - rect.x, y: start.y - rect.y }
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start })
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 })
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 })
    // Pointer dispatch may return before the final movement frame is rendered.
    try {
      await desktop.wait(() => desktop.evaluate(`(() => {
        const rect = document.querySelector('.pane-floating')?.getBoundingClientRect();
        return Boolean(rect && Math.abs(rect.x - ${x - offset.x}) < 1 && Math.abs(rect.y - ${y - offset.y}) < 1);
      })()`), `${title} follows pointer`)
    } catch (error) {
      console.error({ title, start, target: { x, y }, original: rect, actual: await paneBounds(title), interaction: await desktop.evaluate('({workspace:document.querySelector(".workspace").className, floating:document.querySelector(".pane-floating")?.getBoundingClientRect().toJSON()})') })
      throw error
    }
    const moving = await paneBounds(title)
    assert.ok(Math.abs(moving.x - (x - offset.x)) < 1, JSON.stringify({ moving, rect, pointer: { x, y } }))
    assert.ok(Math.abs(moving.y - (y - offset.y)) < 1)
    assert.equal(moving.width, rect.width)
    assert.equal(moving.height, rect.height)
    const origin = await desktop.evaluate(`(() => {
      const rect = document.querySelector('.pane-slot-dragging').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`)
    assert.deepEqual(origin, rect)
  }

  async function release(x, y) {
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
    await desktop.wait(() => desktop.evaluate('!document.querySelector(".is-dragging, .is-resizing-horizontal, .is-resizing-vertical")'), 'drag finished')
    assert.equal(await desktop.evaluate('Boolean(document.querySelector(".pane-floating, .pane-slot-dragging, .tab-drag-preview, .pane-tab.is-dragging"))'), false)
  }

  // Start divider movement separately so callers can exercise commit and cancellation.
  async function beginResize(dx, dy) {
    const divider = await desktop.evaluate(`(() => {
      const rect = document.querySelector('[role="separator"]').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`)
    const end = { x: divider.x + dx, y: divider.y + dy }
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...divider })
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mousePressed', ...divider, button: 'left', buttons: 1, clickCount: 1 })
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, buttons: 1 })
    return end
  }

  // Navigation cannot be duplicated; Content offers all three viewable tab kinds.
  assert.deepEqual(await desktop.evaluate('[...document.querySelectorAll(".pane")].map(pane => pane.dataset.paneType)'), ['navigation', 'content'])
  await desktop.fill('select[aria-label="New pane type"]', 'navigation', 'select')
  await desktop.wait(() => desktop.evaluate('document.querySelector(".add-pane").disabled && document.querySelector(".add-pane").title === "The navigation pane is already open"'), 'navigation duplication blocked')
  await desktop.fill('select[aria-label="New pane type"]', 'content', 'select')
  try {
    await desktop.wait(() => desktop.evaluate('!document.querySelector(".add-pane").disabled'), 'content pane creation available')
  } catch (error) {
    console.error(await desktop.evaluate('({selected:document.querySelector(".new-pane-type").value, disabled:document.querySelector(".add-pane").disabled, reason:document.querySelector(".add-pane").title, bounds:document.querySelector(".pane-layout").getBoundingClientRect().toJSON(), alert:document.querySelector("[role=alert]")?.textContent})'))
    throw error
  }
  assert.equal(await desktop.evaluate(`Boolean(document.querySelector('[aria-label="Add tab to Pane 2"]'))`), false)

  // Tab controls must select real placeholder content without beginning a pane drag.
  await clickButton('Add tab to Pane 1')
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-1-tab-2")?.getAttribute("aria-selected") === "true"'), 'new tab selected')
  await clickButton('Close Agent 2 in Pane 1')
  await clickButton('Add tab to Pane 1')
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-1-tab-3")?.getAttribute("aria-selected") === "true"'), 'tab number not reused')
  await clickButton('Agent 1 in Pane 1')
  await desktop.wait(() => desktop.evaluate('document.querySelector("#pane-1-panel")?.textContent.trim() === "Pane 1 / Navigation / Agent 1"'), 'tab content selected')
  await desktop.rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' })
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-1-tab-3")?.getAttribute("aria-selected") === "true"'), 'keyboard tab selection')
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".is-dragging"))'), false)
  const tabsImage = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(tmpdir(), 'granite-tabs.png'), Buffer.from(tabsImage.data, 'base64'))

  // Check feedback before release, then cancel and verify exact restoration.
  const original = await paneBounds('Pane 1')
  let end = await beginResize(100, 0)
  await desktop.wait(async () => Math.abs((await paneBounds('Pane 1')).width - original.width - 100) < 1, 'live column resize')
  await desktop.rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await release(end.x, end.y)
  assert.deepEqual(await paneBounds('Pane 1'), original)

  // Out-of-range movement clamps to the pane minimum rather than collapsing it.
  end = await beginResize(-450, 0)
  await release(end.x, end.y)
  assert.ok(Math.abs((await paneBounds('Pane 1')).width - 200) < 1)
  end = await beginResize(150, 0)
  await release(end.x, end.y)
  const chosen = await paneBounds('Pane 1')
  assert.ok(Math.abs(chosen.width - 350) < 1)

  // Dock against a pane's bottom edge; the preview must match the committed placement.
  const second = await paneBounds('Pane 2')
  const bottom = { x: second.x + second.width / 2, y: second.y + second.height - 90 }
  await beginDrag('Pane 1', bottom.x, bottom.y)
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), 'dock preview')
  const preview = await desktop.evaluate(`(() => {
    const rect = document.querySelector('.pane-dock-preview').getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`)
  const previewImage = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(tmpdir(), 'granite-docking-preview.png'), Buffer.from(previewImage.data, 'base64'))
  await release(bottom.x, bottom.y)
  const initialDock = await paneBounds('Pane 1')
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(initialDock[key] - preview[key]) < 1, JSON.stringify({ key, initialDock, preview }))
  assert.ok(initialDock.y > (await paneBounds('Pane 2')).y)
  assert.equal(await desktop.evaluate('document.getElementById("pane-1-tab-3")?.getAttribute("aria-selected")'), 'true')
  assert.equal(await desktop.evaluate(`document.querySelectorAll('section[aria-label="Pane 1"] [role="tab"]').length`), 2)
  end = await beginResize(0, 60)
  await release(end.x, end.y)
  const docked = await paneBounds('Pane 1')
  assert.ok(Math.abs(docked.height - (initialDock.height - 60)) < 1)

  // Focusable separators provide keyboard resizing in the split's orientation.
  await desktop.evaluate(`document.querySelector('[role="separator"]').focus()`)
  await desktop.rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp' })
  await desktop.wait(async () => Math.abs((await paneBounds('Pane 1')).height - docked.height - 10) < 1, 'keyboard row resize')
  await desktop.rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' })
  await desktop.wait(async () => Math.abs((await paneBounds('Pane 1')).height - docked.height) < 1, 'keyboard resize restored')

  // Invalid center drops and Escape preserve the existing layout.
  const upper = await paneBounds('Pane 2')
  const center = { x: upper.x + upper.width / 2, y: upper.y + upper.height / 2 }
  await beginDrag('Pane 1', center.x, center.y)
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), false)
  await release(center.x, center.y)
  assert.deepEqual(await paneBounds('Pane 1'), docked)
  await beginDrag('Pane 1', upper.x + 60, center.y)
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), 'workspace preview')
  await desktop.rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await release(upper.x + 60, center.y)
  assert.deepEqual(await paneBounds('Pane 1'), docked)

  // Dock at the workspace's left edge to return to full-height columns.
  await beginDrag('Pane 1', upper.x + 60, center.y)
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), 'left edge preview')
  await release(upper.x + 60, center.y)
  const left = await paneBounds('Pane 1')
  const right = await paneBounds('Pane 2')
  assert.ok(left.x < right.x)
  assert.equal(left.y, right.y)
  assert.equal(left.height, right.height)

  // Use native pointer events to ensure header and close controls are clickable
  // without starting window/pane dragging.
  async function clickButton(label) {
    const point = await desktop.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)} || button.getAttribute('aria-label') === ${JSON.stringify(label)});
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`)
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 })
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 })
  }

  // Tab drags use the same real pointer path as pane drags, with a tab-sized ghost
  // for groups and the whole pane for a sole tab.
  async function beginTabDrag(id, point) {
    const start = await desktop.evaluate(`(() => {
      const rect = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`)
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start })
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 })
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, buttons: 1 })
    await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector(".pane-floating, .tab-drag-preview"))'), 'tab follows pointer')
  }

  // Append over the empty title-bar area, leaving insertion before existing tabs
  // available for the reorder check below.
  async function tabTarget(title) {
    return desktop.evaluate(`(() => {
      const rect = document.querySelector('section[aria-label="' + ${JSON.stringify(title)} + '"] .pane-drag-handle').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`)
  }

  await clickButton('Add pane')
  await desktop.wait(() => desktop.evaluate('document.querySelectorAll(".pane").length === 3'), 'third pane')
  await clickButton('Add pane')
  await desktop.wait(() => desktop.evaluate('document.querySelectorAll(".pane").length === 4'), 'fourth pane')
  assert.equal(await desktop.evaluate('document.querySelectorAll("[role=separator]").length'), 3)
  const leftEdge = await desktop.evaluate(`(() => {
    const rect = document.querySelector('.pane-layout').getBoundingClientRect();
    return { x: rect.left + 10, y: rect.bottom - 20, height: rect.height };
  })()`)
  await beginTabDrag('pane-3-tab-1', { x: leftEdge.x, y: leftEdge.y })
  await desktop.wait(() => desktop.evaluate('document.querySelector(".pane-dock-preview")?.textContent.trim() === "Dock left"'), 'sole tab docks its pane')
  await release(leftEdge.x, leftEdge.y)
  assert.equal((await paneBounds('Pane 3')).height, leftEdge.height)

  const intoSecond = await tabTarget('Pane 2')
  await beginTabDrag('pane-3-tab-1', intoSecond)
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector(".tab-drop-marker"))'), 'tab insertion marker')
  await release(intoSecond.x, intoSecond.y)
  await desktop.wait(() => desktop.evaluate('document.querySelectorAll(".pane").length === 3'), 'sole-tab source pane removed')
  assert.equal(await desktop.evaluate('document.getElementById("pane-3-tab-1").closest(".pane").getAttribute("aria-label")'), 'Pane 2')
  const rejected = await tabTarget('Pane 1')
  await beginTabDrag('pane-3-tab-1', rejected)
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), false)
  await release(rejected.x, rejected.y)
  assert.equal(await desktop.evaluate('document.getElementById("pane-3-tab-1").closest(".pane").getAttribute("aria-label")'), 'Pane 2')
  const intoFourth = await tabTarget('Pane 4')
  await beginTabDrag('pane-3-tab-1', intoFourth)
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector(".tab-drop-marker"))'), 'compatible target marker')
  await desktop.rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await release(intoFourth.x, intoFourth.y)
  assert.equal(await desktop.evaluate('document.getElementById("pane-3-tab-1").closest(".pane").getAttribute("aria-label")'), 'Pane 2')
  await beginTabDrag('pane-3-tab-1', intoFourth)
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector(".tab-drop-marker"))'), 'final tab insertion preview')
  const transferImage = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(tmpdir(), 'granite-tab-transfer.png'), Buffer.from(transferImage.data, 'base64'))
  await release(intoFourth.x, intoFourth.y)
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-3-tab-1").closest(".pane").getAttribute("aria-label") === "Pane 4"'), 'tab moved between groups')
  await desktop.wait(() => desktop.evaluate('document.activeElement?.id === "pane-3-tab-1"'), 'moved tab focused')
  assert.equal(await desktop.evaluate('document.getElementById("pane-3-tab-1").getAttribute("aria-selected")'), 'true')
  const beforeFirst = await desktop.evaluate(`(() => {
    const rect = document.getElementById('pane-4-tab-1').getBoundingClientRect();
    return { x: rect.x + 1, y: rect.y + rect.height / 2 };
  })()`)
  await beginTabDrag('pane-3-tab-1', beforeFirst)
  await release(beforeFirst.x, beforeFirst.y)
  assert.deepEqual(await desktop.evaluate(`[...document.querySelectorAll('section[aria-label="Pane 4"] [role="tab"]')].map(tab => tab.id)`), ['pane-3-tab-1', 'pane-4-tab-1'])

  const one = await paneBounds('Pane 1')
  const nestedDrop = { x: one.x + one.width - 80, y: one.y + one.height / 2 }
  await beginDrag('Pane 4', nestedDrop.x, nestedDrop.y)
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), 'nested docking preview')
  await release(nestedDrop.x, nestedDrop.y)
  assert.ok((await paneBounds('Pane 4')).x > (await paneBounds('Pane 1')).x)
  await clickButton('Close Pane 4')
  await desktop.wait(() => desktop.evaluate('document.querySelectorAll(".pane").length === 2'), 'sibling expands')
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".is-dragging"))'), false)

  // Check viewport resizing after pointer checks so device emulation cannot alter
  // the coordinate mapping used by subsequent native pointer input.
  end = await beginResize(100, 0)
  await release(end.x, end.y)
  const beforeViewport = await paneBounds('Pane 1')
  const beforeSecond = await paneBounds('Pane 2')
  const originalViewport = await desktop.evaluate('({width: innerWidth, height: innerHeight})')
  await desktop.rpc('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, deviceScaleFactor: 1, mobile: false })
  await desktop.wait(async () => (await paneBounds('Pane 1')).width < beforeViewport.width - 20, 'viewport resize')
  const smallFirst = await paneBounds('Pane 1')
  const smallSecond = await paneBounds('Pane 2')
  assert.ok(Math.abs(smallFirst.width / (smallFirst.width + smallSecond.width) - beforeViewport.width / (beforeViewport.width + beforeSecond.width)) < 0.002)
  // Electron may retain the emulated viewport after clearDeviceMetricsOverride.
  // Restore the original dimensions explicitly before checking the saved proportions.
  await desktop.rpc('Emulation.setDeviceMetricsOverride', { ...originalViewport, deviceScaleFactor: 1, mobile: false })
  try {
    await desktop.wait(async () => Math.abs((await paneBounds('Pane 1')).width - beforeViewport.width) < 1, 'viewport proportions restored')
  } catch (error) {
    console.error({ beforeViewport, beforeSecond, restored: await paneBounds('Pane 1'), viewport: await desktop.evaluate('({ width: innerWidth, height: innerHeight, scrollX, scrollY, workspace: document.querySelector(".pane-layout").getBoundingClientRect().toJSON() })') })
    throw error
  }

  // Closing the last pane exposes the backdrop; numbering is not reused on reopen.
  await desktop.click('Close Agent 3 in Pane 1')
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-1-tab-1")?.getAttribute("aria-selected") === "true"'), 'close selects neighboring tab')
  await desktop.click('Close Agent 1 in Pane 1')
  await desktop.wait(() => desktop.evaluate('document.querySelectorAll(".pane").length === 1'), 'last pane fills workspace')
  await desktop.click('Close Pane 2')
  await desktop.wait(() => desktop.evaluate('document.querySelectorAll(".pane, [role=separator]").length === 0'), 'empty workspace')
  await desktop.fill('select[aria-label="New pane type"]', 'navigation', 'select')
  await desktop.wait(() => desktop.evaluate('document.querySelector(".add-pane").getAttribute("aria-label") === "Add navigation pane" && !document.querySelector(".add-pane").disabled'), 'navigation creation ready')
  await desktop.click('Add pane')
  await desktop.wait(() => desktop.evaluate(`Boolean(document.querySelector('section[aria-label="Pane 5"][data-pane-type="navigation"]'))`), 'pane restored')
  const invalidMinimum = await desktop.evaluate('window.granite.window.setMinimumSize(-1, 100)')
  assert.equal(invalidMinimum.ok, false)
  await desktop.wait(() => desktop.evaluate('!document.querySelector("[role=alert]")'), 'window minimum applied')

  const draft = {
    name: 'Disposable local provider',
    baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
    apiKey: '',
    model: 'shell-test-model'
  }
  const saved = await desktop.evaluate(`window.granite.connections.save(${JSON.stringify(draft)})`)
  assert.equal(saved.ok, true)
  const models = await desktop.evaluate(`window.granite.connections.models(${JSON.stringify(saved.value.id)})`)
  assert.equal(models.ok, true)
  assert.equal(models.value[0].id, 'shell-test-model')
  const invalid = await desktop.evaluate('window.granite.connections.models(null)')
  assert.equal(invalid.ok, false)
  await desktop.quit()
  await desktop.launch()
  const restored = await desktop.evaluate('window.granite.connections.list()')
  assert.equal(restored.value[0].id, saved.value.id)
  assert.equal(restored.value[0].hasKey, false)
  const deleted = await desktop.evaluate(`window.granite.connections.delete(${JSON.stringify(saved.value.id)})`)
  assert.equal(deleted.ok, true)
  assert.deepEqual(await desktop.evaluate('window.granite.connections.list()'), { ok: true, value: [] })
  assert.ok(!(await readdir(directory)).includes('agents'))
  assert.ok(!(await readdir(directory)).includes('atlas.sqlite'))
  const screenshot = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
  const imagePath = join(tmpdir(), 'granite-shell.png')
  await writeFile(imagePath, Buffer.from(screenshot.data, 'base64'))
  console.log(`Pane tabs, dragging/docking, divider resizing, cancellation, isolation, connection persistence, and local model discovery passed. Screenshot: ${imagePath}`)
} finally {
  await desktop.quit()
  await new Promise((resolve, reject) => provider.close(error => error ? reject(error) : resolve()))
  await rm(directory, { recursive: true, force: true })
}
