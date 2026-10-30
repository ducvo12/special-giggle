import type { ContextUsage, Message } from './chat'
import type { ChatRetention, ConversationLocation } from './organization'

export type RunStatus = 'running' | 'complete' | 'stopped' | 'interrupted' | 'error'

export interface ToolActivity {
  id: string
  name: string
  label?: string
  input: string
  output?: string
  status: 'running' | 'complete' | 'error' | 'interrupted'
}

export interface AgentMessage extends Message {
  sources?: import('./context').ContextReference[]
  contextStatus?: import('./context').ContextStatus
  runId?: string
  questionId?: string
  questions?: { id: string; questions: import('./run').UserQuestion['questions']; status: 'pending' | 'answered' | 'rejected' | 'withdrawn' | 'interrupted'; answers?: string[] }[]
  delivery?: 'pending' | 'processed' | 'cancelled'
  contextUsage?: ContextUsage
  responseDurationMs?: number
  connectionId?: string
  effort?: string
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

export interface Conversation extends ConversationLocation {
  id: string
  agentId: string
  title: string
  updatedAt: number
  createdAt: number
  lastChattedAt: number | null
  retention: ChatRetention
  expiresAt: number | null
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
