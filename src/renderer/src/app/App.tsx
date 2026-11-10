import { useEffect, useState } from 'react'
import type { PaneType } from '../components/panes/pane-types'
import Header from '../components/Header'
import Workspace from '../components/panes/Workspace'
import { addPane, createPane, findPane, type Rect } from '../components/panes/layout'
import { initialRegions, regionHeaderHeight, regionRects, regionsMinimum, updateRegion, type RegionLayout } from '../components/panes/regions'

// Keep the two typed regions, their group trees, and group identities in shared state.
export default function App() {
  const [layout, setLayout] = useState<RegionLayout>(initialRegions)
  const [bounds, setBounds] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 })
  const [paneType, setPaneType] = useState<PaneType>('content')
  const [nextPane, setNextPane] = useState(3)
  const [windowError, setWindowError] = useState('')
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

  // Previews do not consume IDs; both regions share the committed group sequence.
  function changeLayout(next: RegionLayout) {
    setLayout(next)
    if (next.regions.some(region => region.layout && findPane(region.layout, newPane.id))) setNextPane(nextPane + 1)
  }

  // Playground creation adds a tab group inside the selected region, never a third region.
  function addNewGroup() {
    if (candidate === region.layout) return
    changeLayout(updateRegion(layout, paneType, candidate))
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

      <Workspace layout={layout} onLayoutChange={changeLayout} onBoundsChange={setBounds} newPane={newPane} />
    </div>
  )
}
