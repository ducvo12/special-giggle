import { acceptsTab, type PaneType } from './pane-types.ts'
import { closeTab, initialTabs, type PaneTabs } from './tabs.ts'

export type Edge = 'left' | 'right' | 'top' | 'bottom'
export interface PaneNode extends PaneTabs {
  kind: 'pane'
  id: string
  title: string
}

export type Layout =
  | PaneNode
  | { kind: 'split'; axis: 'horizontal' | 'vertical'; ratio: number; first: Layout; second: Layout }
export interface Rect { x: number; y: number; width: number; height: number }
export interface DockTarget { paneId: string | null; edge: Edge }

// Reserve room for the expanded split during docking, even when the groups sit flush.
export const splitDragGap = 12
export const splitSeam = 1
export const minimumPaneSize = { width: 200, height: 140 }

// Initialize a pane with one selected placeholder tab.
export function createPane(id: string, title: string, paneType: PaneType = 'content'): PaneNode {
  return { kind: 'pane', id, title, ...initialTabs(id, paneType) }
}

// Find a pane in either branch without depending on its position in the layout.
export function findPane(layout: Layout, id: string): PaneNode | undefined {
  if (layout.kind === 'pane') return layout.id === id ? layout : undefined
  return findPane(layout.first, id) ?? findPane(layout.second, id)
}

// Update a pane without losing its tabs when it moves between split branches.
// Returning null removes the pane and collapses its split in the same operation.
export function updatePane(layout: Layout, id: string, update: (pane: PaneNode) => PaneNode | null): Layout | null {
  if (layout.kind === 'pane') return layout.id === id ? update(layout) : layout
  const first = updatePane(layout.first, id, update)
  const second = updatePane(layout.second, id, update)
  if (!first) return second
  if (!second) return first
  return { ...layout, first, second }
}

// Closing a whole pane uses the same split-collapse rules as closing its final tab.
export function removePane(layout: Layout, id: string): Layout | null {
  return updatePane(layout, id, () => null)
}

// Transfer the existing tab object, preserving its identity and content kind.
// Source selection and empty-pane cleanup use the same rules as ordinary closing.
export function moveTab(layout: Layout, sourceId: string, tabId: string, targetId: string, index?: number): Layout {
  const source = findPane(layout, sourceId)
  const target = findPane(layout, targetId)
  const tab = source?.tabs.find(tab => tab.id === tabId)
  if (!source || !target || !tab || !acceptsTab(target.paneType, tab.type)) return layout
  const insertion = Math.max(0, Math.min(index ?? target.tabs.length, target.tabs.length))
  if (sourceId === targetId) {
    const oldIndex = source.tabs.indexOf(tab)
    const position = insertion > oldIndex ? insertion - 1 : insertion
    if (position === oldIndex) return layout
    const tabs = source.tabs.filter(item => item.id !== tabId)
    tabs.splice(position, 0, tab)
    return updatePane(layout, sourceId, pane => ({ ...pane, tabs, activeTabId: tabId }))!
  }
  const remaining = updatePane(layout, sourceId, pane => closeTab(pane, tabId))!
  return updatePane(remaining, targetId, pane => ({
    ...pane,
    tabs: [...pane.tabs.slice(0, insertion), tab, ...pane.tabs.slice(insertion)],
    activeTabId: tabId
  }))!
}

// Insert beside one pane, or wrap the workspace when the target has no pane ID.
function insertPane(layout: Layout, pane: PaneNode, target: DockTarget): Layout {
  if (target.paneId === null || (layout.kind === 'pane' && layout.id === target.paneId)) {
    const before = target.edge === 'left' || target.edge === 'top'
    return {
      kind: 'split', ratio: 0.5,
      axis: target.edge === 'left' || target.edge === 'right' ? 'horizontal' : 'vertical',
      first: before ? pane : layout,
      second: before ? layout : pane
    }
  }
  if (layout.kind === 'pane') return layout
  return { ...layout, first: insertPane(layout.first, pane, target), second: insertPane(layout.second, pane, target) }
}

