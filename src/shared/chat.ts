export interface Connection {
  baseUrl: string
  apiKey: string
  model: string
}
export interface SavedConnection {
  id: string
  name: string
  baseUrl: string
  model: string
  hasKey: boolean
}
export interface ConnectionDraft extends Connection {
  id?: string
  name: string
  removeKey?: boolean
}
export interface Message {
  role: 'user' | 'assistant'
  content: string
  model?: string
  interrupted?: boolean
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export interface StreamActivity { reasoningCharacters: number; answerCharacters: number; finishReason?: string }
export interface StreamDelta { requestId: string; text: string; activity?: StreamActivity; tool?: ToolActivity }
export interface GraniteBridge {
  platform: string
  agents: {
    list: () => Promise<Result<Agent[]>>
    create: (name: string) => Promise<Result<Agent>>
    saveIdentity: (agentId: string, identity: string, expected: string) => Promise<Result<string>>
  }
  connections: {
    list: () => Promise<Result<SavedConnection[]>>
    save: (draft: ConnectionDraft) => Promise<Result<SavedConnection>>
    delete: (id: string) => Promise<Result<void>>
  }
  models: (draft: ConnectionDraft) => Promise<Result<string[]>>
  conversations: {
    list: (agentId: string) => Promise<Result<Conversation[]>>
    create: (agentId: string) => Promise<Result<ConversationDetail>>
    get: (agentId: string, id: string) => Promise<Result<ConversationDetail>>
  }
  workspace: {
    entries: (agentId: string, path: string) => Promise<Result<WorkspaceEntry[]>>
    read: (agentId: string, path: string) => Promise<Result<string>>
  }
  stream: (requestId: string, agentId: string, conversationId: string, connectionId: string, text: string) => Promise<Result<{ stopped: boolean }>>
  stop: (requestId: string) => Promise<void>
  onDelta: (callback: (delta: StreamDelta) => void) => () => void
}
import type { Agent, Conversation, ConversationDetail, ToolActivity, WorkspaceEntry } from './agent'
