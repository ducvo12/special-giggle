import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addPane, createPane, removePane, dockPane, dockingAt, tabDockingTargetAt, paneRects, resizeSplit, type Layout } from '../src/renderer/src/components/panes/layout.ts'

import { initialLayout } from './fixtures/panes.ts'

const bounds = { x: 0, y: 0, width: 1000, height: 700 }

function ids(layout: Layout): string[] {
  return [...paneRects(layout, bounds).keys()].sort()
}

test('docking moves a pane in all four directions without losing or duplicating views', () => {
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    const layout = dockPane(initialLayout, 'pane-1', { paneId: 'pane-2', edge })
    assert.deepEqual(ids(layout), ['pane-1', 'pane-2'])
    const rects = paneRects(layout, bounds)
    const first = rects.get('pane-1')!
    const second = rects.get('pane-2')!
    if (edge === 'left') assert.ok(first.x < second.x)
    if (edge === 'right') assert.ok(first.x > second.x)
    if (edge === 'top') assert.ok(first.y < second.y)
    if (edge === 'bottom') assert.ok(first.y > second.y)
  }
})

test('pane docking affects its target while workspace docking spans the whole edge', () => {
  const third: Layout = createPane('pane-3', 'Pane 3')
  const layout: Layout = { kind: 'split', axis: 'horizontal', ratio: 0.5, first: initialLayout, second: third }
  const local = dockPane(layout, 'pane-1', { paneId: 'pane-2', edge: 'top' })
  const global = dockPane(layout, 'pane-1', { paneId: null, edge: 'top' })
  assert.deepEqual(ids(local), ['pane-1', 'pane-2', 'pane-3'])
  assert.deepEqual(ids(global), ['pane-1', 'pane-2', 'pane-3'])
  const localRects = paneRects(local, bounds)
  assert.equal(localRects.get('pane-3')!.height, bounds.height)
  assert.ok(localRects.get('pane-1')!.width < bounds.width / 2)
  assert.equal(paneRects(global, bounds).get('pane-1')!.width, bounds.width)
})

test('self, missing-source, missing-target, and single-pane moves preserve the layout', () => {
  assert.equal(dockPane(initialLayout, 'pane-1', { paneId: 'pane-1', edge: 'top' }), initialLayout)
  assert.equal(dockPane(initialLayout, 'missing', { paneId: null, edge: 'top' }), initialLayout)
  assert.equal(dockPane(initialLayout, 'pane-1', { paneId: 'missing', edge: 'top' }), initialLayout)
  const single: Layout = createPane('only', 'Only')
  assert.equal(dockPane(single, 'only', { paneId: null, edge: 'left' }), single)
})

test('hit testing prioritizes workspace edges and rejects centers, source panes, and outside drops', () => {
  assert.deepEqual(dockingAt(initialLayout, 'pane-1', bounds, 800, 10)?.target, { paneId: null, edge: 'top' })
  assert.deepEqual(dockingAt(initialLayout, 'pane-1', bounds, 800, 610)?.target, { paneId: 'pane-2', edge: 'bottom' })
  assert.equal(dockingAt(initialLayout, 'pane-1', bounds, 800, 350), null)
  assert.equal(dockingAt(initialLayout, 'pane-1', bounds, 100, 350), null)
  assert.equal(dockingAt(initialLayout, 'pane-1', bounds, 1010, 350), null)
})

test('previews show the committed pane position and undersized arrangements cannot be docked', () => {
  const drop = dockingAt(initialLayout, 'pane-1', bounds, 800, 610)!
  assert.deepEqual(drop.preview, paneRects(drop.layout, bounds).get('pane-1'))
  assert.equal(drop.preview.width, bounds.width)
  assert.equal(dockingAt(initialLayout, 'pane-1', { ...bounds, height: 280 }, 800, 275), null)
  assert.equal(dockingAt(initialLayout, 'pane-1', { ...bounds, width: 400 }, 1, 350), null)
})

test('docking engages farther inside workspace and pane edges while keeping centers neutral', () => {
  assert.deepEqual(dockingAt(initialLayout, 'pane-1', bounds, 60, 350)?.target, { paneId: null, edge: 'left' })
  assert.deepEqual(dockingAt(initialLayout, 'pane-1', bounds, 800, 60)?.target, { paneId: null, edge: 'top' })
  assert.deepEqual(dockingAt(initialLayout, 'pane-1', bounds, 800, 90)?.target, { paneId: 'pane-2', edge: 'top' })
  assert.equal(dockingAt(initialLayout, 'pane-1', bounds, 800, 350), null)
})

test('tab docking covers the full group interior with four proportional targets and no neutral center', () => {
  const group = createPane('group', 'Group')
  const large = { x: 0, y: 0, width: 1600, height: 1000 }
  for (const [x, y, edge] of [
    [480, 500, 'left'], [1120, 500, 'right'],
    [800, 300, 'top'], [800, 700, 'bottom'], [800, 500, 'left']
  ] as const) {
    assert.deepEqual(tabDockingTargetAt(group, large, x, y), { paneId: group.id, edge })
  }
})

test('tab split targets stay proportional in tall and wide groups', () => {
  const group = createPane('group', 'Group')
  const tall = { x: 100, y: 50, width: 800, height: 1800 }
  const wide = { x: 100, y: 50, width: 1800, height: 800 }
  assert.deepEqual(tabDockingTargetAt(group, tall, 500, 680), { paneId: group.id, edge: 'top' })
  assert.deepEqual(tabDockingTargetAt(group, tall, 500, 1220), { paneId: group.id, edge: 'bottom' })
  assert.deepEqual(tabDockingTargetAt(group, wide, 730, 450), { paneId: group.id, edge: 'left' })
  assert.deepEqual(tabDockingTargetAt(group, wide, 1270, 450), { paneId: group.id, edge: 'right' })
})