// Move an existing pane without changing its identity or duplicating it.
export function dockPane(layout: Layout, id: string, target: DockTarget): Layout {
  const pane = findPane(layout, id)
  if (!pane || target.paneId === id) return layout
  if (target.paneId && !findPane(layout, target.paneId)) return layout
  const remaining = removePane(layout, id)
  return remaining ? insertPane(remaining, pane, target) : layout
}

// Detach one existing view into another group of the same family.
export function dockTab(layout: Layout, sourceId: string, tabId: string, identity: Pick<PaneNode, 'id' | 'title'>, target: DockTarget): Layout {
  const source = findPane(layout, sourceId)
  const tab = source?.tabs.find(tab => tab.id === tabId)
  if (!source || !tab || source.tabs.length < 2) return layout
  if (findPane(layout, identity.id) || (target.paneId !== null && !findPane(layout, target.paneId))) return layout
  const pane: PaneNode = {
    kind: 'pane', ...identity, paneType: source.paneType,
    tabs: [tab], activeTabId: tab.id, nextTab: 1
  }
  const remaining = updatePane(layout, sourceId, pane => closeTab(pane, tabId))!
  return insertPane(remaining, pane, target)
}

// Region boundaries accept only groups belonging to their family.
export function isPaneType(layout: Layout, type: PaneType): boolean {
  if (layout.kind === 'pane') return layout.paneType === type
  return isPaneType(layout.first, type) && isPaneType(layout.second, type)
}

// Split the largest pane that has room, preferring its longer dimension.
// Return the unchanged tree when full; an empty workspace becomes one pane.
export function addPane(layout: Layout | null, pane: Extract<Layout, { kind: 'pane' }>, bounds: Rect): Layout | null {
  if (layout && !isPaneType(layout, pane.paneType)) return layout
  if (!layout) return bounds.width >= minimumPaneSize.width && bounds.height >= minimumPaneSize.height ? pane : null
  const candidates = [...paneRects(layout, bounds)].sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height)
  for (const [id, rect] of candidates) {
    const edges: Edge[] = rect.width >= rect.height ? ['right', 'bottom'] : ['bottom', 'right']
    for (const edge of edges) {
      const horizontal = edge === 'right'
      if (horizontal && rect.width < minimumPaneSize.width * 2 + splitDragGap) continue
      if (!horizontal && rect.height < minimumPaneSize.height * 2 + splitDragGap) continue
      return insertPane(layout, pane, { paneId: id, edge })
    }
  }
  return layout
}

export type SplitPath = ('first' | 'second')[]
type Split = Extract<Layout, { kind: 'split' }>

// Include every descendant's minimum so resizing a parent cannot squeeze a nested pane.
export function minimumSize(layout: Layout): { width: number; height: number } {
  if (layout.kind === 'pane') return minimumPaneSize
  const first = minimumSize(layout.first)
  const second = minimumSize(layout.second)
  if (layout.axis === 'horizontal') {
    return { width: first.width + splitDragGap + second.width, height: Math.max(first.height, second.height) }
  }
  return { width: Math.max(first.width, second.width), height: first.height + splitDragGap + second.height }
}

// Clamp the rendered size without changing the preferred ratio, so growing the
// window restores the user's proportions after a minimum-size constraint.
function firstSize(split: Split, available: number): number {
  const dimension = split.axis === 'horizontal' ? 'width' : 'height'
  return Math.max(minimumSize(split.first)[dimension], Math.min(available * split.ratio, available - minimumSize(split.second)[dimension]))
}

// Update only the split at this path; ratios are measured against space excluding the divider.
export function resizeSplit(layout: Layout, path: SplitPath, ratio: number, available: number): Layout {
  if (layout.kind === 'pane') return layout
  const [branch, ...rest] = path
  if (branch) return { ...layout, [branch]: resizeSplit(layout[branch], rest, ratio, available) }
  return { ...layout, ratio: firstSize({ ...layout, ratio }, available) / available }
}

