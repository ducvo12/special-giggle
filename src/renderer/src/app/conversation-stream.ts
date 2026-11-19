import type { AgentMessage } from '../../../shared/agent'
import type { StreamDelta } from '../../../shared/chat'

// Apply one streamed delta to the running reply it belongs to. Returns the same
// array when no running reply matches, so stale requests cannot modify history.
export function applyStreamDelta(messages: AgentMessage[], delta: StreamDelta): AgentMessage[] {
  const reply = [...messages].reverse().find(message => message.role === 'assistant' && message.status === 'running' &&
    (message.runId === delta.requestId || message.id === delta.requestId))
  if (!reply) return messages

  return messages.map(message => {
    if (message !== reply || message.role !== 'assistant') return message
    const tools = delta.tool
      ? [...(message.tools ?? []).filter(tool => tool.id !== delta.tool!.id), delta.tool]
      : message.tools
    return { ...message, content: message.content + delta.text, tools,
      ...(delta.contextUsage ? { contextUsage: delta.contextUsage } : {}) }
  })
}
