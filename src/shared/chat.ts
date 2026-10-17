export interface Connection {
  baseUrl: string
  apiKey: string
  model: string
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface GraniteBridge {
  platform: string
  models: (connection: Connection) => Promise<Result<string[]>>
  chat: (connection: Connection, messages: Message[]) => Promise<Result<string>>
}
