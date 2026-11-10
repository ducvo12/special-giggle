import { createPane, isPaneType, minimumPaneSize, minimumSize, paneGap, type Layout, type Rect } from './layout.ts'
import type { PaneType } from './pane-types.ts'

export interface Region {
  type: PaneType
  layout: Layout | null
}

export interface RegionLayout {
  regions: readonly [Region, Region]
  ratio: number
}

export const regionHeaderHeight = 30

export const initialRegions: RegionLayout = {
  regions: [
    { type: 'explorer', layout: createPane('pane-1', 'Group 1', 'explorer') },
    { type: 'content', layout: createPane('pane-2', 'Group 2', 'content') }
  ],
  ratio: 0.5
}

// Empty regions remain visible and retain room for their next tab group.
export function regionMinimum(region: Region) {
  const minimum = region.layout ? minimumSize(region.layout) : minimumPaneSize
  return { width: minimum.width, height: minimum.height + regionHeaderHeight }
}

// The outer layout always places its unique typed regions side by side.
export function regionsMinimum(layout: RegionLayout) {
  const first = regionMinimum(layout.regions[0])
  const second = regionMinimum(layout.regions[1])
  return { width: first.width + paneGap + second.width, height: Math.max(first.height, second.height) }
}

// Clamp outer resizing against all nested groups, preserving their minimum widths.
export function resizeRegions(layout: RegionLayout, ratio: number, available: number): RegionLayout {
  const first = regionMinimum(layout.regions[0]).width
  const second = regionMinimum(layout.regions[1]).width
  return { ...layout, ratio: Math.max(first, Math.min(available * ratio, available - second)) / available }
}

// Match the outer grid, including minimum-size clamping after window resizing.
export function regionRects(layout: RegionLayout, bounds: Rect): Map<PaneType, Rect> {
  const available = bounds.width - paneGap
  const width = resizeRegions(layout, layout.ratio, available).ratio * available
  return new Map([
    [layout.regions[0].type, { ...bounds, width }],
    [layout.regions[1].type, { ...bounds, x: bounds.x + width + paneGap, width: available - width }]
  ])
}

// Keep each region's width attached to its identity when reversing the outer order.
export function swapRegions(layout: RegionLayout): RegionLayout {
  return { regions: [layout.regions[1], layout.regions[0]], ratio: 1 - layout.ratio }
}

// Commit one family's group tree without accepting groups owned by another region.
export function updateRegion(layout: RegionLayout, type: PaneType, groups: Layout | null): RegionLayout {
  if (groups && !isPaneType(groups, type)) return layout
  const [first, second] = layout.regions
  return {
    ...layout,
    regions: [
      first.type === type ? { ...first, layout: groups } : first,
      second.type === type ? { ...second, layout: groups } : second
    ]
  }
}

// Only an opposite horizontal edge offers a swap; centers and outside drops are neutral.
export function regionSwapAt(layout: RegionLayout, type: PaneType, bounds: Rect, x: number, y: number) {
  if (x < bounds.x || x > bounds.x + bounds.width || y < bounds.y || y > bounds.y + bounds.height) return null
  const zone = Math.min(72, bounds.width / 4)
  const fromLeft = layout.regions[0].type === type
  if (fromLeft ? x < bounds.x + bounds.width - zone : x > bounds.x + zone) return null
  const next = swapRegions(layout)
  return { layout: next, preview: regionRects(next, bounds).get(type)! }
}
