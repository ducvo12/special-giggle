export interface SetupGrant {
  id: string
  runId: string
  agentId: string
  conversationId: string
  projectId: string
  origin: { messageId?: string; approvalId?: string; previousGrantId?: string }
  // 'preview' is retained for reading historical records; previews need no grant.
  operation: 'setup' | 'dependencies' | 'command' | 'preview'
  command?: string
  framework?: 'vite' | 'next'
  state: 'active' | 'revoked' | 'ended'
  createdAt: number
  reason: string
}
export interface PreviewSnapshot {
  id: string
  agentId: string
  conversationId: string
  projectId: string
  runId: string
  command: string
  cwd: string
  port: number
  url: string
  status: 'starting' | 'ready' | 'failed' | 'stopped' | 'interrupted'
  revision: string
  capturedAt: number
  stale: boolean
  output: string
  error?: string
}
