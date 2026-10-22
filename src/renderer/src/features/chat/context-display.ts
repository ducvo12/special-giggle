import type { AgentMessage } from '../../../../shared/agent'
import type { ContextUsage } from '../../../../shared/chat'

type ContextDisplayOptions = {
  usage?: ContextUsage
  limit?: number
  maxOutput?: number
  loading: boolean
  hasResponse: boolean
  busy: boolean
}

export function contextDisplay({ usage, limit, maxOutput, loading, hasResponse }: ContextDisplayOptions) {
  const pending = loading && limit === undefined && !usage
  const empty = !hasResponse && !pending && limit !== undefined
  const unavailable = !pending && !empty && !usage
  const value = (count?: number) => pending ? '...' : unavailable ? '—' : empty ? '0' : count?.toLocaleString() ?? '—'
  const percentage = pending || unavailable || !limit ? undefined : empty ? 0 : usage!.totalTokens / limit * 100
  return {
    percentage,
    summary: pending ? '...' : percentage === undefined ? '—' : `${Math.round(percentage)}% used`,
    label: pending ? 'Context usage loading' : percentage === undefined ? 'Context usage unavailable' : `${Math.round(percentage)}% context used`,
    used: value(usage?.totalTokens),
    limit: limit?.toLocaleString() ?? (loading ? '...' : '—'),
    input: value(usage?.inputTokens),
    output: value(usage?.outputTokens),
    cached: value(usage?.cachedTokens),
    reasoning: value(usage?.reasoningTokens),
    maxOutput: value(maxOutput)
  }
}

// Keep the previous completed snapshot until the new response finishes. Never
// fall back past a completed reply that omitted its usage metadata.
export function latestContextResponse(messages: AgentMessage[], model: string) {
  return [...messages].reverse().find(message => message.role === 'assistant' &&
    message.model === model && (message.status === 'complete' || message.status === undefined))
}
