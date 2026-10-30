export type ContextKind = 'message' | 'summary' | 'note' | 'memory'

export interface ContextReference {
  id: string
  kind: ContextKind
  title: string
  revision: string
  conversationId?: string
  messageId?: string
  path?: string
  sectionId?: string
  projectId?: string | null
}

export interface ContextDocument extends ContextReference {
  agentId: string
  content: string
  updatedAt: number
  role?: string
}

export interface ContextFilters {
  section_id?: string
  project_id?: string
  kind?: ContextKind
  cursor?: string
  limit?: number
}

export interface ContextStatus {
  window: number
  inputTokens: number
  inputBudget: number
  counting: string
  compactions: number
}
