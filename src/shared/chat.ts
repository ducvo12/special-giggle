import type { Agent, Conversation, ConversationDetail, ToolActivity, WorkspaceEntry } from './agent'
import type { ApprovalRequest, ChatGPTAccount, HarnessSettings } from './harness'
import type { AgentOrganization, ConversationLocation, Project, Section, SectionMode } from './organization'

export interface Connection {
  connectionId?: string
  provider?: 'openai' | 'codex' | 'chatgpt'
  protocol?: 'chat-completions' | 'responses'
  accountId?: string
  effort?: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface SavedConnection {
  provider?: 'openai' | 'codex' | 'chatgpt'
  protocol?: 'chat-completions' | 'responses'
  accountId?: string
  effort?: string
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

export interface ContextUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens?: number
  reasoningTokens?: number
}

export interface ModelOption {
  contextWindow?: number
  maxOutputTokens?: number
  reasoningLevels?: { effort: string; description?: string }[]
  defaultReasoningLevel?: string
  id: string
  name: string
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  model?: string
  interrupted?: boolean
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface StreamActivity {
  reasoningCharacters: number
  answerCharacters: number
  finishReason?: string
}

export interface StreamDelta {
  requestId: string
  text: string
  activity?: StreamActivity
  tool?: ToolActivity
  contextUsage?: ContextUsage
  approval?: ApprovalRequest | null
}

export interface GraniteBridge {
  platform: string
  agents: {
    list: () => Promise<Result<Agent[]>>
    create: (name: string) => Promise<Result<Agent>>
    delete: (agentId: string) => Promise<Result<void>>
    saveIdentity: (agentId: string, identity: string, expected: string) => Promise<Result<string>>
  }
  connections: {
    list: () => Promise<Result<SavedConnection[]>>
    save: (draft: ConnectionDraft) => Promise<Result<SavedConnection>>
    delete: (id: string) => Promise<Result<void>>
    models: (id: string) => Promise<Result<ModelOption[]>>
  }
  models: (draft: ConnectionDraft) => Promise<Result<string[]>>
  chatgpt: {
    accounts: () => Promise<Result<ChatGPTAccount[]>>
    login: (accountId?: string) => Promise<Result<ChatGPTAccount>>
    cancelLogin: () => Promise<Result<void>>
    signOut: (id: string) => Promise<Result<{ revoked: boolean }>>
  }
  harness: {
    get: (agentId: string) => Promise<Result<HarnessSettings>>
    save: (agentId: string, settings: HarnessSettings) => Promise<Result<HarnessSettings>>
    skills: (agentId: string) => Promise<Result<{ name: string; content: string }[]>>
    saveSkill: (agentId: string, name: string, content: string) => Promise<Result<void>>
    approve: (requestId: string, approvalId: string, allow: boolean) => Promise<Result<void>>
  }
  conversations: {
    saveResponseDuration: (agentId: string, id: string, messageId: string, durationMs: number) => Promise<Result<void>>
    list: (agentId: string) => Promise<Result<Conversation[]>>
    create: (agentId: string, location?: Partial<ConversationLocation>) => Promise<Result<ConversationDetail>>
    move: (agentId: string, id: string, location: ConversationLocation) => Promise<Result<ConversationDetail>>
    rename: (agentId: string, id: string, title: string) => Promise<Result<void>>
    delete: (agentId: string, id: string) => Promise<Result<void>>
    get: (agentId: string, id: string) => Promise<Result<ConversationDetail>>
  }
  organization: {
    get: (agentId: string) => Promise<Result<AgentOrganization>>
    createSection: (agentId: string, name: string, mode: SectionMode) => Promise<Result<Section>>
    renameSection: (agentId: string, id: string, name: string) => Promise<Result<Section>>
    shareSection: (agentId: string, id: string) => Promise<Result<Section>>
    createProject: (agentId: string, sectionId: string, name: string) => Promise<Result<Project>>
    renameProject: (agentId: string, id: string, name: string) => Promise<Result<Project>>
    chooseRepository: (agentId: string, projectId: string) => Promise<Result<Project | null>>
  }
  workspace: {
    entries: (agentId: string, path: string) => Promise<Result<WorkspaceEntry[]>>
    read: (agentId: string, path: string) => Promise<Result<string>>
    save: (agentId: string, path: string, content: string, expected: string | null) => Promise<Result<string>>
    renameNote: (agentId: string, path: string, name: string) => Promise<Result<string>>
  }
  stream: (
    requestId: string,
    agentId: string,
    conversationId: string,
    connectionId: string,
    text: string,
    model?: string,
    effort?: string
  ) => Promise<Result<{ stopped: boolean }>>
  stop: (requestId: string) => Promise<void>
  onDelta: (callback: (delta: StreamDelta) => void) => () => void
}