// Use the expanded split geometry for docking and for checking room for new groups.
export function paneRects(layout: Layout, bounds: Rect): Map<string, Rect> {
  const result = new Map<string, Rect>()
  // Divide each split's rectangle until every pane has its own bounds.
  function visit(node: Layout, rect: Rect) {
    if (node.kind === 'pane') {
      result.set(node.id, rect)
      return
    }
    if (node.axis === 'horizontal') {
      const available = rect.width - splitDragGap
      const width = firstSize(node, available)
      visit(node.first, { ...rect, width })
      visit(node.second, { ...rect, x: rect.x + width + splitDragGap, width: available - width })
    } else {
      const available = rect.height - splitDragGap
      const height = firstSize(node, available)
      visit(node.first, { ...rect, height })
      visit(node.second, { ...rect, y: rect.y + height + splitDragGap, height: available - height })
    }
  }
  visit(layout, bounds)
  return result
}

// Choose the nearest edge within the docking zone; centers and outside points are neutral.
function edgeAt(rect: Rect, x: number, y: number, zone: number): Edge | null {
  if (x < rect.x || y < rect.y || x > rect.x + rect.width || y > rect.y + rect.height) return null
  const edges: [Edge, number][] = [
    ['left', x - rect.x], ['right', rect.x + rect.width - x],
    ['top', y - rect.y], ['bottom', rect.y + rect.height - y]
  ]
  edges.sort((a, b) => a[1] - b[1])
  return edges[0][1] <= zone ? edges[0][0] : null
}

// Prefer workspace edges. Exclude a moving pane, but allow a tab to split its own group.
export function dockingTargetAt(layout: Layout, bounds: Rect, x: number, y: number, excludedPaneId?: string): DockTarget | null {
  const workspaceEdge = edgeAt(bounds, x, y, Math.min(72, bounds.width / 4, bounds.height / 4))
  if (workspaceEdge) return { paneId: null, edge: workspaceEdge }
  for (const [paneId, rect] of paneRects(layout, bounds)) {
    if (paneId === excludedPaneId) continue
    const edge = edgeAt(rect, x, y, Math.min(96, rect.width / 3, rect.height / 3))
    if (edge) return { paneId, edge }
  }
  return null
}

// Tab bodies have no neutral center. Relative distances give all four sides
// generous targets even in very wide or tall groups; outer edges still wrap the region.
export function tabDockingTargetAt(layout: Layout, bounds: Rect, x: number, y: number): DockTarget | null {
  const regionEdge = edgeAt(bounds, x, y, Math.min(72, bounds.width / 4, bounds.height / 4))
  if (regionEdge) return { paneId: null, edge: regionEdge }
  for (const [paneId, rect] of paneRects(layout, bounds)) {
    if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) continue
    const edges: [Edge, number][] = [
      ['left', (x - rect.x) / rect.width], ['right', (rect.x + rect.width - x) / rect.width],
      ['top', (y - rect.y) / rect.height], ['bottom', (rect.y + rect.height - y) / rect.height]
    ]
    edges.sort((a, b) => a[1] - b[1])
    return { paneId, edge: edges[0][0] }
  }
  return null
}

// Preview the final placement only when all panes fit, for both pane and tab docking.
export function dockingPreview(layout: Layout, id: string, target: DockTarget, bounds: Rect) {
  const minimum = minimumSize(layout)
  if (bounds.width < minimum.width || bounds.height < minimum.height) return null
  return { layout, target, preview: paneRects(layout, bounds).get(id)! }
}

// Simulate a whole-pane move using the same targeting and sizing rules as tab splits.
export function dockingAt(layout: Layout, id: string, bounds: Rect, x: number, y: number) {
  const target = dockingTargetAt(layout, bounds, x, y, id)
  return target ? dockingPreview(dockPane(layout, id, target), id, target, bounds) : null
}
