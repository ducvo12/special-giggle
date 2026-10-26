export type RunPhase = 'queued' | 'preparing' | 'streaming' | 'tools' | 'approval' |
  'reconnecting' | 'stopping' | 'complete' | 'stopped' | 'error' | 'interrupted' | 'not_started'

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
}

export interface RecoveryNotice {
  active: number
  pending: number
}

export type RunIntent = 'message' | 'continue' | 'pending'

export function isLiveRun(run: RunSnapshot) {
  return !['complete', 'stopped', 'error', 'interrupted', 'not_started'].includes(run.phase)
}

export function locksChat(run: RunSnapshot) {
  return isLiveRun(run) && run.startedAt !== null
}
