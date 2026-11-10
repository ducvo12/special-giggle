import { useEffect, type KeyboardEvent, type PointerEvent, type PointerEventHandler } from 'react'
import { paneTypes } from './pane-types'
import type { PaneNode, Rect } from './layout'
import type { Tab } from './tabs'

interface PaneProps {
  pane: PaneNode
  floating?: Rect
  draggedTabId?: string
  onTabDragStart: (tab: Tab, event: PointerEvent<HTMLButtonElement>) => void
  onDragStart: PointerEventHandler<HTMLDivElement>
  onClose: () => void
  onAddTab: () => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
}

// Keep the pane's layout slot stable while its surface floats. Tabs are controlled
// by the layout so moving the pane cannot discard their state.
export default function Pane({ pane, floating, draggedTabId, onTabDragStart, onDragStart, onClose, onAddTab, onSelectTab, onCloseTab }: PaneProps) {
  const active = pane.tabs.find(tab => tab.id === pane.activeTabId)!

  // Keep the selected tab reachable when the strip has more tabs than fit on screen.
  useEffect(() => {
    document.getElementById(pane.activeTabId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pane.activeTabId])

  // Arrow keys wrap through tabs; Home and End select the first and last tab.
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
    const index = pane.tabs.findIndex(tab => tab.id === pane.activeTabId)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % pane.tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + pane.tabs.length) % pane.tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = pane.tabs.length - 1
    else return
    event.preventDefault()
    onSelectTab(pane.tabs[next].id)
    document.getElementById(pane.tabs[next].id)!.focus()
  }

  // Keep focus inside the pane when a close button would otherwise be removed.
  function closeTab(id: string) {
    const index = pane.tabs.findIndex(tab => tab.id === id)
    const next = id === pane.activeTabId ? pane.tabs[index + 1] ?? pane.tabs[index - 1] : active
    if (next) document.getElementById(next.id)!.focus()
    onCloseTab(id)
  }

  return (
    <div className={`pane-slot${floating ? ' pane-slot-dragging' : ''}`}>
      <section
        className={`pane${floating ? ' pane-floating' : ''}`}
        aria-label={pane.title}
        data-pane-type={pane.paneType}
        data-pane-id={pane.id}
        style={floating ? { left: floating.x, top: floating.y, width: floating.width, height: floating.height } : undefined}
      >
        <div className="pane-titlebar">
          <div className="pane-tabs" role="tablist" aria-label={`${pane.title} tabs`}>
            {pane.tabs.map(tab => (
              <div className={`pane-tab${tab.id === pane.activeTabId ? ' is-active' : ''}${tab.id === draggedTabId ? ' is-dragging' : ''}`} key={tab.id}>
                <button
                  type="button"
                  role="tab"
                  id={tab.id}
                  aria-label={`${tab.title} in ${pane.title}`}
                  aria-selected={tab.id === pane.activeTabId}
                  aria-controls={`${pane.id}-panel`}
                  tabIndex={tab.id === pane.activeTabId ? 0 : -1}
                  onPointerDown={event => onTabDragStart(tab, event)}
                  onClick={() => onSelectTab(tab.id)}
                  onKeyDown={navigateTabs}
                >
                  {tab.title}
                </button>

                <button
                  type="button"
                  className="tab-close quiet-button"
                  aria-label={`Close ${tab.title} in ${pane.title}`}
                  onClick={() => closeTab(tab.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {pane.paneType === 'explorer' && (
            <button type="button" className="tab-add quiet-button" aria-label={`Add tab to ${pane.title}`} onClick={onAddTab}>
              +
            </button>
          )}

          <div className="pane-drag-handle" onPointerDown={onDragStart} title={`Drag ${pane.title}`} />

          <button type="button" className="pane-close quiet-button" aria-label={`Close ${pane.title}`} title={`Close ${pane.title}`} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="pane-body" role="tabpanel" id={`${pane.id}-panel`} aria-labelledby={active.id} tabIndex={0}>
          <p className="pane-placeholder">
            {pane.title} / {paneTypes[pane.paneType].label} / {active.title}
          </p>
        </div>
      </section>
    </div>
  )
}