test('tab docking targets the hovered group, retains region-edge docking, and rejects gaps and outside points', () => {
  const large = { x: 0, y: 0, width: 1600, height: 1000 }
  for (const [id, rect] of paneRects(initialLayout, large)) {
    for (const x of [0.2, 0.4, 0.6, 0.8]) {
      for (const y of [0.2, 0.4, 0.6, 0.8]) {
        assert.equal(tabDockingTargetAt(initialLayout, large, rect.x + rect.width * x, rect.y + rect.height * y)!.paneId, id)
      }
    }
  }
  assert.deepEqual(tabDockingTargetAt(initialLayout, large, 10, 500), { paneId: null, edge: 'left' })
  assert.deepEqual(tabDockingTargetAt(initialLayout, large, 1590, 500), { paneId: null, edge: 'right' })
  assert.deepEqual(tabDockingTargetAt(initialLayout, large, 800, 10), { paneId: null, edge: 'top' })
  assert.deepEqual(tabDockingTargetAt(initialLayout, large, 800, 990), { paneId: null, edge: 'bottom' })
  assert.equal(tabDockingTargetAt(initialLayout, large, 800, 500), null)
  assert.equal(tabDockingTargetAt(initialLayout, large, -1, 500), null)
  assert.equal(tabDockingTargetAt(initialLayout, large, 1601, 500), null)
  assert.equal(tabDockingTargetAt(initialLayout, large, 500, -1), null)
  assert.equal(tabDockingTargetAt(initialLayout, large, 500, 1001), null)
})

test('resizing clamps both sides to their minimum dimensions in either orientation', () => {
  const narrow = resizeSplit(initialLayout, [], 0, bounds.width - 12)
  assert.equal(paneRects(narrow, bounds).get('pane-1')!.width, 200)
  const wide = resizeSplit(initialLayout, [], 1, bounds.width - 12)
  assert.equal(paneRects(wide, bounds).get('pane-2')!.width, 200)
  const vertical = dockPane(initialLayout, 'pane-1', { paneId: null, edge: 'top' })
  const short = resizeSplit(vertical, [], 0, bounds.height - 12)
  assert.equal(paneRects(short, bounds).get('pane-1')!.height, 140)
  const tall = resizeSplit(vertical, [], 1, bounds.height - 12)
  assert.equal(paneRects(tall, bounds).get('pane-2')!.height, 140)
})

test('resizing updates only the selected split and protects nested pane minimums', () => {
  const nested: Layout = {
    kind: 'split', axis: 'horizontal', ratio: 0.6,
    first: initialLayout,
    second: createPane('pane-3', 'Pane 3')
  }
  const resized = resizeSplit(nested, ['first'], 1, 580.8)
  assert.equal(resized.kind, 'split')
  if (resized.kind !== 'split') return
  assert.equal(resized.ratio, nested.ratio)
  assert.equal(resized.second, nested.second)
  assert.equal(paneRects(resized, bounds).get('pane-2')!.width, 200)
  const constrained = resizeSplit(nested, [], 0, bounds.width - 12)
  const rects = paneRects(constrained, bounds)
  assert.equal(rects.get('pane-1')!.width, 200)
  assert.equal(rects.get('pane-2')!.width, 200)
  assert.equal(nested.first, initialLayout)
})

test('window resizing preserves preferred proportions and restores them after minimum constraints', () => {
  const layout = resizeSplit(initialLayout, [], 0.75, bounds.width - 12)
  assert.equal(paneRects(layout, bounds).get('pane-1')!.width, 741)
  const small = paneRects(layout, { ...bounds, width: 600 })
  assert.equal(small.get('pane-2')!.width, 200)
  assert.equal(small.get('pane-1')!.width, 388)
  assert.equal(paneRects(layout, bounds).get('pane-1')!.width, 741)
})


test('adding panes creates nested layouts without changing existing pane identities', () => {
  const third: Layout = createPane('pane-3', 'Pane 3')
  const fourth: Layout = createPane('pane-4', 'Pane 4')
  const three = addPane(initialLayout, third, bounds)!
  const four = addPane(three, fourth, bounds)!
  assert.deepEqual(ids(four), ['pane-1', 'pane-2', 'pane-3', 'pane-4'])
  for (const rect of paneRects(four, bounds).values()) {
    assert.ok(rect.width >= 200 && rect.height >= 140)
  }
  assert.deepEqual(ids(initialLayout), ['pane-1', 'pane-2'])
})

test('creation refuses layouts without room and can restore an empty workspace', () => {
  const pane: Layout = createPane('new', 'New')
  const small = { x: 0, y: 0, width: 200, height: 140 }
  assert.equal(addPane(null, pane, small), pane)
  assert.equal(addPane(null, pane, { ...small, width: 199 }), null)
  assert.equal(addPane(pane, createPane('other', 'Other'), small), pane)
})

test('closing panes collapses their split, preserves other proportions, and permits an empty tree', () => {
  const nested: Layout = {
    kind: 'split', axis: 'vertical', ratio: 0.7,
    first: initialLayout,
    second: createPane('pane-3', 'Pane 3')
  }
  const closed = removePane(nested, 'pane-1')!
  assert.equal(closed.kind, 'split')
  if (closed.kind !== 'split') return
  assert.equal(closed.ratio, 0.7)
  assert.equal(closed.first, initialLayout.kind === 'split' ? initialLayout.second : null)
  const last = removePane(closed, 'pane-3')!
  assert.equal(last.kind, 'pane')
  assert.equal(removePane(last, 'pane-2'), null)
  assert.deepEqual(ids(nested), ['pane-1', 'pane-2', 'pane-3'])
})
