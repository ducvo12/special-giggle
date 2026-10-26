export interface RateLimitWindow {
  kind: 'requests' | 'tokens' | 'project-tokens'
  limit: number
  remaining: number
  resetsAt?: number
}

export interface ConnectionUsage {
  connectionId: string
  model: string
  observedAt: number
  windows: RateLimitWindow[]
}

// A response is a snapshot, not a live balance. Never assume a reset refills it.
export function currentUsageWindows(usage: ConnectionUsage, now = Date.now()) {
  if (now >= usage.observedAt + 5 * 60_000) return []

  return usage.windows.filter(window => window.resetsAt === undefined || window.resetsAt > now)
}
