import type { AgentMessage } from '../../../../shared/agent.ts'
import type { ContextReference } from '../../../../shared/context.ts'

export interface SourceGroup {
  key: string
  title: string
  kind: 'chat' | 'memory' | 'note'
  sources: ContextReference[]
}

// Keep current questions out of the compact evidence list, including steering
// messages in the same run. Older messages in this chat remain valid sources.
export function replyQuestions(messages: AgentMessage[]) {
  const runs = new Map<string, Set<string>>()
  for (const message of messages) {
    if (message.role !== 'user' || !message.runId) continue
    const ids = runs.get(message.runId) ?? new Set<string>()
    ids.add(message.id)
    runs.set(message.runId, ids)
  }
  const result = new Map<string, Set<string>>()
  let previous: string | undefined
  for (const message of messages) {
    if (message.role === 'user') previous = message.id
    else result.set(message.id, message.runId && runs.has(message.runId)
      ? runs.get(message.runId)! : new Set(previous ? [previous] : []))
  }
  return result
}

export function groupSources(sources: ContextReference[], excludeMessageIds: ReadonlySet<string> = new Set()) {
  const groups = new Map<string, SourceGroup>()
  const seen = new Set<string>()
  for (const source of sources) {
    const messageId = source.messageId ?? (source.id.startsWith('message:') ? source.id.slice(8) : undefined)
    if (seen.has(source.id) || messageId && excludeMessageIds.has(messageId)) continue
    seen.add(source.id)
    // Distinct chats with the same title must stay distinct. Summaries and
    // messages of one chat share a group; files retain their individual identity.
    const chat = Boolean(source.conversationId) && ['message', 'summary'].includes(source.kind)
    const key = chat ? `chat:${source.conversationId}` : source.id
    const group = groups.get(key) ?? {
      key, title: chat ? source.title || 'Saved chat' : source.kind === 'memory' ? 'Memory' : source.path ?? source.title,
      kind: chat ? 'chat' : source.kind === 'memory' ? 'memory' : 'note', sources: []
    } satisfies SourceGroup
    group.sources.push(source)
    groups.set(key, group)
  }
  return [...groups.values()]
}
