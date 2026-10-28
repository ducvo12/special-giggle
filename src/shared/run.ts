export type RunPhase = 'queued' | 'preparing' | 'streaming' | 'tools' | 'approval' |
  'question' | 'reconnecting' | 'stopping' | 'complete' | 'stopped' | 'error' | 'interrupted' | 'not_started'

export interface UserQuestion {
  id: string
  questions: { title: string; options?: string[]; optional?: boolean }[]
}

export function isQuestionOptional(question: UserQuestion['questions'][number]) {
  return Boolean(question.options?.length) || question.optional === true
}

export interface RunSnapshot {
  id: string
  agentId: string
  conversationId: string
  phase: RunPhase
  model: string
  connectionId?: string
  effort?: string
  createdAt: number
  startedAt: number | null
  endedAt: number | null
  messageIds: string[]
  queue?: { reason: string; position?: number }
  error?: string
  repository?: { projectId: string; name: string; files: number; added: number; removed: number; state: 'active' | 'settled' | 'attention'; error?: string; commandVersion?: number }
  question?: UserQuestion
  projectEntry?: { projectId: string; name: string }
}

export interface RecoveryNotice {
  active: number
  pending: number
  repositories?: number
  previews?: number
}

export type RunIntent = 'message' | 'continue' | 'pending'

export function isLiveRun(run: RunSnapshot) {
  return !['complete', 'stopped', 'error', 'interrupted', 'not_started'].includes(run.phase)
}

export function locksChat(run: RunSnapshot) {
  return isLiveRun(run) && run.startedAt !== null
}
