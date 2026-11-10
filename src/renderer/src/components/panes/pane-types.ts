export type PaneType = 'explorer' | 'content'
export type TabType = 'agent' | 'chat' | 'image' | 'file'

export const tabLabels: Record<TabType, string> = {
  agent: 'Agent', chat: 'Chat', image: 'Image', file: 'File'
}

export const paneTypes: Record<PaneType, { label: string; tabs: readonly [TabType, ...TabType[]] }> = {
  explorer: { label: 'Explorer', tabs: ['agent'] },
  content: { label: 'Content', tabs: ['chat', 'image', 'file'] }
}

// Tab creation and transfers share one compatibility rule.
export function acceptsTab(paneType: PaneType, tabType: TabType): boolean {
  return paneTypes[paneType].tabs.includes(tabType)
}
