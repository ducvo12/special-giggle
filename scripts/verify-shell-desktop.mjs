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
  await desktop.evaluate(`(() => {
    window.__shellErrors = [];
    window.addEventListener('error', event => window.__shellErrors.push(event.message || 'error'));
    window.addEventListener('unhandledrejection', event => window.__shellErrors.push(String(event.reason)));
  })()`)
  const state = await desktop.evaluate(`(async () => ({
    regions: [...document.querySelectorAll('[data-region]')].map(region => region.dataset.region),
    groups: [...document.querySelectorAll('.pane')].map(pane => pane.getAttribute('aria-label')),
    brand: document.querySelector('.app-brand')?.textContent.trim(),
    bridge: Object.keys(window.granite).sort(),
    node: typeof window.require,
    connections: await window.granite.connections.list(),
    accounts: await window.granite.chatgpt.accounts()
  }))()`)
  assert.deepEqual(state.regions, ['explorer', 'content'])
  assert.deepEqual(state.groups, ['Group 1', 'Group 2'])
  assert.equal(state.brand, 'Archon')
  assert.deepEqual(state.bridge, ['chatgpt', 'connections', 'models', 'platform', 'window'])
  assert.equal(state.node, 'undefined')
  assert.deepEqual(state.connections, { ok: true, value: [] })
  assert.deepEqual(state.accounts, { ok: true, value: [] })
  assert.equal(await desktop.evaluate(`Boolean(document.querySelector('[aria-label="Add tab to Group 2"]'))`), false)

  // Bounds and pointer helpers exercise real inputs rather than React internals.
  async function bounds(selector) {
    return desktop.evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`)
  }

  // Native scrollbars can cover part of a narrow tab; use a visible point that hits the handle.
  async function pointerPoint(selector) {
    let point
    await desktop.wait(async () => {
      point = await desktop.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        const rect = element.getBoundingClientRect();
        let { left, right, top, bottom } = rect;
        const strip = element.closest('.pane-tabs');
        if (strip) {
          const clip = strip.getBoundingClientRect();
          left = Math.max(left, clip.left + strip.clientLeft);
          right = Math.min(right, clip.left + strip.clientLeft + strip.clientWidth);
          top = Math.max(top, clip.top + strip.clientTop);
          bottom = Math.min(bottom, clip.top + strip.clientTop + strip.clientHeight);
        }
        if (right <= left || bottom <= top) return null;
        for (const x of [0.5, 0.25, 0.75]) {
          for (const y of [0.5, 0.25, 0.75]) {
            const point = { x: left + (right - left) * x, y: top + (bottom - top) * y };
            if (element.contains(document.elementFromPoint(point.x, point.y))) return point;
          }
        }
        return null;
      })()`)
      return point !== null
    }, `${selector} receives pointer input`)
    return point
  }

  async function press(point) {
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 })
  }

  async function move(point) {
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, buttons: 1 })
  }

  async function release(point) {
    await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 })
    await desktop.wait(() => desktop.evaluate('!document.querySelector(".workspace.is-dragging, .workspace.is-resizing-horizontal, .workspace.is-resizing-vertical")'), `interaction finished at ${JSON.stringify(point)}`)
    assert.equal(await desktop.evaluate('Boolean(document.querySelector(".pane-floating, .region-floating, .tab-drag-preview, .pane-tab.is-dragging"))'), false)
  }

  async function settled(selector = '.workspace') {
    await desktop.wait(() => desktop.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(selector)});
      return Boolean(root)
        && !root.closest('[data-transition]')
        && !root.querySelector('[data-transition]')
        && root.getAnimations({ subtree: true }).every(animation => animation.playState === 'finished');
    })()`), `${selector} animations settled`)
  }

  async function click(label) {
    await desktop.wait(() => desktop.evaluate('!document.querySelector("[data-transition]")'), `ready before click ${label}`)
    const selector = `[aria-label="${label}"]`
    const point = await pointerPoint(selector)
    await press(point)
    await release(point)
  }

  async function key(key) {
    await desktop.rpc('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
  }

  async function beginDrag(selector, point) {
    const start = await pointerPoint(selector)
    await press(start)
    await move(point)
    await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector(".pane-floating, .region-floating, .tab-drag-preview"))'), `${selector} follows pointer`)
  }

  async function preview(label) {
    await desktop.wait(() => desktop.evaluate(`document.querySelector('.pane-dock-preview')?.textContent.trim() === ${JSON.stringify(label)}`), label)
    await settled('.pane-dock-preview')
    return bounds('.pane-dock-preview')
  }

  async function beginResize(selector, dx, dy) {
    const start = await pointerPoint(selector)
    const end = { x: start.x + dx, y: start.y + dy }
    await press(start)
    await move(end)
    return end
  }

  // Compare geometry within each region so a swap may change position without changing its contents.
  async function snapshot() {
    return desktop.evaluate(`[...document.querySelectorAll('[data-region]')].map(region => {
      const origin = region.getBoundingClientRect();
      return { type: region.dataset.region, width: origin.width, height: origin.height,
        groups: [...region.querySelectorAll('.pane')].map(pane => {
          const rect = pane.getBoundingClientRect();
          return { id: pane.dataset.paneId, x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
            tabs: [...pane.querySelectorAll('[role=tab]')].map(tab => ({ id: tab.id, selected: tab.getAttribute('aria-selected') })) };
        }) };
    }).sort((a, b) => a.type.localeCompare(b.type))`)
  }

  function sameRect(actual, expected) {
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < 1, JSON.stringify({ key, actual, expected }))
  }

  const outerDivider = '.region-layout > .pane-divider'
  const explorer = '[data-region=explorer]'
  const content = '[data-region=content]'
  const group1 = '[data-pane-id=pane-1]'
  const group2 = '[data-pane-id=pane-2]'

  // Tab selection, keyboard navigation, close selection, and numbering remain controlled.
  await click('Add tab to Group 1')
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-1-tab-2")?.getAttribute("aria-selected") === "true"'), 'Agent 2 selected')
  await click('Close Agent 2 in Group 1')
  await click('Add tab to Group 1')
  await click('Agent 1 in Group 1')
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-1-tab-1")?.getAttribute("aria-selected") === "true" && document.activeElement?.id === "pane-1-tab-1"'), 'Agent 1 selected and focused')
  await key('ArrowRight')
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-1-tab-3")?.getAttribute("aria-selected") === "true"'), 'keyboard Agent 3 selection')
  assert.equal(await desktop.evaluate('document.querySelector("#pane-1-panel").textContent.trim()'), 'Group 1 / Explorer / Agent 3')

  // Region resizing cancels exactly, clamps at minimums, and supports keyboard control.
  assert.equal(await desktop.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(outerDivider)}), '::after').opacity`), '0')
  const outerHandlePoint = await pointerPoint(outerDivider)
  await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...outerHandlePoint })
  await desktop.wait(() => desktop.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(outerDivider)}), '::after').opacity === '1'`), 'outer divider bar visible on hover')
  const original = await bounds(explorer)
  let end = await beginResize(outerDivider, 80, 0)
  await desktop.wait(async () => Math.abs((await bounds(explorer)).width - original.width - 80) < 1, 'live outer resize')
  await key('Escape')
  await release(end)
  sameRect(await bounds(explorer), original)
  end = await beginResize(outerDivider, -450, 0)
  await release(end)
  assert.equal((await bounds(explorer)).width, 200)
  end = await beginResize(outerDivider, 300, 0)
  await release(end)
  assert.equal((await bounds(explorer)).width, 500)
  await desktop.evaluate(`document.querySelector(${JSON.stringify(outerDivider)}).focus()`)
  await key('ArrowRight')
  await desktop.wait(async () => Math.abs((await bounds(explorer)).width - 510) < 1, 'keyboard region resize')
  await key('ArrowLeft')
  await desktop.wait(async () => Math.abs((await bounds(explorer)).width - 500) < 1, 'keyboard region resize restored')

  // Split well inside the Agent body, beyond the old edge threshold, with no modifier key.
  let area = await bounds(`${explorer} .pane-layout`)
  let point = { x: area.x + area.width * 0.7, y: area.y + area.height / 2 }
  const beforeSplit = await snapshot()
  await beginDrag('#pane-1-tab-3', point)
  await preview('Split Agent 3 right')
  await key('Escape')
  await release(point)
  await settled()
  assert.deepEqual(await snapshot(), beforeSplit)
  await beginDrag('#pane-1-tab-3', point)
  const splitPreview = await preview('Split Agent 3 right')
  await release(point)
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-1-tab-3")?.closest(".pane").dataset.paneId === "pane-3"'), 'Agent tab split into Group 3')
  await settled()
  const flushFirst = await bounds(group1)
  const flushThird = await bounds('[data-pane-id=pane-3]')
  assert.ok(Math.abs(flushThird.x - (flushFirst.x + flushFirst.width) - 1) < 1)
  assert.equal(await desktop.evaluate(`document.querySelector('${explorer} .pane-layout').classList.contains('is-framed')`), true)
  assert.deepEqual(await desktop.evaluate('(() => { const s = getComputedStyle(document.querySelector("[data-pane-id=pane-3]")); return { radius: s.borderRadius, border: s.borderTopWidth }; })()'), { radius: '0px', border: '0px' })
  assert.equal(await desktop.evaluate(`getComputedStyle(document.querySelector('${explorer} .pane-split-horizontal > .pane-divider'), '::after').opacity`), '0')
  assert.equal((await bounds(explorer)).width, 500)
  await desktop.wait(() => desktop.evaluate('document.activeElement?.id === "pane-1-tab-3"'), 'detached Agent tab focused')
  assert.equal(await desktop.evaluate('document.getElementById("pane-1-tab-1").getAttribute("aria-selected")'), 'true')

  // The new Agent group separates while dragging and can split vertically inside Explorer.
  await click('Add tab to Group 3')
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-3-tab-1")?.getAttribute("aria-selected") === "true"'), 'new Agent tab selected in Group 3')
  const third = await bounds('[data-pane-id=pane-3]')
  point = { x: third.x + third.width / 2, y: third.y + third.height * 0.7 }
  await beginDrag('#pane-3-tab-1', point)
  await desktop.wait(() => desktop.evaluate(`document.querySelector('${explorer} .pane-layout').classList.contains('is-separating')`), 'Explorer separates during tab drag')
  await settled(`${explorer} .pane-layout`)
  assert.equal(await desktop.evaluate(`document.querySelector('${content} .pane-layout').classList.contains('is-framed')`), true)
  const separatedFirst = await bounds(group1)
  const separatedThird = await bounds('[data-pane-id=pane-3]')
  assert.ok(Math.abs(separatedThird.x - (separatedFirst.x + separatedFirst.width) - 12) < 1)
  sameRect(separatedThird, splitPreview)
  assert.equal(await desktop.evaluate('getComputedStyle(document.querySelector("[data-pane-id=pane-3]")).borderRadius'), '12px')
  await preview('Split Agent 1 bottom')
  await release(point)
  await desktop.wait(() => desktop.evaluate('document.querySelectorAll("[data-region=explorer] .pane").length === 3'), 'nested Agent groups')
  await settled()
  assert.equal(await desktop.evaluate(`document.querySelector('${explorer} .pane-layout').classList.contains('is-framed')`), true)
  const fourth = await bounds('[data-pane-id=pane-4]')
  assert.ok(fourth.y > (await bounds('[data-pane-id=pane-3]')).y)
  assert.equal(fourth.x, (await bounds('[data-pane-id=pane-3]')).x)
  assert.equal(await desktop.evaluate('document.querySelectorAll("[data-region]").length'), 2)

  // Whole groups dock only within their region, stay flush at rest, and resize smoothly.
  area = await bounds(`${explorer} .pane-layout`)
  point = { x: area.x + area.width / 2, y: area.y + 10 }
  await beginDrag('[data-pane-id=pane-4] .pane-drag-handle', point)
  await preview('Dock top')
  await release(point)
  await settled()
  const dockedFourth = await bounds('[data-pane-id=pane-4]')
  assert.ok(Math.abs((await bounds(group1)).y - (dockedFourth.y + dockedFourth.height) - 1) < 1)
  assert.ok(Math.abs(dockedFourth.width - (area.width - 2)) < 1)
  const innerDivider = `${explorer} .pane-split-vertical > .pane-divider`
  assert.equal(await desktop.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(innerDivider)}), '::after').opacity`), '0')
  const innerHandlePoint = await pointerPoint(innerDivider)
  await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...innerHandlePoint })
  await desktop.wait(() => desktop.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(innerDivider)}), '::after').opacity === '1'`), 'internal divider bar visible on hover')
  const beforeResize = await snapshot()
  end = await beginResize(innerDivider, 0, 40)
  await key('Escape')
  await release(end)
  assert.deepEqual(await snapshot(), beforeResize)
  end = await beginResize(innerDivider, 0, 40)
  await release(end)
  await desktop.evaluate(`document.querySelector(${JSON.stringify(innerDivider)}).focus()`)
  const beforeKeyboard = await bounds('[data-pane-id=pane-4]')
  await key('ArrowDown')
  await desktop.wait(async () => Math.abs((await bounds('[data-pane-id=pane-4]')).height - beforeKeyboard.height - 10) < 1, 'keyboard inner resize')

  // Content keeps its existing creation, tab transfer, reorder, and split behavior.
  await click('Add Content group')
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector("[data-pane-id=pane-5]"))'), 'Content Group 5')
  // A sole tab dropped in another group's body docks beside it instead of merging.
  const second = await bounds(group2)
  point = { x: second.x + second.width * 0.7, y: second.y + second.height * 0.6 }
  const beforeBodyDock = await snapshot()
  await beginDrag('#pane-5-tab-1', point)
  await preview('Dock right')
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".tab-drop-marker"))'), false)
  await key('Escape')
  await release(point)
  await settled()
  assert.deepEqual(await snapshot(), beforeBodyDock)
  await beginDrag('#pane-5-tab-1', point)
  const bodyDockPreview = await preview('Dock right')
  await release(point)
  await settled()
  const flushSecond = await bounds(group2)
  const flushFifth = await bounds('[data-pane-id=pane-5]')
  assert.ok(Math.abs(flushFifth.x - (flushSecond.x + flushSecond.width) - 1) < 1)
  assert.equal(await desktop.evaluate('document.querySelectorAll("[data-pane-id=pane-2] [role=tab]").length'), 1)
  assert.equal(await desktop.evaluate('document.getElementById("pane-5-tab-1").closest(".pane").dataset.paneId'), 'pane-5')
  // Only the tab-bar row inserts/merges, separating Content slots cleanly during drag.
  point = await pointerPoint(`${group2} .pane-drag-handle`)
  await beginDrag('#pane-5-tab-1', point)
  await desktop.wait(() => desktop.evaluate(`document.querySelector('${content} .pane-layout').classList.contains('is-separating')`), 'Content separates during sole-tab drag')
  await settled(`${content} .pane-layout`)
  sameRect(await bounds(`${content} .pane-slot-dragging`), bodyDockPreview)
  assert.equal(await desktop.evaluate(`document.querySelector('${explorer} .pane-layout').classList.contains('is-framed')`), true)
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector(".tab-drop-marker"))'), 'Content insertion marker')
  await release(point)
  await desktop.wait(() => desktop.evaluate('!document.querySelector("[data-pane-id=pane-5]")'), 'empty source group removed')
  await settled()
  const firstTab = await bounds('#pane-2-tab-1')
  point = { x: firstTab.x + 1, y: firstTab.y + firstTab.height / 2 }
  await beginDrag('#pane-5-tab-1', point)
  await release(point)
  await settled()
  assert.deepEqual(await desktop.evaluate(`[...document.querySelectorAll('[data-pane-id=pane-2] [role=tab]')].map(tab => tab.id)`), ['pane-5-tab-1', 'pane-2-tab-1'])
  area = await bounds(`${content} .pane-layout`)
  point = { x: area.x + area.width / 2, y: area.y + area.height * 0.7 }
  await beginDrag('#pane-5-tab-1', point)
  const contentPreview = await preview('Split Chat 1 bottom')
  await release(point)
  await settled()
  const flushTopContent = await bounds(group2)
  const flushBottomContent = await bounds('[data-pane-id=pane-6]')
  assert.ok(Math.abs(flushBottomContent.y - (flushTopContent.y + flushTopContent.height) - 1) < 1)

  // Cross-region tab and group drops have no preview and preserve both region trees.
  const beforeInvalid = await snapshot()
  point = await pointerPoint(`${content} .pane-layout`)
  await beginDrag('#pane-1-tab-1', point)
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), false)
  await release(point)
  assert.deepEqual(await snapshot(), beforeInvalid)
  point = await pointerPoint(`${group1} .pane-drag-handle`)
  await beginDrag('#pane-5-tab-1', point)
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), false)
  await release(point)
  assert.deepEqual(await snapshot(), beforeInvalid)
  await beginDrag('[data-pane-id=pane-6] .pane-drag-handle', point)
  await settled(`${content} .pane-layout`)
  sameRect(await bounds(`${content} .pane-slot-dragging`), contentPreview)
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), false)
  await release(point)
  assert.deepEqual(await snapshot(), beforeInvalid)

  // An undersized edge split must reject the drop instead of merging into another group.
  await click('Add tab to Group 1')
  await desktop.wait(() => desktop.evaluate('document.getElementById("pane-1-tab-4")?.getAttribute("aria-selected") === "true"'), 'new Agent tab selected in Group 1')
  const beforeTooSmall = await snapshot()
  area = await bounds(`${explorer} .pane-layout`)
  point = { x: area.x + area.width - 20, y: area.y + area.height - 90 }
  await beginDrag('#pane-1-tab-4', point)
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), false)
  await release(point)
  assert.deepEqual(await snapshot(), beforeTooSmall)
  point = { x: area.x - 1, y: area.y + area.height / 2 }
  await beginDrag('#pane-1-tab-4', point)
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), false)
  await release(point)
  assert.deepEqual(await snapshot(), beforeTooSmall)

  // Whole-region dragging swaps the two regions without resizing or changing either subtree.
  const outer = await bounds('.region-layout')
  const beforeSwap = await snapshot()
  const explorerSize = await bounds(explorer)
  point = { x: outer.x + outer.width - 10, y: outer.y + outer.height / 2 }
  await beginDrag(`${explorer} .region-drag-handle`, point)
  await preview('Swap regions')
  await settled('.region-floating')
  assert.equal(await desktop.evaluate(`document.querySelector('${explorer} .pane-layout').classList.contains('is-framed')`), true)
  assert.equal((await bounds('.region-floating')).width, explorerSize.width)
  assert.equal((await bounds('.region-floating')).height, explorerSize.height)
  await key('Escape')
  await release(point)
  await settled()
  assert.deepEqual(await snapshot(), beforeSwap)
  await beginDrag(`${explorer} .region-drag-handle`, point)
  const swapPreview = await preview('Swap regions')
  const swapImage = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(tmpdir(), 'granite-region-swap-preview.png'), Buffer.from(swapImage.data, 'base64'))
  await release(point)
  await desktop.wait(() => desktop.evaluate('document.querySelector("[data-region]").dataset.region === "content"'), 'Explorer moved to the right')
  await settled()
  sameRect(await bounds(explorer), swapPreview)
  assert.deepEqual(await snapshot(), beforeSwap)
  point = { x: outer.x + outer.width / 2, y: outer.y + 1 }
  await beginDrag(`${explorer} .region-drag-handle`, point)
  assert.equal(await desktop.evaluate('Boolean(document.querySelector(".pane-dock-preview"))'), false)
  await release(point)
  await settled()
  assert.equal(await desktop.evaluate('document.querySelector("[data-region]").dataset.region'), 'content')
  point = { x: outer.x + outer.width - 10, y: outer.y + outer.height / 2 }
  await beginDrag(`${content} .region-drag-handle`, point)
  await preview('Swap regions')
  await release(point)
  await settled()
  assert.equal(await desktop.evaluate('document.querySelector("[data-region]").dataset.region'), 'explorer')
  assert.deepEqual(await snapshot(), beforeSwap)
  await desktop.evaluate(`document.querySelector('${explorer} .region-drag-handle').focus()`)
  await key('ArrowRight')
  await desktop.wait(() => desktop.evaluate('document.querySelector("[data-region]").dataset.region === "content"'), 'keyboard region swap')
  await settled()
  await key('ArrowLeft')
  await desktop.wait(() => desktop.evaluate('document.querySelector("[data-region]").dataset.region === "explorer"'), 'keyboard region swap back')
  await settled()

  // Closing groups leaves both typed regions available; canceled splits consumed no group IDs.
  await click('Close Group 4')
  await click('Close Group 3')
  await click('Close Agent 4 in Group 1')
  await click('Close Agent 1 in Group 1')
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector("[data-region=explorer] .region-empty"))'), 'empty Explorer remains')
  assert.equal(await desktop.evaluate('document.querySelectorAll("[data-region]").length'), 2)
  await click('Close Group 6')
  await click('Close Chat 1 in Group 2')
  await desktop.wait(() => desktop.evaluate('document.querySelectorAll(".region-empty").length === 2'), 'both regions empty')
  await desktop.fill('select[aria-label="New group region"]', 'explorer', 'select')
  await click('Add Explorer group')
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector("[data-region=explorer] [data-pane-id=pane-7]"))'), 'Explorer restored with next group ID')
  await desktop.fill('select[aria-label="New group region"]', 'content', 'select')
  await click('Add Content group')
  await desktop.wait(() => desktop.evaluate('Boolean(document.querySelector("[data-region=content] [data-pane-id=pane-8]"))'), 'Content restored')
  await settled()

  // Overlapping transitions apply every queued update sequentially without errors.
  await desktop.evaluate(`(() => {
    const add = document.querySelector('[aria-label="Add tab to Group 7"]');
    add.click();
    add.click();
  })()`)
  await desktop.wait(() => desktop.evaluate('Boolean(document.getElementById("pane-7-tab-3"))'), 'overlapping tab additions committed')
  await desktop.evaluate(`(() => {
    document.querySelector('[aria-label="Close Agent 3 in Group 7"]').click();
    document.querySelector('[aria-label="Close Agent 2 in Group 7"]').click();
  })()`)
  await desktop.wait(() => desktop.evaluate('document.querySelectorAll("[data-pane-id=pane-7] [role=tab]").length === 1'), 'overlapping tab closes committed')
  await settled()

  // Viewport checks run after pointer input so emulation cannot alter its coordinate mapping.
  const beforeViewport = await bounds(explorer)
  const beforeContent = await bounds(content)
  const originalViewport = await desktop.evaluate('({width: innerWidth, height: innerHeight})')
  await desktop.rpc('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, deviceScaleFactor: 1, mobile: false })
  await desktop.wait(async () => (await bounds(explorer)).width < beforeViewport.width - 20, 'viewport resize')
  const smallExplorer = await bounds(explorer)
  const smallContent = await bounds(content)
  assert.ok(Math.abs(smallExplorer.width / (smallExplorer.width + smallContent.width) - beforeViewport.width / (beforeViewport.width + beforeContent.width)) < 0.002)
  await desktop.rpc('Emulation.setDeviceMetricsOverride', { ...originalViewport, deviceScaleFactor: 1, mobile: false })
  await desktop.wait(async () => Math.abs((await bounds(explorer)).width - beforeViewport.width) < 1, 'viewport proportions restored')
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
  assert.deepEqual(await desktop.evaluate('window.__shellErrors'), [])
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
  console.log(`Typed regions, width-preserving swaps, Agent/Content splits, scoped tab/group movement, resizing, cancellation, empty-region recovery, isolation, and local connections passed. Screenshot: ${imagePath}`)
} finally {
  await desktop.quit()
  await new Promise((resolve, reject) => provider.close(error => error ? reject(error) : resolve()))
  await rm(directory, { recursive: true, force: true })
}
