import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import Pane from './Pane'
import { inTabDropZone, tabDropAt, type DropPreview } from './tab-drop'
import { addTab, closeTab, selectTab, type Tab } from './tabs'
import { dockPane, dockTab, dockingAt, tabDockingTargetAt, dockingPreview, splitDragGap, splitSeam, minimumSize, resizeSplit, removePane, updatePane, type SplitPath, type Layout, type PaneNode, type Rect } from './layout'
import { paneTypes, type PaneType } from './pane-types'
import { regionGap, regionMinimum, regionSwapAt, resizeRegions, swapRegions, updateRegion, type Region, type RegionLayout } from './regions'
import { runScopedTransition, type TransitionMode } from './transition'

export type LayoutUpdate = (current: RegionLayout, nextPane: Pick<PaneNode, 'id' | 'title'>) => RegionLayout

interface WorkspaceProps {
  layout: RegionLayout
  onLayoutChange: (layout: LayoutUpdate) => void
  onBoundsChange: (bounds: Rect) => void
  newPane: Pick<PaneNode, 'id' | 'title'>
  workspaceRef: RefObject<HTMLElement | null>
}

interface PointerDrag {
  pointerId: number
  origin: Rect
  startX: number
  startY: number
  x: number
  y: number
}

type DragTarget = { kind: 'group'; region: PaneType; pane: PaneNode; tab?: Tab } | { kind: 'region'; region: PaneType }
type Drag = PointerDrag & DragTarget
type GroupDrag = Extract<Drag, { kind: 'group' }>
type ResizeTarget = { kind: 'regions' } | { kind: 'groups'; region: PaneType; path: SplitPath }

interface Resize {
  target: ResizeTarget
  pointerId: number
  axis: 'horizontal' | 'vertical'
  start: number
  size: number
  available: number
  ratio: number
}

interface WorkspaceDrop extends Omit<DropPreview, 'layout'> {
  layout: RegionLayout
}

// Ignore small pointer movements so clicking a title bar does not start a drag.
function moved(drag: PointerDrag) {
  return Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5
}

// Identify a specific outer or internal divider for active resize styling.
function sameTarget(a: ResizeTarget, b: ResizeTarget): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'regions') return true
  if (b.kind === 'regions') return false
  return a.region === b.region && a.path.length === b.path.length && a.path.every((branch, index) => branch === b.path[index])
}

function measureSplit(divider: HTMLElement, axis: Resize['axis'], target: ResizeTarget) {
  const split = divider.parentElement!
  const dimension = axis === 'horizontal' ? 'width' : 'height'
  const gap = target.kind === 'regions' ? regionGap : splitSeam
  return {
    available: split.getBoundingClientRect()[dimension] - gap,
    size: split.firstElementChild!.getBoundingClientRect()[dimension]
  }
}

