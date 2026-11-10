import { useEffect, useRef, useState } from 'react'
import type { PaneType } from '../components/panes/pane-types'
import Header from '../components/Header'
import Workspace, { type LayoutUpdate } from '../components/panes/Workspace'
import { addPane, createPane, findPane, type Rect } from '../components/panes/layout'
import { initialRegions, regionHeaderHeight, regionRects, regionsMinimum, updateRegion, type RegionLayout } from '../components/panes/regions'
import { runScopedTransition } from '../components/panes/transition'

// Keep the two typed regions, their group trees, and group identities in shared state.
export default function App() {
  const [workspaceState, setWorkspaceState] = useState<{ layout: RegionLayout; nextPane: number }>({
    layout: initialRegions,
    nextPane: 3
  })
  const [bounds, setBounds] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 })
  const [paneType, setPaneType] = useState<PaneType>('content')
  const [windowError, setWindowError] = useState('')
  const workspace = useRef<HTMLElement>(null)
  const { layout, nextPane } = workspaceState
  const newPane = { id: `pane-${nextPane}`, title: `Group ${nextPane}` }
  const measured = bounds.width > 0 && bounds.height > 0
  const region = layout.regions.find(region => region.type === paneType)!
  const regionBounds = measured ? regionRects(layout, bounds).get(paneType)! : bounds
  const groupBounds = { ...regionBounds, height: regionBounds.height - regionHeaderHeight }
  const candidate = addPane(region.layout, createPane(newPane.id, newPane.title, paneType), groupBounds)
  const minimum = regionsMinimum(layout)
  const minWidth = Math.ceil(minimum.width + window.innerWidth - bounds.width)
  const minHeight = Math.ceil(minimum.height + window.innerHeight - bounds.height)

  // Include the fixed app header, region handles, padding, and native window frame.
  useEffect(() => {
    if (!measured) return
    void window.granite.window.setMinimumSize(minWidth, minHeight).then(result => {
      setWindowError(result.ok ? '' : result.error)
    }).catch(() => setWindowError('Could not update the window minimum size.'))
  }, [minWidth, minHeight, measured])

  // Apply updates functionally so async view transitions never overwrite each other.
  // Previews do not consume IDs; both regions share the committed group sequence.
  function changeLayout(update: LayoutUpdate) {
    setWorkspaceState(current => {
      const candidatePane = { id: `pane-${current.nextPane}`, title: `Group ${current.nextPane}` }
      const nextLayout = update(current.layout, candidatePane)
      if (nextLayout === current.layout) return current
      const created = nextLayout.regions.some(item => item.layout && findPane(item.layout, candidatePane.id))
      return { layout: nextLayout, nextPane: created ? current.nextPane + 1 : current.nextPane }
    })
  }

  // Playground creation adds a tab group inside the selected region, never a third region.
  function addNewGroup() {
    if (candidate === region.layout) return
    runScopedTransition(workspace.current, 'groups', () => changeLayout((currentLayout, candidatePane) => {
      const target = currentLayout.regions.find(item => item.type === paneType)!
      const currentBounds = measured ? regionRects(currentLayout, bounds).get(paneType)! : bounds
      const currentGroupBounds = { ...currentBounds, height: currentBounds.height - regionHeaderHeight }
      return updateRegion(currentLayout, paneType, addPane(target.layout, createPane(candidatePane.id, candidatePane.title, paneType), currentGroupBounds))
    }))
  }

  return (
    <div className="app">
      <Header
        onAddGroup={addNewGroup}
        canAddGroup={candidate !== region.layout}
        paneType={paneType}
        onPaneTypeChange={setPaneType}
      />

      {windowError && (
        <p role="alert">
          {windowError}
        </p>
      )}

      <Workspace layout={layout} onLayoutChange={changeLayout} onBoundsChange={setBounds} newPane={newPane} workspaceRef={workspace} />
    </div>
  )
}
