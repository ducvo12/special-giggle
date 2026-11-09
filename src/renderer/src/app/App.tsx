import { useEffect, useState } from 'react'
import type { PaneType } from '../components/panes/pane-types'
import Header from '../components/Header'
import Workspace from '../components/panes/Workspace'
import { addPane, createPane, initialLayout, minimumSize, hasPaneType, type Layout, type Rect } from '../components/panes/layout'

// Share layout ownership between header actions and workspace interactions.
export default function App() {
  const [layout, setLayout] = useState<Layout | null>(initialLayout)
  const [bounds, setBounds] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 })
  const [paneType, setPaneType] = useState<PaneType>('content')
  const [nextPane, setNextPane] = useState(3)
  const [windowError, setWindowError] = useState('')
  const candidate = addPane(layout, createPane(`pane-${nextPane}`, `Pane ${nextPane}`, paneType), bounds)
  const minimum = layout ? minimumSize(layout) : { width: 0, height: 0 }
  const measured = bounds.width > 0 && bounds.height > 0
  const minWidth = Math.ceil(minimum.width + window.innerWidth - bounds.width)
  const minHeight = Math.ceil(minimum.height + window.innerHeight - bounds.height)

  // Include the header and workspace padding when enforcing the native window minimum.
  useEffect(() => {
    if (!measured) return
    void window.granite.window.setMinimumSize(minWidth, minHeight).then(result => {
      setWindowError(result.ok ? '' : result.error)
    }).catch(() => setWindowError('Could not update the window minimum size.'))
  }, [minWidth, minHeight, measured])

  // Number new panes monotonically so closing one never reuses another pane's identity.
  function addNewPane() {
    if (candidate === layout) return
    setLayout(candidate)
    setNextPane(nextPane + 1)
  }

  return (
    <div className="app">
      <Header
        onAddPane={addNewPane}
        canAddPane={candidate !== layout}
        paneType={paneType}
        onPaneTypeChange={setPaneType}
        navigationOpen={hasPaneType(layout, 'navigation')}
      />

      {windowError && (
        <p role="alert">
          {windowError}
        </p>
      )}

      <Workspace layout={layout} onLayoutChange={setLayout} onBoundsChange={setBounds} />
    </div>
  )
}
