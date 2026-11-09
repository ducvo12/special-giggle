import { acceptsTab, paneTypes, tabLabels, type PaneType, type TabType } from './pane-types.ts'

export interface Tab {
  type: TabType
  id: string
  title: string
}

export interface PaneTabs {
  paneType: PaneType
  tabs: Tab[]
  activeTabId: string
  nextTab: number
}

// Keep identity separate from the tab's content kind and display label.
function createTab(paneId: string, number: number, type: TabType): Tab {
  return { id: `${paneId}-tab-${number}`, title: `${tabLabels[type]} ${number}`, type }
}

// Start with the family's default tab kind: Agent for Navigation, Chat for Content.
export function initialTabs(paneId: string, paneType: PaneType): PaneTabs {
  const tab = createTab(paneId, 1, paneTypes[paneType].tabs[0])
  return { paneType, tabs: [tab], activeTabId: tab.id, nextTab: 2 }
}

// Reject incompatible kinds before changing tabs, selection, or the next number.
export function addTab<Pane extends PaneTabs & { id: string }>(pane: Pane, type: TabType = paneTypes[pane.paneType].tabs[0]): Pane {
  if (!acceptsTab(pane.paneType, type)) return pane
  const tab = createTab(pane.id, pane.nextTab, type)
  return { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id, nextTab: pane.nextTab + 1 }
}

// Ignore stale selections so the active tab always belongs to this pane.
export function selectTab<Pane extends PaneTabs>(pane: Pane, id: string): Pane {
  return pane.tabs.some(tab => tab.id === id) ? { ...pane, activeTabId: id } : pane
}

// Prefer the tab to the right when closing the active tab, then the one to its left.
// A null result tells the layout to remove the pane when its final tab closes.
export function closeTab<Pane extends PaneTabs>(pane: Pane, id: string): Pane | null {
  const index = pane.tabs.findIndex(tab => tab.id === id)
  if (index === -1) return pane
  const tabs = pane.tabs.filter(tab => tab.id !== id)
  if (!tabs.length) return null
  const activeTabId = pane.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)].id : pane.activeTabId
  return { ...pane, tabs, activeTabId }
}
