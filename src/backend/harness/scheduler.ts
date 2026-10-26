import type { Connection } from '../../shared/chat.ts'

function localEndpoint(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '::1' || host.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    host.startsWith('fc') && host.includes(':') || host.startsWith('fd') && host.includes(':')
}

export function modelResource(connection: Connection) {
  const url = new URL(connection.baseUrl)
  const local = localEndpoint(url)
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.hostname = 'localhost'
  const endpoint = url.href.replace(/\/+$/, '')
  return {
    key: local ? `local:${url.origin}` : connection.provider === 'chatgpt'
      ? `account:${connection.accountId}` : `remote:${connection.connectionId ?? endpoint}`,
    capacity: connection.maxConcurrentRequests ?? (local ? 1 : 2),
    reason: local ? 'Queued for local model' : 'Queued for model connection'
  }
}

type Waiter = {
  signal: AbortSignal
  notify: (position: number) => void
  grant: () => void
  abort: () => void
}

// A lease covers one model request, never tools, approvals or the whole run.
export class ModelScheduler {
  private resources = new Map<string, { active: number; capacity: number; waiting: Waiter[] }>()

  acquire(connection: Connection, signal: AbortSignal, notify: (position: number, reason: string) => void) {
    signal.throwIfAborted()
    const { key, capacity, reason } = modelResource(connection)
    const resource = this.resources.get(key) ?? { active: 0, capacity, waiting: [] }
    resource.capacity = Math.max(1, Math.min(32, capacity))
    this.resources.set(key, resource)
    const update = () => resource.waiting.forEach((entry, index) => entry.notify(index + 1))
    const pump = () => {
      while (resource.active < resource.capacity && resource.waiting.length) {
        const next = resource.waiting.shift()!
        next.signal.removeEventListener('abort', next.abort)
        resource.active++
        next.grant()
      }
      update()
      if (!resource.active && !resource.waiting.length) this.resources.delete(key)
    }
    return new Promise<() => void>((resolve, reject) => {
      const entry: Waiter = {
        signal,
        notify: position => notify(position, reason),
        grant: () => {
          let released = false
          resolve(() => {
            if (released) return
            released = true
            resource.active--
            pump()
          })
        },
        abort: () => {
          resource.waiting = resource.waiting.filter(item => item !== entry)
          reject(signal.reason)
          pump()
        }
      }
      signal.addEventListener('abort', entry.abort, { once: true })
      resource.waiting.push(entry)
      pump()
    })
  }
}
