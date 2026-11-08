import { randomUUID } from 'node:crypto'
import type { Result, StreamDelta } from '../shared/chat'
import type { WorkerAction, WorkerArgs, WorkerReply, WorkerValue } from '../shared/ipc.ts'

interface Worker {
  on(event: 'message', listener: (data: WorkerReply) => void): unknown
  on(event: 'exit', listener: () => void): unknown
  postMessage(message: unknown): void
  kill(): boolean
}

export class AgentClient {
  private child: Worker | null = null
  private boot: Promise<unknown> | null = null
  private directory: string
  private pending = new Map<string, { child: Worker; resolve: (result: Result<unknown>) => void }>()
  private fork: () => Worker
  private bootTimeout: number
  private shutdownTimeout: number
  private closed = false
  private closing?: Promise<Result<void>>
  onDelta: (delta: StreamDelta) => void

  constructor(directory: string, onDelta: (delta: StreamDelta) => void, fork: () => Worker, deadlines = { boot: 120_000, shutdown: 10_000 }) {
    this.directory = directory
    this.onDelta = onDelta
    this.fork = fork
    this.bootTimeout = deadlines.boot
    this.shutdownTimeout = deadlines.shutdown
  }

  private async ready() {
    if (!this.child) {
      const child = this.fork()
      this.child = child
      child.on('message', (data: WorkerReply) => {
        if (this.child !== child) return
        if ('delta' in data) {
          this.onDelta(data.delta)

          return
        }

        const pending = this.pending.get(data.id)

        if (pending) {
          this.pending.delete(data.id)
          pending.resolve(data.result)
        }
      })
      child.on('exit', () => {
        if (this.child !== child) {
          return
        }

        this.retire(child, 'The agent worker stopped unexpectedly. Your saved conversation will recover on the next request.')
      })
      this.boot = this.send(child, 'init', [this.directory], this.bootTimeout).then(result => {
        if (!result.ok) {
          this.retire(child, result.error)
          throw new Error(result.error)
        }
      })
    }

    const child = this.child
    await this.boot
    if (!child || this.child !== child) throw new Error('The agent worker stopped during initialization.')
    return child
  }

  private retire(child: Worker, error: string) {
    if (this.child === child) {
      this.child = null
      this.boot = null
    }
    for (const [id, pending] of this.pending) {
      if (pending.child !== child) continue
      this.pending.delete(id)
      pending.resolve({ ok: false, error })
    }
    child.kill()
  }

  private send<Key extends WorkerAction>(child: Worker, action: Key, args: WorkerArgs<Key>, timeout?: number): Promise<Result<WorkerValue<Key>>> {
    return new Promise(resolve => {
      const id = randomUUID()
      const timer = timeout === undefined ? undefined : setTimeout(() => this.retire(child, `Agent worker ${action} timed out.`), timeout)
      this.pending.set(id, {
        child,
        resolve: result => {
          clearTimeout(timer)
          resolve(result as Result<WorkerValue<Key>>)
        }
      })
      try { child.postMessage({ id, action, args }) }
      catch { this.retire(child, 'Could not send a request to the agent worker. Saved work will recover on the next request.') }
    })
  }

  async call<Key extends WorkerAction>(action: Key, ...args: WorkerArgs<Key>): Promise<Result<WorkerValue<Key>>> {
    if (this.closed) return { ok: false, error: 'The agent worker is shutting down.' }
    try {
      const child = await this.ready()

      if (this.closed || this.child !== child) return { ok: false, error: 'The agent worker is unavailable.' }
      return await this.send(child, action, args)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not open the local agent workspace.' }
    }
  }

  shutdown(): Promise<Result<void>> {
    if (this.closing) return this.closing
    this.closed = true
    const child = this.child
    if (!child) {
      this.closing = Promise.resolve({ ok: true, value: undefined })
      return this.closing
    }
    const timer = setTimeout(() => this.retire(child, 'Agent worker shutdown timed out; saved work will recover at startup.'), this.shutdownTimeout)
    this.closing = (async () => {
      try {
        await this.boot
        if (this.child !== child) return { ok: false as const, error: 'Agent worker stopped during shutdown.' }
        const result = await this.send(child, 'shutdown', [])
        return result.ok ? { ok: true as const, value: undefined } : result
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : 'Agent worker shutdown failed.' }
      } finally {
        clearTimeout(timer)
        this.retire(child, 'The agent worker has closed.')
      }
    })()
    return this.closing
  }
}
