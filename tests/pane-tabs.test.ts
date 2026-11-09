import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addTab, closeTab, selectTab } from '../src/renderer/src/components/panes/tabs.ts'
import { addPane, createPane, findPane, moveTab, dockPane, initialLayout, removePane, updatePane } from '../src/renderer/src/components/panes/layout.ts'

test('panes start with one selected tab, and adding selects a uniquely numbered tab', () => {
  const initial = createPane('test', 'Test')
  assert.equal(initial.tabs.length, 1)
  assert.equal(initial.activeTabId, initial.tabs[0].id)
  const two = addTab(initial)
  assert.equal(two.activeTabId, 'test-tab-2')
  assert.equal(two.tabs[1].title, 'Chat 2')
  const closed = closeTab(two, two.activeTabId)!
  const next = addTab(closed)
  assert.equal(next.activeTabId, 'test-tab-3')
  assert.equal(initial.tabs.length, 1)
})

test('closing chooses the right neighbor, then the left, and preserves selection for inactive tabs', () => {
  const pane = addTab(addTab(createPane('test', 'Test')))
  const middle = selectTab(pane, 'test-tab-2')
  assert.equal(closeTab(middle, 'test-tab-2')!.activeTabId, 'test-tab-3')
  assert.equal(closeTab(pane, 'test-tab-3')!.activeTabId, 'test-tab-2')
  assert.equal(closeTab(pane, 'test-tab-1')!.activeTabId, 'test-tab-3')
  assert.equal(selectTab(pane, 'missing'), pane)
  assert.equal(closeTab(pane, 'missing'), pane)
})

test('closing the final tab removes its pane and collapses the split', () => {
  const closed = updatePane(initialLayout, 'pane-1', pane => closeTab(pane, pane.activeTabId))!
  assert.equal(closed.kind, 'pane')
  assert.equal(closed.kind === 'pane' && closed.id, 'pane-2')
  const empty = updatePane(closed, 'pane-2', pane => closeTab(pane, pane.activeTabId))
  assert.equal(empty, null)
})

test('docking preserves all tabs and selection, while whole-pane closing removes the group', () => {
  const edited = updatePane(initialLayout, 'pane-1', pane => addTab(addTab(pane)))!
  const moved = dockPane(edited, 'pane-1', { paneId: 'pane-2', edge: 'bottom' })
  assert.equal(moved.kind, 'split')
  assert.ok(moved.kind === 'split' && moved.second.kind === 'pane')
  assert.equal(moved.second.id, 'pane-1')
  assert.equal(moved.second.tabs.length, 3)
  assert.equal(moved.second.activeTabId, 'pane-1-tab-3')
  const closed = removePane(moved, 'pane-1')!
  assert.equal(closed.kind === 'pane' && closed.id, 'pane-2')
})


test('pane families accept their own tab kinds and reject incompatible additions without side effects', () => {
  const navigation = createPane('nav', 'Navigation', 'navigation')
  assert.equal(navigation.tabs[0].type, 'agent')
  assert.equal(addTab(navigation).tabs[1].title, 'Agent 2')
  for (const type of ['chat', 'image', 'file'] as const) {
    assert.equal(addTab(navigation, type), navigation)
  }
  const content = createPane('content', 'Content', 'content')
  assert.equal(content.tabs[0].type, 'chat')
  assert.equal(addTab(content, 'agent'), content)
  const mixed = addTab(addTab(content, 'image'), 'file')
  assert.deepEqual(mixed.tabs.map(tab => tab.type), ['chat', 'image', 'file'])
  assert.equal(mixed.tabs[2].title, 'File 3')
  assert.equal(mixed.activeTabId, mixed.tabs[2].id)
})

test('the navigation pane is unique and can be restored after closing', () => {
  const navigation = createPane('nav-new', 'Navigation', 'navigation')
  const bounds = { x: 0, y: 0, width: 1000, height: 700 }
  assert.equal(addPane(initialLayout, navigation, bounds), initialLayout)
  const closed = removePane(initialLayout, 'pane-1')!
  const restored = addPane(closed, navigation, bounds)!
  assert.equal(restored.kind, 'split')
  assert.equal(navigation.paneType, 'navigation')
  assert.equal(navigation.tabs[0].type, 'agent')
  assert.equal(addPane(restored, createPane('another', 'Other', 'navigation'), bounds), restored)
})

