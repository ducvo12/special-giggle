import type { AgentMessage } from '../../../shared/agent'
import type { StreamDelta } from '../../../shared/chat'

// The running reply owns its messages independently of the visible chat.
export class ConversationStream {
  requestId: string
  owner: string
  conversationId: string
  messages: AgentMessage[]

  constructor(requestId: string, owner: string, conversationId: string, messages: AgentMessage[]) {
    this.requestId = requestId
    this.owner = owner
    this.conversationId = conversationId
    this.messages = messages
  }

  matches(owner: string, conversationId: string) {
    return this.owner === owner && this.conversationId === conversationId
  }

  apply(delta: StreamDelta) {
    if (delta.requestId !== this.requestId) return
    this.messages = this.messages.map(message => {
      if (message.id !== this.requestId || message.role !== 'assistant') return message
      const tools = delta.tool
        ? [...(message.tools ?? []).filter(tool => tool.id !== delta.tool!.id), delta.tool]
        : message.tools
      return { ...message, content: message.content + delta.text, tools,
        ...(delta.contextUsage ? { contextUsage: delta.contextUsage } : {}) }
    })
  }
}
