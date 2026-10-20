import type { Message } from './chat'

export type RunStatus = 'running' | 'complete' | 'stopped' | 'interrupted' | 'error'

export interface ToolActivity {
  id: string
  name: string
  input: string
  output?: string
  status: 'running' | 'complete' | 'error' | 'interrupted'
}

export interface AgentMessage extends Message {
  id: string
  status?: RunStatus
  tools?: ToolActivity[]
  error?: string
  notice?: string
}

export interface Agent {
  id: string
  name: string
}

export interface Conversation {
  id: string
  agentId: string
  title: string
  updatedAt: number
}

export interface ConversationDetail extends Conversation {
  messages: AgentMessage[]
}

export interface WorkspaceEntry {
  path: string
  directory: boolean
}

export function defaultIdentity(name: string) {
  return `# ${name}
You are ${name}, the user's practical, thoughtful personal assistant.
Be clear, honest, curious, and concise. Respect the user's decisions and privacy.
Never claim to have saved or changed anything unless a tool succeeded.
Your identity is independent of the model selected by the user.
`
}
