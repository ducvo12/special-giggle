import type { Conversation } from '../../../shared/agent.ts'
import type { Project, Section } from '../../../shared/organization.ts'

export type TreeSort = { by: 'activity' | 'name' | 'created'; direction: 'asc' | 'desc' }
export const defaultTreeSort: TreeSort = { by: 'activity', direction: 'desc' }

export function readTreeSort(value: string | null): TreeSort {
  try {
    const parsed = JSON.parse(value ?? '')
    if (['activity', 'name', 'created'].includes(parsed?.by) && ['asc', 'desc'].includes(parsed?.direction)) return parsed
  } catch { /* Use the default for missing or outdated preferences. */ }
  return { ...defaultTreeSort }
}

type TreeEntry = Conversation | Section | Project
export function sortTreeEntries<T extends TreeEntry>(entries: T[], chats: Conversation[], sort: TreeSort): T[] {
  const name = (entry: TreeEntry) => 'title' in entry ? entry.title : entry.name
  const activity = (entry: TreeEntry) => {
    if ('lastChattedAt' in entry) return entry.lastChattedAt ?? 0
    const children = chats.filter(chat => 'sectionId' in entry ? chat.projectId === entry.id : chat.sectionId === entry.id)
    return children.reduce((latest, chat) => Math.max(latest, chat.lastChattedAt ?? 0), 0)
  }
  return [...entries].sort((a, b) => {
    const value = sort.by === 'name' ? name(a).localeCompare(name(b), undefined, { numeric: true, sensitivity: 'base' })
      : sort.by === 'created' ? a.createdAt - b.createdAt : activity(a) - activity(b)
    return value * (sort.direction === 'asc' ? 1 : -1) || name(a).localeCompare(name(b)) || a.id.localeCompare(b.id)
  })
}
