import { currentUsageWindows, type ConnectionUsage, type RateLimitWindow } from '../../shared/connection-usage.ts'

export interface UsageBinding {
  connectionId: string
  model: string
  revision: number
}

export class ConnectionUsageStore {
  private readings = new Map<string, ConnectionUsage>()
  private revisions = new Map<string, number>()

  bind(connectionId: string, model: string): UsageBinding {
    return { connectionId, model, revision: this.revisions.get(connectionId) ?? 0 }
  }

  invalidate(connectionId: string) {
    this.revisions.set(connectionId, (this.revisions.get(connectionId) ?? 0) + 1)
    this.readings.delete(connectionId)
  }

  observe(binding: UsageBinding, windows: RateLimitWindow[], now = Date.now()) {
    if (binding.revision !== (this.revisions.get(binding.connectionId) ?? 0) || !windows.length) return false

    this.readings.set(binding.connectionId, {
      connectionId: binding.connectionId, model: binding.model, observedAt: now, windows
    })
    return true
  }

  list(now = Date.now()) {
    return [...this.readings.values()].flatMap(usage => {
      const windows = currentUsageWindows(usage, now)
      return windows.length ? [{ ...usage, windows }] : []
    })
  }
}
