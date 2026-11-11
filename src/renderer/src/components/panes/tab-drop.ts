import { findPane, moveTab, type Layout, type Rect } from './layout'
import { acceptsTab } from './pane-types'

export const tabDropMargin = 30

export interface DropPreview {
  layout: Layout
  preview?: Rect
  label?: string
  marker?: Rect
}

// Accept drops from the pane's top border through an expanded band below the tab bar.
export function inTabDropZone(element: HTMLElement, y: number): boolean {
  const pane = element.getBoundingClientRect()
  const header = element.querySelector('.pane-titlebar')!.getBoundingClientRect()
  return y >= pane.top && y <= header.bottom + tabDropMargin
}

// Only the tab-bar band merges or reorders tabs; lower body drops belong to split docking.
export function tabDropAt(layout: Layout, sourceId: string, tabId: string, element: HTMLElement, surface: DOMRect, x: number, y: number): DropPreview | null {
  const targetId = element.dataset.paneId!
  const target = findPane(layout, targetId)!
  const source = findPane(layout, sourceId)!
  const tab = source.tabs.find(tab => tab.id === tabId)!
  if (!acceptsTab(target.paneType, tab.type)) return null
  if (!inTabDropZone(element, y)) return null
  const header = element.querySelector('.pane-titlebar')!.getBoundingClientRect()
  let index = target.tabs.length
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
  const marker = { x: Math.max(strip.left, Math.min(left, strip.right - 2)) - surface.left, y: header.top + 6 - surface.top, width: 2, height: header.height - 12 }
  const next = moveTab(layout, sourceId, tabId, targetId, index)
  if (next === layout) return null
  return { layout: next, marker }
}
