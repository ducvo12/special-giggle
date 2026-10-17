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
export interface StreamDelta { requestId: string; text: string }
export interface GraniteBridge {
  platform: string
  connections: {
    list: () => Promise<Result<SavedConnection[]>>
    save: (draft: ConnectionDraft) => Promise<Result<SavedConnection>>
    delete: (id: string) => Promise<Result<void>>
  }
  models: (draft: ConnectionDraft) => Promise<Result<string[]>>
  stream: (requestId: string, connectionId: string, messages: Message[]) => Promise<Result<{ stopped: boolean }>>
  stop: (requestId: string) => Promise<void>
  onDelta: (callback: (delta: StreamDelta) => void) => () => void
}
