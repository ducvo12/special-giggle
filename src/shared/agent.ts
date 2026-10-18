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
export interface Conversation { id: string; title: string; updatedAt: number }
export interface ConversationDetail extends Conversation { messages: AgentMessage[] }
export interface WorkspaceEntry { path: string; directory: boolean }
