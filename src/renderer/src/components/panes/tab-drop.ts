import { findPane, moveTab, type Layout, type Rect } from './layout'
import { acceptsTab } from './pane-types'

export interface DropPreview {
  layout: Layout
  preview: Rect
  label: string
  marker?: Rect
}

// Resolve a tab insertion using the destination's visible strip. Body drops append;
// header drops insert before the nearest tab midpoint, including within one pane.
export function tabDropAt(layout: Layout, sourceId: string, tabId: string, element: HTMLElement, surface: DOMRect, x: number, y: number): DropPreview | null {
  const targetId = element.dataset.paneId!
  const target = findPane(layout, targetId)!
  const source = findPane(layout, sourceId)!
  const tab = source.tabs.find(tab => tab.id === tabId)!
  if (!acceptsTab(target.paneType, tab.type)) return null
  const header = element.querySelector('.pane-titlebar')!.getBoundingClientRect()
  const inHeader = y >= header.top && y <= header.bottom
  if (targetId === sourceId && !inHeader) return null
  let index = target.tabs.length
  let marker: Rect | undefined
  if (inHeader) {
    const cards = [...element.querySelectorAll<HTMLElement>('.pane-tab')]
    const strip = element.querySelector('.pane-tabs')!.getBoundingClientRect()
    // Empty header space appends even when later tabs are scrolled out of view.
    if (x < strip.right) {
      const before = cards.findIndex(card => {
        const rect = card.getBoundingClientRect()
        return x < rect.left + rect.width / 2
      })
      if (before !== -1) index = before
    }
    const left = index < cards.length ? cards[index].getBoundingClientRect().left : cards[cards.length - 1].getBoundingClientRect().right
    marker = { x: Math.max(strip.left, Math.min(left, strip.right - 2)) - surface.left, y: header.top + 6 - surface.top, width: 2, height: header.height - 12 }
  }
  const next = moveTab(layout, sourceId, tabId, targetId, index)
  if (next === layout) return null
  const bounds = element.getBoundingClientRect()
  return {
    layout: next,
    preview: { x: bounds.left - surface.left, y: bounds.top - surface.top, width: bounds.width, height: bounds.height },
    label: `Move ${tab.title} to ${target.title}`,
    marker
  }
}
