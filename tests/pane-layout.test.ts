import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPane, removePane, dockPane, groupDockEdge, tabDockEdge, paneRects, resizeSplit, type Layout } from '../src/renderer/src/components/workspace/layout/layout.ts'

import { initialLayout } from './fixtures/panes.ts'

const bounds = { x: 0, y: 0, width: 1000, height: 700 }

function ids(layout: Layout): string[] {
  return [...paneRects(layout, bounds).keys()].sort()
}

test('moving the bottom-right pane beside the top-right pane creates three columns', () => {
  const bottom = createPane('bottom', 'Bottom')
  const stacked: Layout = {
    kind: 'split', axis: 'horizontal', ratio: 0.5,
    first: createPane('pane-1', 'Group 1'),
    second: { kind: 'split', axis: 'vertical', ratio: 0.5, first: createPane('pane-2', 'Group 2'), second: bottom }
  }
  const moved = dockPane(stacked, bottom.id, { paneId: 'pane-2', edge: 'left' })
  const columns = paneRects(moved, bounds)
  assert.deepEqual([...columns.keys()], ['pane-1', bottom.id, 'pane-2'])
  assert.ok([...columns.values()].every(rect => rect.height === bounds.height))
})

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

test('self, missing-source, and missing-target moves preserve the layout', () => {
  assert.equal(dockPane(initialLayout, 'pane-1', { paneId: 'pane-1', edge: 'top' }), initialLayout)
  assert.equal(dockPane(initialLayout, 'missing', { paneId: 'pane-2', edge: 'top' }), initialLayout)
  assert.equal(dockPane(initialLayout, 'pane-1', { paneId: 'missing', edge: 'top' }), initialLayout)
})

test('group docking uses side-biased edges and leaves the center neutral', () => {
  assert.equal(groupDockEdge(0.25, 0.5), 'left')
  assert.equal(groupDockEdge(0.75, 0.5), 'right')
  assert.equal(groupDockEdge(0.5, 0.05), 'top')
  assert.equal(groupDockEdge(0.5, 0.95), 'bottom')
  assert.equal(groupDockEdge(0.25, 0.05), 'left')
  assert.equal(groupDockEdge(0.5, 0.5), null)
})

test('tab docking chooses the nearest edge in proportion to the pane size', () => {
  assert.equal(tabDockEdge(0.3, 0.5), 'left')
  assert.equal(tabDockEdge(0.7, 0.5), 'right')
  assert.equal(tabDockEdge(0.5, 0.3), 'top')
  assert.equal(tabDockEdge(0.5, 0.7), 'bottom')
  assert.equal(tabDockEdge(0.5, 0.5), 'left')
})

test('resizing clamps both sides to their minimum dimensions in either orientation', () => {
  const narrow = resizeSplit(initialLayout, [], 0, bounds.width - 12)
  assert.equal(paneRects(narrow, bounds).get('pane-1')!.width, 200)
  const wide = resizeSplit(initialLayout, [], 1, bounds.width - 12)
  assert.equal(paneRects(wide, bounds).get('pane-2')!.width, 200)
  const vertical = dockPane(initialLayout, 'pane-1', { paneId: 'pane-2', edge: 'top' })
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