test('whole-pane docking preserves its family and can place different families beside each other', () => {
  const moved = dockPane(initialLayout, 'pane-1', { paneId: 'pane-2', edge: 'bottom' })
  assert.ok(moved.kind === 'split' && moved.first.kind === 'pane' && moved.second.kind === 'pane')
  assert.equal(moved.first.paneType, 'content')
  assert.equal(moved.second.paneType, 'navigation')
  assert.equal(moved.second.tabs[0].type, 'agent')
})


test('tab transfer preserves identity, selects the destination, and settles source selection', () => {
  const source = addTab(createPane('source', 'Source'), 'image')
  const target = createPane('target', 'Target')
  const layout = { kind: 'split', axis: 'horizontal', ratio: 0.6, first: source, second: target } as const
  const moved = moveTab(layout, source.id, source.activeTabId, target.id, 0)
  assert.equal(findPane(moved, source.id)!.activeTabId, source.tabs[0].id)
  assert.equal(findPane(moved, target.id)!.tabs[0], source.tabs[1])
  assert.equal(findPane(moved, target.id)!.activeTabId, source.tabs[1].id)
  assert.equal(findPane(moved, target.id)!.tabs[1], target.tabs[0])
  assert.equal(source.tabs.length, 2)
  assert.equal(target.tabs.length, 1)
  assert.ok(moved.kind === 'split')
  assert.equal(moved.ratio, 0.6)
})

test('moving a final tab collapses its pane and preserves the tab in its destination', () => {
  const source = createPane('source', 'Source')
  const target = createPane('target', 'Target')
  const layout = { kind: 'split', axis: 'vertical', ratio: 0.5, first: source, second: target } as const
  const moved = moveTab(layout, source.id, source.activeTabId, target.id)
  assert.ok(moved.kind === 'pane')
  assert.equal(moved.id, target.id)
  assert.deepEqual(moved.tabs, [target.tabs[0], source.tabs[0]])
  assert.equal(moved.tabs[1], source.tabs[0])
})

test('incompatible and stale transfers leave the original layout unchanged', () => {
  assert.equal(moveTab(initialLayout, 'pane-1', 'pane-1-tab-1', 'pane-2'), initialLayout)
  assert.equal(moveTab(initialLayout, 'pane-2', 'pane-2-tab-1', 'pane-1'), initialLayout)
  assert.equal(moveTab(initialLayout, 'missing', 'pane-2-tab-1', 'pane-1'), initialLayout)
  assert.equal(moveTab(initialLayout, 'pane-2', 'missing', 'pane-1'), initialLayout)
  assert.equal(moveTab(initialLayout, 'pane-2', 'pane-2-tab-1', 'missing'), initialLayout)
})

test('tab-bar insertion reorders both directions without duplicating tabs', () => {
  const pane = addTab(addTab(createPane('content', 'Content')))
  const firstToLast = moveTab(pane, pane.id, pane.tabs[0].id, pane.id, 3)
  assert.deepEqual(findPane(firstToLast, pane.id)!.tabs.map(tab => tab.id), [pane.tabs[1].id, pane.tabs[2].id, pane.tabs[0].id])
  const lastToFirst = moveTab(firstToLast, pane.id, pane.tabs[0].id, pane.id, 0)
  assert.deepEqual(findPane(lastToFirst, pane.id)!.tabs, pane.tabs)
  assert.equal(moveTab(pane, pane.id, pane.tabs[1].id, pane.id, 2), pane)
})

test('transfers preserve source numbering and cannot collide with destination-generated IDs', () => {
  const source = addTab(createPane('source', 'Source'))
  const target = createPane('target', 'Target')
  const layout = { kind: 'split', axis: 'horizontal', ratio: 0.5, first: source, second: target } as const
  const moved = moveTab(layout, source.id, source.activeTabId, target.id)
  const destination = addTab(findPane(moved, target.id)!)
  assert.equal(new Set(destination.tabs.map(tab => tab.id)).size, 3)
  assert.equal(addTab(findPane(moved, source.id)!).activeTabId, 'source-tab-3')
})
