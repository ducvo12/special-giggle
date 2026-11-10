import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addTab, closeTab, selectTab } from '../src/renderer/src/components/panes/tabs.ts'
import { addPane, createPane, findPane, moveTab, dockPane, dockTab, dockingTargetAt, dockingPreview, paneRects, removePane, updatePane } from '../src/renderer/src/components/panes/layout.ts'

import { initialLayout } from './fixtures/panes.ts'

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
  const explorer = createPane('nav', 'Explorer', 'explorer')
  assert.equal(explorer.tabs[0].type, 'agent')
  assert.equal(addTab(explorer).tabs[1].title, 'Agent 2')
  for (const type of ['chat', 'image', 'file'] as const) {
    assert.equal(addTab(explorer, type), explorer)
  }
  const content = createPane('content', 'Content', 'content')
  assert.equal(content.tabs[0].type, 'chat')
  assert.equal(addTab(content, 'agent'), content)
  const mixed = addTab(addTab(content, 'image'), 'file')
  assert.deepEqual(mixed.tabs.map(tab => tab.type), ['chat', 'image', 'file'])
  assert.equal(mixed.tabs[2].title, 'File 3')
  assert.equal(mixed.activeTabId, mixed.tabs[2].id)
})

test('Explorer accepts multiple groups while each region rejects a different family', () => {
  const first = createPane('first', 'First', 'explorer')
  const second = createPane('second', 'Second', 'explorer')
  const bounds = { x: 0, y: 0, width: 1000, height: 700 }
  const layout = addPane(first, second, bounds)!
  assert.equal(paneRects(layout, bounds).size, 2)
  assert.equal(addPane(layout, createPane('chat', 'Chat'), bounds), layout)
  assert.equal(addPane(initialLayout, second, bounds), initialLayout)
  const moved = dockPane(layout, first.id, { paneId: second.id, edge: 'bottom' })
  assert.equal(findPane(moved, first.id)!.paneType, 'explorer')
  assert.equal(findPane(moved, second.id), second)
  assert.equal(findPane(moved, first.id)!.tabs[0], first.tabs[0])
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
  const mixed = { kind: 'split', axis: 'horizontal', ratio: 0.5,
    first: createPane('pane-1', 'Explorer', 'explorer'), second: createPane('pane-2', 'Content') } as const
  assert.equal(moveTab(mixed, 'pane-1', 'pane-1-tab-1', 'pane-2'), mixed)
  assert.equal(moveTab(mixed, 'pane-2', 'pane-2-tab-1', 'pane-1'), mixed)
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

test('both families can detach a grouped tab beside its source, another group, or the region edge', () => {
  for (const family of ['explorer', 'content'] as const) {
    const source = addTab(addTab(createPane('source', 'Source', family)))
    const other = createPane('other', 'Other', family)
    const layout = { kind: 'split', axis: 'horizontal', ratio: 0.5, first: source, second: other } as const
    const bounds = { x: 0, y: 0, width: 1400, height: 900 }
    for (const paneId of [source.id, other.id, null]) {
      for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
        const tab = source.tabs[1]
        const selected = updatePane(layout, source.id, pane => selectTab(pane, tab.id))!
        const moved = dockTab(selected, source.id, tab.id, { id: 'new', title: 'New' }, { paneId, edge })
        const detached = findPane(moved, 'new')!
        assert.deepEqual(detached.tabs, [tab])
        assert.equal(detached.tabs[0], tab)
        assert.equal(detached.activeTabId, tab.id)
        assert.equal(detached.paneType, family)
        const remaining = findPane(moved, source.id)!
        assert.deepEqual(remaining.tabs, [source.tabs[0], source.tabs[2]])
        assert.equal(remaining.activeTabId, source.tabs[2].id)
        assert.equal(remaining.nextTab, source.nextTab)
        assert.equal(findPane(moved, other.id), other)
        const rects = paneRects(moved, bounds)
        const placed = rects.get('new')!
        const sibling = rects.get(paneId ?? source.id)!
        if (edge === 'left') assert.ok(placed.x < sibling.x)
        if (edge === 'right') assert.ok(placed.x > sibling.x)
        if (edge === 'top') assert.ok(placed.y < sibling.y)
        if (edge === 'bottom') assert.ok(placed.y > sibling.y)
        assert.equal(rects.size, 3)
      }
    }
    assert.equal(source.tabs.length, 3)
  }
})

test('detachment preserves inactive selection and uses the new pane namespace for future tabs', () => {
  const source = addTab(createPane('source', 'Source'))
  const moved = dockTab(source, source.id, source.tabs[0].id, { id: 'new', title: 'New' }, { paneId: source.id, edge: 'bottom' })
  assert.equal(findPane(moved, source.id)!.activeTabId, source.activeTabId)
  assert.equal(addTab(findPane(moved, 'new')!).activeTabId, 'new-tab-1')
  assert.equal(addTab(findPane(moved, source.id)!).activeTabId, 'source-tab-3')
})

test('detachment rejects sole tabs, stale inputs, and reused pane IDs', () => {
  const layout = updatePane(initialLayout, 'pane-2', pane => addTab(pane))!
  const identity = { id: 'new', title: 'New' }
  const target = { paneId: 'pane-2', edge: 'bottom' } as const
  assert.equal(dockTab(initialLayout, 'pane-2', 'pane-2-tab-1', identity, target), initialLayout)
  assert.equal(dockTab(layout, 'missing', 'pane-2-tab-1', identity, target), layout)
  assert.equal(dockTab(layout, 'pane-2', 'missing', identity, target), layout)
  assert.equal(dockTab(layout, 'pane-2', 'pane-2-tab-1', identity, { ...target, paneId: 'missing' }), layout)
  assert.equal(dockTab(layout, 'pane-2', 'pane-2-tab-1', { id: 'pane-1', title: 'Reused' }, target), layout)
})

test('tab docking previews match final geometry and reject splits that cannot fit', () => {
  const source = addTab(createPane('source', 'Source'))
  const bounds = { x: 0, y: 0, width: 1000, height: 700 }
  const target = dockingTargetAt(source, bounds, 500, 90)!
  assert.deepEqual(target, { paneId: source.id, edge: 'top' })
  const moved = dockTab(source, source.id, source.activeTabId, { id: 'new', title: 'New' }, target)
  assert.deepEqual(dockingPreview(moved, 'new', target, bounds)!.preview, paneRects(moved, bounds).get('new'))
  assert.equal(dockingPreview(moved, 'new', target, { ...bounds, height: 291 }), null)
  assert.equal(dockingPreview(moved, 'new', target, { ...bounds, height: 292 })!.preview.height, 140)
  assert.equal(dockingTargetAt(source, bounds, 500, 350), null)
  assert.equal(dockingTargetAt(source, bounds, -1, 90), null)
})