// Share pointer capture and cancellation across region swaps, group docking, and resizing.
export default function Workspace({ layout, onLayoutChange, onBoundsChange, newPane, workspaceRef: workspace }: WorkspaceProps) {
  const [resize, setResize] = useState<Resize | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [separated, setSeparated] = useState(false)
  const activePointer = useRef<number | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const groupSurfaces = useRef<Partial<Record<PaneType, HTMLDivElement | null>>>({})
  const interacting = drag !== null || resize !== null
  const draggedTabId = drag?.kind === 'group' ? drag.tab?.id : undefined
  const floating = drag && moved(drag) ? {
    ...drag.origin,
    x: drag.origin.x + drag.x - drag.startX,
    y: drag.origin.y + drag.y - drag.startY
  } : undefined
  const wholePaneDrag = Boolean(floating && drag?.kind === 'group' && (!drag.tab || drag.pane.tabs.length === 1))
  const separatingDrag = Boolean(floating && drag?.kind === 'group')
  const dragMode: TransitionMode | null = floating
    ? (drag?.kind === 'region' ? 'regions' : drag?.kind === 'group' && drag.tab && !wholePaneDrag ? 'tabs' : 'groups')
    : null
  const visibleLayout = resize ? resizedLayout(resize.target, resize.ratio, resize.available) : layout

  // Discard temporary interactions without changing the committed layout.
  const cancelInteraction = useCallback(() => {
    activePointer.current = null
    setDrag(null)
    setResize(null)
  }, [])

  const clearFloatingDrag = useCallback((tabId: string | undefined) => {
    setDrag(null)
    if (tabId) queueMicrotask(() => document.getElementById(tabId)?.focus())
  }, [])

  // Ignore late pointer-capture loss once an interaction already handed cleanup to a view transition.
  const abandonInteraction = useCallback(() => {
    if (activePointer.current !== null) cancelInteraction()
  }, [cancelInteraction])

  // Finish cleanup before paint so a preceding layout change cannot cancel the next drag.
  useLayoutEffect(cancelInteraction, [layout, cancelInteraction])

  // Wait one synchronous layout commit when expanding flush subpanes before measuring drop targets.
  useLayoutEffect(() => {
    setSeparated(separatingDrag)
  }, [separatingDrag])

  // Report the outer usable area for group creation and native window minimums.
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      onBoundsChange({ x: 0, y: 0, width: entry.contentRect.width, height: entry.contentRect.height })
      abandonInteraction()
    })
    const bounds = surface.current!.getBoundingClientRect()
    onBoundsChange({ x: 0, y: 0, width: bounds.width, height: bounds.height })
    observer.observe(surface.current!)
    return () => observer.disconnect()
  }, [onBoundsChange, abandonInteraction])

  // Escape, focus changes, and window resizing invalidate an active pointer interaction.
  useEffect(() => {
    if (!interacting) return
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || activePointer.current === null) return
      const pointer = activePointer.current
      activePointer.current = null
      if (workspace.current?.hasPointerCapture(pointer)) workspace.current.releasePointerCapture(pointer)
      if (dragMode) {
        runScopedTransition(workspace.current, dragMode, () => clearFloatingDrag(draggedTabId))
      } else {
        cancelInteraction()
        if (draggedTabId) requestAnimationFrame(() => document.getElementById(draggedTabId)?.focus())
      }
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('blur', abandonInteraction)
    window.addEventListener('resize', abandonInteraction)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('blur', abandonInteraction)
      window.removeEventListener('resize', abandonInteraction)
    }
  }, [interacting, cancelInteraction, abandonInteraction, clearFloatingDrag, draggedTabId, dragMode, workspace])

  // Resolve group drops against only the source region's tree and surface.
  // Tab bars insert first; lower pane bodies offer proportional split targets.
  function groupDropAt(drag: GroupDrag, groups: Layout, bounds: DOMRect): DropPreview | null {
    if (drag.x < bounds.left || drag.x > bounds.right || drag.y < bounds.top || drag.y > bounds.bottom) return null
    const target = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('.pane')
    if (target && target.closest<HTMLElement>('[data-region]')?.dataset.region !== drag.region) return null
    if (drag.tab && target && inTabDropZone(target, drag.y)) {
      return tabDropAt(groups, drag.pane.id, drag.tab.id, target, bounds, drag.x, drag.y)
    }
    const area = { x: 0, y: 0, width: bounds.width, height: bounds.height }
    const x = drag.x - bounds.left
    const y = drag.y - bounds.top
    if (!drag.tab) {
      const dock = dockingAt(groups, drag.pane.id, area, x, y)
      return dock ? { layout: dock.layout, preview: dock.preview, label: `Dock ${dock.target.edge}` } : null
    }
    const dockTarget = tabDockingTargetAt(groups, area, x, y)
    if (!dockTarget) return null
    const wholePane = drag.pane.tabs.length === 1
    const next = wholePane ? dockPane(groups, drag.pane.id, dockTarget) : dockTab(groups, drag.pane.id, drag.tab.id, newPane, dockTarget)
    if (next === groups) return null
    const dock = dockingPreview(next, wholePane ? drag.pane.id : newPane.id, dockTarget, area)
    if (!dock) return null
    const label = wholePane ? `Dock ${dockTarget.edge}` : `Split ${drag.tab.title} ${dockTarget.edge}`
    return { layout: dock.layout, preview: dock.preview, label }
  }

  // Translate local group previews into outer coordinates without crossing ownership boundaries.
  function dropAt(drag: Drag): WorkspaceDrop | null {
    const bounds = surface.current!.getBoundingClientRect()
    if (drag.kind === 'region') {
      const drop = regionSwapAt(layout, drag.region, { x: 0, y: 0, width: bounds.width, height: bounds.height }, drag.x - bounds.left, drag.y - bounds.top)
      return drop ? { ...drop, label: 'Swap regions' } : null
    }
    const region = layout.regions.find(region => region.type === drag.region)!
    const groupBounds = groupSurfaces.current[drag.region]!.getBoundingClientRect()
    const drop = groupDropAt(drag, region.layout!, groupBounds)
    if (!drop) return null
    const offset = { x: groupBounds.left - bounds.left, y: groupBounds.top - bounds.top }
    const preview = drop.preview ? { ...drop.preview, x: drop.preview.x + offset.x, y: drop.preview.y + offset.y } : undefined
    const marker = drop.marker ? { ...drop.marker, x: drop.marker.x + offset.x, y: drop.marker.y + offset.y } : undefined
    return { ...drop, layout: updateRegion(layout, drag.region, drop.layout), preview, marker }
  }

  // Capture at the common workspace so all interactions continue across region boundaries.
  function startDrag(target: DragTarget, event: PointerEvent<HTMLElement>) {
    if (interacting || activePointer.current !== null || event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    activePointer.current = event.pointerId
    workspace.current!.setPointerCapture(event.pointerId)
    let selector = '.workspace-region'
    if (target.kind === 'group') {
      selector = target.tab && target.pane.tabs.length > 1 ? '.pane-tab' : '.pane'
    }
    const bounds = event.currentTarget.closest(selector)!.getBoundingClientRect()
    const pointer: PointerDrag = {
      pointerId: event.pointerId,
      origin: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY
    }
    setDrag({ ...pointer, ...target })
  }

  // Decide from the release position; cancellation and invalid drops preserve both trees.
  function finishDrag(event: PointerEvent<HTMLElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return
    const final = { ...drag, x: event.clientX, y: event.clientY }
    const tabId = drag.kind === 'group' ? drag.tab?.id : undefined
    if (moved(final)) {
      const drop = dropAt(final)
      let mode = dragMode ?? 'groups'
      if (drop) {
        if (drag.kind === 'region') mode = 'regions'
        else mode = drop.marker ? 'tabs' : 'groups'
      }

      runScopedTransition(workspace.current, mode, () => {
        // A layout change invalidates the drop geometry measured on release.
        if (drop) commitMeasuredLayout(drop.layout)
        clearFloatingDrag(tabId)
      })
      return
    }
    if (tabId && drag.kind === 'group') {
      changePane(drag.region, drag.pane.id, pane => selectTab(pane, tabId))
      document.getElementById(tabId)?.focus()
    }
    setDrag(null)
  }

  function commitMeasuredLayout(next: RegionLayout) {
    onLayoutChange(current => current === layout ? next : current)
  }

  // Outer resizing changes region proportions; inner resizing changes only one region's tree.
  function resizedLayout(target: ResizeTarget, ratio: number, available: number): RegionLayout {
    if (target.kind === 'regions') return resizeRegions(layout, ratio, available)
    const region = layout.regions.find(region => region.type === target.region)!
    return updateRegion(layout, target.region, resizeSplit(region.layout!, target.path, ratio, available))
  }

  // Measure the divider's own grid so nested resizing stays local to that split.
  function startResize(target: ResizeTarget, axis: Resize['axis'], event: PointerEvent<HTMLDivElement>) {
    if (interacting || activePointer.current !== null || event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    const { available, size } = measureSplit(event.currentTarget, axis, target)
    activePointer.current = event.pointerId
    workspace.current!.setPointerCapture(event.pointerId)
    setResize({ target, axis, pointerId: event.pointerId, start: axis === 'horizontal' ? event.clientX : event.clientY, size, available, ratio: size / available })
  }

  // Preserve the grab offset; the corresponding layout owns minimum-size clamping.
  function resizeAt(event: PointerEvent<HTMLElement>, session: Resize): Resize {
    const position = session.axis === 'horizontal' ? event.clientX : event.clientY
    return { ...session, ratio: (session.size + position - session.start) / session.available }
  }

  // Arrow keys move ten pixels; Home and End go to the minimum-size limits.
  function resizeWithKeyboard(target: ResizeTarget, axis: Resize['axis'], event: KeyboardEvent<HTMLDivElement>) {
    if (interacting) return
    const decrease = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
    const increase = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
    if (![decrease, increase, 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const { available, size } = measureSplit(event.currentTarget, axis, target)
    let ratio = (size + (event.key === decrease ? -10 : 10)) / available
    if (event.key === 'Home') ratio = 0
    if (event.key === 'End') ratio = 1
    commitMeasuredLayout(resizedLayout(target, ratio, available))
  }

  // Use one accessible divider contract for both the region row and internal splits.
  function renderDivider(target: ResizeTarget, axis: Resize['axis'], ratio: number) {
    const resizing = resize !== null && sameTarget(resize.target, target)
    return (
      <div
        className={`pane-divider${resizing ? ' is-resizing' : ''}`}
        role="separator"
        tabIndex={0}
        aria-label={target.kind === 'regions' ? 'Resize regions' : `Resize ${paneTypes[target.region].label} groups`}
        aria-orientation={axis === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        onPointerDown={event => startResize(target, axis, event)}
        onKeyDown={event => resizeWithKeyboard(target, axis, event)}
      />
    )
  }

  // Store tab state in its owning region so docking and remounts preserve it.
  function changePane(type: PaneType, id: string, update: (pane: PaneNode) => PaneNode | null) {
    cancelInteraction()
    onLayoutChange(current => {
      const region = current.regions.find(item => item.type === type)
      return region?.layout ? updateRegion(current, type, updatePane(region.layout, id, update)) : current
    })
  }

  // Render the same group tree for Explorer and Content, including both split directions.
  function renderLayout(node: Layout, region: PaneType, separating: boolean, path: SplitPath = []): ReactNode {
    if (node.kind === 'pane') {
      const dragging = drag?.kind === 'group' && drag.pane.id === node.id
      return (
        <Pane
          key={node.id}
          pane={node}
          floating={dragging && wholePaneDrag ? floating : undefined}
          hasRegionHandle={path.every(branch => branch === 'first')}
          draggedTabId={dragging && !wholePaneDrag && floating ? drag.tab?.id : undefined}
          onTabDragStart={(tab, event) => startDrag({ kind: 'group', region, pane: node, tab }, event)}
          onDragStart={event => startDrag({ kind: 'group', region, pane: node }, event)}
          onAddTab={titlebar => runScopedTransition(titlebar, 'tabs', () => changePane(region, node.id, pane => addTab(pane, 'agent')))}
          onSelectTab={id => changePane(region, node.id, pane => selectTab(pane, id))}
          onCloseTab={(id, titlebar) => {
            const closingFinal = node.tabs.length === 1 && node.tabs[0]?.id === id
            runScopedTransition(closingFinal ? workspace.current : titlebar, closingFinal ? 'groups' : 'tabs', () => {
              changePane(region, node.id, pane => closeTab(pane, id))
            })
          }}
          onClose={() => runScopedTransition(workspace.current, 'groups', () => {
            cancelInteraction()
            onLayoutChange(current => {
              const groups = current.regions.find(item => item.type === region)?.layout
              return groups ? updateRegion(current, region, removePane(groups, node.id)) : current
            })
          })}
        />
      )
    }
    const first = minimumSize(node.first)
    const second = minimumSize(node.second)
    const gap = separating ? splitDragGap : splitSeam
    const dimension = node.axis === 'horizontal' ? 'width' : 'height'
    const tracks = `minmax(${first[dimension]}px, ${node.ratio * 100}fr) ${gap}px minmax(${second[dimension]}px, ${(1 - node.ratio) * 100}fr)`
    return (
      <div
        className={`pane-split pane-split-${node.axis}`}
        style={node.axis === 'horizontal' ? { gridTemplateColumns: tracks } : { gridTemplateRows: tracks }}
      >
        {renderLayout(node.first, region, separating, [...path, 'first'])}

        {renderDivider({ kind: 'groups', region, path }, node.axis, node.ratio)}

        {renderLayout(node.second, region, separating, [...path, 'second'])}
      </div>
    )
  }

  // Give region swapping a keyboard equivalent without changing internal group positions.
  function moveRegionWithKeyboard(type: PaneType, event: KeyboardEvent<HTMLButtonElement>) {
    if (interacting || !['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'ArrowLeft' && layout.regions[0].type === type) return
    if (event.key === 'ArrowRight' && layout.regions[1].type === type) return
    runScopedTransition(workspace.current, 'regions', () => onLayoutChange(current => swapRegions(current)))
  }

  // A region has its own drag handle integrated at top-left, even when its final group closes.
  function renderRegion(region: Region) {
    const moving = drag?.kind === 'region' && drag.region === region.type && floating
    const separating = separatingDrag && drag?.kind === 'group' && drag.region === region.type
    const frameClass = region.layout ? (separating ? ' is-separating' : ' is-framed') : ''
    return (
      <div className={`region-slot${moving ? ' region-slot-dragging' : ''}`}>
        <section
          className={`workspace-region${moving ? ' region-floating' : ''}`}
          aria-label={`${paneTypes[region.type].label} region`}
          data-region={region.type}
          style={{ ...(moving ? { left: moving.x, top: moving.y, width: moving.width, height: moving.height } : undefined), '--vt': `region-${region.type}` } as CSSProperties}
        >
          <button
            type="button"
            className="region-drag-handle quiet-button"
            aria-label={`Move ${paneTypes[region.type].label} region`}
            title="Drag to swap sides, or use the Left and Right arrow keys"
            onPointerDown={event => startDrag({ kind: 'region', region: region.type }, event)}
            onKeyDown={event => moveRegionWithKeyboard(region.type, event)}
          >
            <svg
              width="8"
              height="12"
              viewBox="0 0 8 12"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="2" cy="2" r="1" />
              <circle cx="6" cy="2" r="1" />
              <circle cx="2" cy="6" r="1" />
              <circle cx="6" cy="6" r="1" />
              <circle cx="2" cy="10" r="1" />
              <circle cx="6" cy="10" r="1" />
            </svg>
          </button>

          <div className={`pane-layout${frameClass}`} ref={element => { groupSurfaces.current[region.type] = element }}>
            {region.layout ? renderLayout(region.layout, region.type, separating) : (
              <div className="region-empty" style={{ '--vt': `empty-${region.type}` } as CSSProperties}>
                No open tabs
              </div>
            )}
          </div>
        </section>
      </div>
    )
  }

  const drop = floating && drag && (!separatingDrag || separated) ? dropAt(drag) : null
  const [first, second] = visibleLayout.regions
  const tracks = `minmax(${regionMinimum(first).width}px, ${visibleLayout.ratio * 100}fr) ${regionGap}px minmax(${regionMinimum(second).width}px, ${(1 - visibleLayout.ratio) * 100}fr)`

  return (
    <main
      ref={workspace}
      className={`workspace${drag ? ' is-dragging' : ''}${resize ? ` is-resizing-${resize.axis}` : ''}`}
      aria-label="Workspace"
      onPointerMove={event => {
        if (drag && activePointer.current === drag.pointerId && event.pointerId === drag.pointerId) {
          setDrag({ ...drag, x: event.clientX, y: event.clientY })
        }
        if (resize && activePointer.current === resize.pointerId && event.pointerId === resize.pointerId) {
          setResize(resizeAt(event, resize))
        }
      }}
      onPointerUp={event => {
        if (resize && activePointer.current === resize.pointerId && event.pointerId === resize.pointerId) {
          activePointer.current = null
          const final = resizeAt(event, resize)
          commitMeasuredLayout(resizedLayout(final.target, final.ratio, final.available))
          setResize(null)
        } else if (drag && activePointer.current === drag.pointerId && event.pointerId === drag.pointerId) {
          activePointer.current = null
          finishDrag(event)
        }
      }}
      onPointerCancel={abandonInteraction}
      onLostPointerCapture={abandonInteraction}
    >
      <div className="region-layout" ref={surface} style={{ gridTemplateColumns: tracks }}>
        {visibleLayout.regions.map((region, index) => (
          <Fragment key={region.type}>
            {renderRegion(region)}

            {index === 0 && renderDivider({ kind: 'regions' }, 'horizontal', visibleLayout.ratio)}
          </Fragment>
        ))}

        {drop?.preview && (
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

        {floating && drag?.kind === 'group' && drag.tab && !wholePaneDrag && (
          <div
            className="pane-tab tab-drag-preview"
            aria-hidden="true"
            style={{ left: floating.x, top: floating.y, width: floating.width, height: floating.height, '--vt': `tab-${drag.tab.id}` } as CSSProperties}
          >
            {drag.tab.title}
          </div>
        )}
      </div>
    </main>
  )
}
