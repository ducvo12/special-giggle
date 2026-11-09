import type { ChatGPTAccount } from './harness'

export interface Connection {
  contextWindow?: number
  maxOutputTokens?: number
  maxConcurrentRequests?: number
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
  maxConcurrentRequests?: number
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

export interface ModelOption {
  contextWindow?: number
  maxOutputTokens?: number
  reasoningLevels?: { effort: string; description?: string }[]
  defaultReasoningLevel?: string
  id: string
  name: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code?: 'model_access' }

export interface GraniteBridge {
  platform: string
  window: {
    setMinimumSize: (width: number, height: number) => Promise<Result<void>>
  }
  connections: {
    list: () => Promise<Result<SavedConnection[]>>
    save: (draft: ConnectionDraft) => Promise<Result<SavedConnection>>
    delete: (id: string) => Promise<Result<void>>
    models: (id: string, refresh?: boolean) => Promise<Result<ModelOption[]>>
  }
  models: (draft: ConnectionDraft) => Promise<Result<string[]>>
  chatgpt: {
    accounts: () => Promise<Result<ChatGPTAccount[]>>
    login: (accountId?: string) => Promise<Result<ChatGPTAccount>>
    cancelLogin: () => Promise<Result<void>>
    signOut: (id: string) => Promise<Result<{ revoked: boolean }>>
  }
}
