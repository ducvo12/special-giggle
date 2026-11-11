import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPane, dockTab, findPane, minimumPaneSize, removePane } from '../src/renderer/src/components/panes/layout.ts'
import { addTab } from '../src/renderer/src/components/panes/tabs.ts'
import { initialRegions, regionGap, regionRects, regionSwapAt, regionsMinimum, resizeRegions, swapRegions, updateRegion, type RegionLayout } from '../src/renderer/src/components/panes/regions.ts'

const bounds = { x: 0, y: 0, width: 1100, height: 700 }

test('the workspace has exactly two unique typed regions, initially Explorer then Content', () => {
  assert.deepEqual(initialRegions.regions.map(region => region.type), ['explorer', 'content'])
  assert.equal(initialRegions.regions[0].layout!.kind, 'pane')
  assert.equal(findPane(initialRegions.regions[0].layout!, 'pane-1')!.tabs[0].type, 'agent')
  assert.equal(findPane(initialRegions.regions[1].layout!, 'pane-2')!.tabs[0].type, 'chat')
  const rects = regionRects(initialRegions, bounds)
  assert.equal(rects.get('explorer')!.y, rects.get('content')!.y)
  assert.equal(rects.get('explorer')!.height, bounds.height)
  assert.ok(rects.get('explorer')!.x < rects.get('content')!.x)
})

test('a region accepts only its own family, including every branch of a nested tree', () => {
  const explorer = initialRegions.regions[0].layout!
  const chat = createPane('chat', 'Chat')
  assert.equal(updateRegion(initialRegions, 'explorer', chat), initialRegions)
  assert.equal(updateRegion(initialRegions, 'content', explorer), initialRegions)
  const mixed = { kind: 'split', axis: 'vertical', ratio: 0.5, first: explorer, second: chat } as const
  assert.equal(updateRegion(initialRegions, 'explorer', mixed), initialRegions)
  assert.equal(updateRegion(initialRegions, 'content', mixed), initialRegions)
  const grouped = addTab(findPane(explorer, 'pane-1')!)
  const split = dockTab(grouped, grouped.id, grouped.activeTabId, { id: 'agents', title: 'Agents' }, { paneId: grouped.id, edge: 'right' })
  const updated = updateRegion(initialRegions, 'explorer', split)
  assert.equal(updated.regions.length, 2)
  assert.equal(updated.regions[0].layout, split)
  assert.equal(updated.regions[1], initialRegions.regions[1])
})

test('swapping regions preserves widths, group trees, tabs, and preferred proportions at constrained sizes', () => {
  const source = addTab(createPane('agent', 'Agent', 'explorer'))
  const groups = dockTab(source, source.id, source.activeTabId, { id: 'agents', title: 'Agents' }, { paneId: source.id, edge: 'right' })
  const nested = updateRegion(initialRegions, 'explorer', groups)
  for (const ratio of [0.2, 0.5, 0.8]) {
    const layout = { ...nested, ratio }
    const swapped = swapRegions(layout)
    assert.equal(swapped.regions[0], layout.regions[1])
    assert.equal(swapped.regions[1], layout.regions[0])
    for (const width of [700, 1100, 1400]) {
      const sized = { ...bounds, width }
      const before = regionRects(layout, sized)
      const after = regionRects(swapped, sized)
      for (const type of ['explorer', 'content'] as const) {
        assert.ok(Math.abs(before.get(type)!.width - after.get(type)!.width) < 0.001)
        assert.equal(after.get(type)!.height, bounds.height)
      }
      assert.equal(after.get('content')!.x, bounds.x)
      assert.ok(after.get('explorer')!.x > after.get('content')!.x)
    }
    assert.ok(Math.abs(swapRegions(swapped).ratio - layout.ratio) < 0.001)
  }
})

test('only the opposite horizontal edge offers a region swap and its preview matches the final region', () => {
  const layout = resizeRegions(initialRegions, 0.3, bounds.width - regionGap)
  const drop = regionSwapAt(layout, 'explorer', bounds, 1090, 350)!
  assert.equal(drop.layout.regions[1].type, 'explorer')
  assert.deepEqual(drop.preview, regionRects(drop.layout, bounds).get('explorer'))
  assert.ok(Math.abs(drop.preview.width - regionRects(layout, bounds).get('explorer')!.width) < 1e-9)
  assert.equal(regionSwapAt(layout, 'explorer', bounds, 10, 350), null)
  assert.equal(regionSwapAt(layout, 'explorer', bounds, 550, 1), null)
  assert.equal(regionSwapAt(layout, 'explorer', bounds, 550, 699), null)
  assert.equal(regionSwapAt(layout, 'explorer', bounds, 1101, 350), null)
  assert.equal(regionSwapAt(layout, 'explorer', bounds, 1090, 701), null)
  assert.equal(regionSwapAt(layout, 'content', bounds, 1090, 350), null)
  assert.equal(regionSwapAt(layout, 'content', bounds, 10, 350)!.layout.regions[0].type, 'content')
  assert.equal(regionSwapAt(drop.layout, 'explorer', bounds, 10, 350)!.layout.regions[0].type, 'explorer')
})

test('outer resizing and native minimums include every nested group', () => {
  const explorer = createPane('agent', 'Agent', 'explorer')
  const content = createPane('chat', 'Chat')
  const layout: RegionLayout = {
    regions: [
      { type: 'explorer', layout: { kind: 'split', axis: 'horizontal', ratio: 0.5, first: explorer, second: createPane('agent-2', 'Agent 2', 'explorer') } },
      { type: 'content', layout: { kind: 'split', axis: 'vertical', ratio: 0.5, first: content, second: createPane('chat-2', 'Chat 2') } }
    ], ratio: 0.5
  }
  assert.deepEqual(regionsMinimum(layout), { width: 618, height: 292 })
  const small = resizeRegions(layout, 0, bounds.width - regionGap)
  assert.equal(regionRects(small, bounds).get('explorer')!.width, 412)
  const large = resizeRegions(layout, 1, bounds.width - regionGap)
  assert.equal(regionRects(large, bounds).get('content')!.width, minimumPaneSize.width)
  const preferred = { ...layout, ratio: 0.7 }
  assert.ok(regionRects(preferred, { ...bounds, width: 700 }).get('content')!.width >= 200)
  assert.equal(regionRects(preferred, bounds).get('explorer')!.width, (bounds.width - regionGap) * 0.7)
})

test('closing the final group leaves its typed region empty, sized, swappable, and refillable', () => {
  const empty = updateRegion(initialRegions, 'explorer', removePane(initialRegions.regions[0].layout!, 'pane-1'))
  assert.equal(empty.regions.length, 2)
  assert.equal(empty.regions[0].layout, null)
  assert.deepEqual(regionsMinimum(empty), { width: 406, height: 140 })
  assert.equal(swapRegions(empty).regions[1].type, 'explorer')
  const filled = updateRegion(empty, 'explorer', createPane('new-agent', 'New Agent', 'explorer'))
  assert.equal(findPane(filled.regions[0].layout!, 'new-agent')!.tabs[0].type, 'agent')
  assert.equal(filled.regions[1], initialRegions.regions[1])
})
