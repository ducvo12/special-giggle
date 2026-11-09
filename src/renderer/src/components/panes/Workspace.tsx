import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import Pane from './Pane'
import { tabDropAt, type DropPreview } from './tab-drop'
import { addTab, closeTab, selectTab, type Tab } from './tabs'
import { dockingAt, paneGap, minimumSize, resizeSplit, removePane, updatePane, type SplitPath, type Layout, type PaneNode, type Rect } from './layout'

interface WorkspaceProps {
  layout: Layout | null
  onLayoutChange: (layout: Layout | null) => void
  onBoundsChange: (bounds: Rect) => void
}

interface Drag {
  pane: PaneNode
  tab?: Tab
  pointerId: number
  origin: Rect
  startX: number
  startY: number
  x: number
  y: number
}

interface Resize {
  path: SplitPath
  pointerId: number
  axis: 'horizontal' | 'vertical'
  start: number
  size: number
  available: number
  ratio: number
}

// Ignore small pointer movements so clicking a title bar does not start a drag.
function moved(drag: Drag) {
  return Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5
}

// Own the committed layout and temporary pointer interactions. A drop or resize
// release commits the change; cancellation only discards the temporary state.
export default function Workspace({ layout, onLayoutChange, onBoundsChange }: WorkspaceProps) {
  const [resize, setResize] = useState<Resize | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const workspace = useRef<HTMLElement>(null)
  const interacting = drag !== null || resize !== null
  const draggedTabId = drag?.tab?.id
  const visibleLayout = resize && layout ? resizeSplit(layout, resize.path, resize.ratio, resize.available) : layout

  // Discard temporary drag or resize state; the committed layout remains intact.
  const cancelInteraction = useCallback(() => {
    setDrag(null)
    setResize(null)
  }, [])

  // Finish cleanup before paint so a preceding layout change cannot cancel the next drag.
  useLayoutEffect(cancelInteraction, [layout, cancelInteraction])

  // Report the usable area so creation can refuse splits that would not fit.
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      onBoundsChange({ x: 0, y: 0, width: entry.contentRect.width, height: entry.contentRect.height })
    })
    // Creation should be available before the first asynchronous observer delivery.
    const bounds = surface.current!.getBoundingClientRect()
    onBoundsChange({ x: 0, y: 0, width: bounds.width, height: bounds.height })
    observer.observe(surface.current!)
    return () => observer.disconnect()
  }, [onBoundsChange])

  // Focus or window-size changes invalidate an active pointer interaction.
  useEffect(() => {
    if (!interacting) return
    // Let Escape cancel even when the workspace has captured the pointer.
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelInteraction()
        if (draggedTabId) requestAnimationFrame(() => document.getElementById(draggedTabId)?.focus())
      }
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('blur', cancelInteraction)
    window.addEventListener('resize', cancelInteraction)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('blur', cancelInteraction)
      window.removeEventListener('resize', cancelInteraction)
    }
  }, [interacting, cancelInteraction, draggedTabId])

  // Tab bars accept compatible tabs before edge docking is considered. A sole-tab
  // drag carries the whole pane visually and can still reposition it at an edge.
  function dropAt(drag: Drag): DropPreview | null {
    if (!layout) return null
    const bounds = surface.current!.getBoundingClientRect()
    const target = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('.pane')
    const wholePane = !drag.tab || drag.pane.tabs.length === 1
    if (drag.tab && target) {
      const header = target.querySelector('.pane-titlebar')!.getBoundingClientRect()
      if (!wholePane || (drag.y >= header.top && drag.y <= header.bottom)) {
        return tabDropAt(layout, drag.pane.id, drag.tab.id, target, bounds, drag.x, drag.y)
      }
    }
    if (wholePane) {
      const dock = dockingAt(layout, drag.pane.id, { x: 0, y: 0, width: bounds.width, height: bounds.height }, drag.x - bounds.left, drag.y - bounds.top)
      if (dock) return { layout: dock.layout, preview: dock.preview, label: `Dock ${dock.target.edge}` }
    }
    if (drag.tab && target) return tabDropAt(layout, drag.pane.id, drag.tab.id, target, bounds, drag.x, drag.y)
    return null
  }

  // Capture the pointer so dragging continues outside the title bar. Record the
  // original bounds to preserve the pane's size and the point where it was grabbed.
  function startDrag(pane: PaneNode, event: PointerEvent<HTMLElement>, tab?: Tab) {
    if (interacting || event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    workspace.current!.setPointerCapture(event.pointerId)
    const selector = tab && pane.tabs.length > 1 ? '.pane-tab' : '.pane'
    const bounds = event.currentTarget.closest(selector)!.getBoundingClientRect()
    setDrag({
      pane,
      tab,
      pointerId: event.pointerId,
      origin: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY
    })
  }

  // Use the release position for the final decision; invalid drops leave the tree untouched.
  function finishDrag(event: PointerEvent<HTMLElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return
    const final = { ...drag, x: event.clientX, y: event.clientY }
    const tabId = drag.tab?.id
    if (moved(final)) {
      const drop = dropAt(final)
      if (drop) {
        onLayoutChange(drop.layout)
        if (tabId) requestAnimationFrame(() => document.getElementById(tabId)?.focus())
      }
    } else if (tabId) {
      changePane(drag.pane.id, pane => selectTab(pane, tabId))
      document.getElementById(tabId)?.focus()
    }
    setDrag(null)
  }

  // Measure the split itself so nested dividers resize only their own region.
  function startResize(node: Extract<Layout, { kind: 'split' }>, path: SplitPath, event: PointerEvent<HTMLDivElement>) {
    if (interacting || event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    const split = event.currentTarget.parentElement!
    const bounds = split.getBoundingClientRect()
    const first = split.firstElementChild!.getBoundingClientRect()
    const horizontal = node.axis === 'horizontal'
    const available = (horizontal ? bounds.width : bounds.height) - paneGap
    const size = horizontal ? first.width : first.height
    workspace.current!.setPointerCapture(event.pointerId)
    setResize({
      path,
      pointerId: event.pointerId,
      axis: node.axis,
      start: horizontal ? event.clientX : event.clientY,
      size,
      available,
      ratio: size / available
    })
  }

  // Preserve the initial grab offset; clamping belongs to the layout's sizing rules.
  function resizeAt(event: PointerEvent<HTMLElement>, session: Resize): Resize {
    const position = session.axis === 'horizontal' ? event.clientX : event.clientY
    return { ...session, ratio: (session.size + position - session.start) / session.available }
  }

  // Arrow keys move ten pixels; Home and End go to the minimum-size limits.
  function resizeWithKeyboard(node: Extract<Layout, { kind: 'split' }>, path: SplitPath, event: KeyboardEvent<HTMLDivElement>) {
    if (interacting || !layout) return
    const decrease = node.axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
    const increase = node.axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
    if (![decrease, increase, 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const split = event.currentTarget.parentElement!
    const dimension = node.axis === 'horizontal' ? 'width' : 'height'
    const available = split.getBoundingClientRect()[dimension] - paneGap
    const size = split.firstElementChild!.getBoundingClientRect()[dimension]
    let ratio = (size + (event.key === decrease ? -10 : 10)) / available
    if (event.key === 'Home') ratio = 0
    if (event.key === 'End') ratio = 1
    onLayoutChange(resizeSplit(layout, path, ratio, available))
  }

  // Store tab changes in the layout rather than component-local state, so docking
  // and its React remounts cannot reset the pane's tabs or selection.
  function changePane(id: string, update: (pane: PaneNode) => PaneNode | null) {
    cancelInteraction()
    if (layout) onLayoutChange(updatePane(layout, id, update))
  }

  // Render the split tree recursively. Only the grabbed pane floats; its slot
  // remains in the layout to preserve neighboring sizes and mark the return position.
  function renderLayout(node: Layout, path: SplitPath = []): ReactNode {
    if (node.kind === 'pane') {
      return (
        <Pane
          key={node.id}
          pane={node}
          floating={drag?.pane.id === node.id && wholePaneDrag ? floating : undefined}
          draggedTabId={drag?.pane.id === node.id && !wholePaneDrag && floating ? drag.tab?.id : undefined}
          onTabDragStart={(tab, event) => startDrag(node, event, tab)}
          onDragStart={event => startDrag(node, event)}
          onAddTab={() => changePane(node.id, pane => addTab(pane, 'agent'))}
          onSelectTab={id => changePane(node.id, pane => selectTab(pane, id))}
          onCloseTab={id => changePane(node.id, pane => closeTab(pane, id))}
          onClose={() => {
            cancelInteraction()
            if (layout) onLayoutChange(removePane(layout, node.id))
          }}
        />
      )
    }
    const first = minimumSize(node.first)
    const second = minimumSize(node.second)
    const dimension = node.axis === 'horizontal' ? 'width' : 'height'
    const tracks = `minmax(${first[dimension]}px, ${node.ratio * 100}fr) ${paneGap}px minmax(${second[dimension]}px, ${(1 - node.ratio) * 100}fr)`
    return (
      <div
        className={`pane-split pane-split-${node.axis}`}
        style={node.axis === 'horizontal' ? { gridTemplateColumns: tracks } : { gridTemplateRows: tracks }}
      >
        {renderLayout(node.first, [...path, 'first'])}

        <div
          className="pane-divider"
          role="separator"
          tabIndex={0}
          aria-label="Resize panes"
          aria-orientation={node.axis === 'horizontal' ? 'vertical' : 'horizontal'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(node.ratio * 100)}
          onPointerDown={event => startResize(node, path, event)}
          onKeyDown={event => resizeWithKeyboard(node, path, event)}
        />

        {renderLayout(node.second, [...path, 'second'])}
      </div>
    )
  }

  const floating = drag && moved(drag) ? {
    ...drag.origin,
    x: drag.origin.x + drag.x - drag.startX,
    y: drag.origin.y + drag.y - drag.startY
  } : undefined
  const wholePaneDrag = Boolean(floating && drag && (!drag.tab || drag.pane.tabs.length === 1))
  const drop = floating && drag ? dropAt(drag) : null

  return (
    <main
      ref={workspace}
      className={`workspace${drag ? ' is-dragging' : ''}${resize ? ` is-resizing-${resize.axis}` : ''}`}
      aria-label="Workspace"
      onPointerMove={event => {
        if (drag && event.pointerId === drag.pointerId) setDrag({ ...drag, x: event.clientX, y: event.clientY })
        if (resize && event.pointerId === resize.pointerId) setResize(resizeAt(event, resize))
      }}
      onPointerUp={event => {
        if (resize && layout && event.pointerId === resize.pointerId) {
          const final = resizeAt(event, resize)
          onLayoutChange(resizeSplit(layout, final.path, final.ratio, final.available))
          setResize(null)
        } else {
          finishDrag(event)
        }
      }}
      onPointerCancel={cancelInteraction}
      onLostPointerCapture={cancelInteraction}
    >
      <div className="pane-layout" ref={surface}>
        {visibleLayout && renderLayout(visibleLayout)}

        {drop && (
          <div
            className="pane-dock-preview"
            role="status"
            style={{ left: drop.preview.x, top: drop.preview.y, width: drop.preview.width, height: drop.preview.height }}
          >
            {drop.label}
          </div>
        )}

        {drop?.marker && (
          <div className="tab-drop-marker" aria-hidden="true" style={{ left: drop.marker.x, top: drop.marker.y, width: drop.marker.width, height: drop.marker.height }} />
        )}

        {floating && drag?.tab && !wholePaneDrag && (
          <div className="pane-tab tab-drag-preview" aria-hidden="true" style={{ left: floating.x, top: floating.y, width: floating.width, height: floating.height }}>
            {drag.tab.title}
          </div>
        )}
      </div>
    </main>
  )
}
