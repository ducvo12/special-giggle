import { moveTab, type DockTarget, type Layout, type Rect } from './layout'

export const tabDropMargin = 30

export interface DropPreview {
  layout: Layout
  target?: DockTarget
  marker?: Rect
}

// Only the tab-bar band merges or reorders tabs; lower body drops belong to split docking.
export function tabDropAt(layout: Layout, sourceId: string, tabId: string, element: HTMLElement, header: DOMRect, surface: DOMRect, x: number): DropPreview | null {
  const stripElement = element.querySelector('.pane-tabs')!
  const cards = stripElement.children
  const strip = stripElement.getBoundingClientRect()
  let index = cards.length
  let cardBounds: DOMRect | undefined
  // Empty header space appends even when later tabs are scrolled out of view.
  if (x < strip.right) {
    for (let i = 0; i < cards.length; i++) {
      cardBounds = cards[i].getBoundingClientRect()
      if (x < cardBounds.left + cardBounds.width / 2) {
        index = i
        break
      }
    }
  }
  const next = moveTab(layout, sourceId, tabId, element.dataset.paneId!, index)
  if (next === layout) return null

  cardBounds ??= cards[cards.length - 1].getBoundingClientRect()
  const left = index < cards.length ? cardBounds.left : cardBounds.right
  const marker = { x: Math.max(strip.left, Math.min(left, strip.right - 2)) - surface.left, y: header.top + 6 - surface.top, width: 2, height: header.height - 12 }
  return { layout: next, marker }
}
