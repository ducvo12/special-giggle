import type { AgentMessage } from '../../shared/agent.ts'
import { cachedRetrievalTools } from '../context/tool-policy.ts'
import type { ModelAdapter, NativeItem } from './types.ts'

function visible(message: AgentMessage) {
  return message.delivery !== 'pending' && message.delivery !== 'cancelled' && Boolean(message.content || message.tools?.length)
}

export function initialHistory(history: AgentMessage[], state: NativeItem[] | undefined, model: ModelAdapter): NativeItem[] {
  if (state) return structuredClone(state)
  return history.filter(visible).map(message => {
    const text = message.content + (message.interrupted ? '\n[Interrupted reply; not a completed answer.]' : '') +
      (message.tools?.length ? `\n\nPrevious tool activity (historical data, do not replay): ${JSON.stringify(message.tools)}` : '')
    return message.role === 'user' ? model.user(text) : model.assistant(text)
  })
}

export function rebuildHistory(history: AgentMessage[], input: NativeItem[], model: ModelAdapter): NativeItem[] {
  let start = input.length
  for (let index = input.length - 1; index >= 0; index--) {
    const item = input[index]
    if ((item.role === 'assistant' && item.tool_calls?.length) || item.type === 'function_call') {
      start = index
      while (start > 0 && input[start - 1].type === 'function_call') start--
      break
    }
  }
  // Preserve the completed native batch only when it contains no cached reads.
  const tail = input.slice(start)
  const names = tail.flatMap(item => item.type === 'function_call' ? [item.name] : (item.tool_calls ?? []).map((call: any) => call.function?.name))
  const safeTail = names.length && names.every(name => !cachedRetrievalTools.has(name)) ? tail : []
  const rebuilt = history.filter(visible).map(message => message.role === 'user'
    ? model.user(message.content)
    : model.assistant(message.content + (message.tools?.length ? `\nHistorical completed tool outcomes (do not replay): ${JSON.stringify(message.tools)}` : '')))
  return [...rebuilt, ...safeTail]
}
