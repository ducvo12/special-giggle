import { acceptsTab, paneTypes, tabLabels, type PaneType, type TabType } from './pane-types.ts'
import type { ConversationLocation } from '../../../../../shared/organization.ts'

type ChatPath = { agentId: string; path: string[] }
export type NewChatLocation = ChatPath & { location: ConversationLocation }
export type DraftChatDestination = NewChatLocation & { id?: never; draftId: string }
export type ChatDestination = (ChatPath & { id: string; location?: never; draftId?: never }) | DraftChatDestination

export type FileDestination = { agentId: string; path: string }

export type Tab = { id: string; title: string } & (
  | { type: 'agent'; agentId?: string }
  | { type: 'chat'; conversation?: ChatDestination }
  | { type: 'file'; file?: FileDestination }
)

export type NewTab =
  | Omit<Extract<Tab, { type: 'agent' }>, 'id'>
  | Omit<Extract<Tab, { type: 'chat' }>, 'id'>
  | Omit<Extract<Tab, { type: 'file' }>, 'id'>

export interface PaneTabs {
  paneType: PaneType
  tabs: Tab[]
  activeTabId: string
  nextTab: number
}

// Keep identity separate from the tab's content kind and display label.
function createTab(paneId: string, number: number, entry: TabType | NewTab): Tab {
  const id = `${paneId}-tab-${number}`
  return typeof entry === 'string' ? { id, title: `${tabLabels[entry]} ${number}`, type: entry } : { ...entry, id }
}

// Start with the family's default tab kind: Agent for Explorer, Chat for Content.
export function initialTabs(paneId: string, paneType: PaneType, entry: NewTab | TabType = paneTypes[paneType].tabs[0]): PaneTabs {
  const tab = createTab(paneId, 1, entry)
  return { paneType, tabs: [tab], activeTabId: tab.id, nextTab: 2 }
}

// Reject incompatible kinds before changing tabs, selection, or the next number.
export function addTab<Pane extends PaneTabs & { id: string }>(pane: Pane, entry: TabType | NewTab = paneTypes[pane.paneType].tabs[0]): Pane {
  const type = typeof entry === 'string' ? entry : entry.type
  if (!acceptsTab(pane.paneType, type)) return pane
  const tab = createTab(pane.id, pane.nextTab, entry)
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
