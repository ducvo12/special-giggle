import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Result, StreamDelta } from '../shared/chat'

export class AgentClient {
  private child: UtilityProcess | null = null
  private boot: Promise<unknown> | null = null
  private directory: string
  private pending = new Map<string, (result: Result<unknown>) => void>()
  onDelta: (delta: StreamDelta) => void
  constructor(directory: string, onDelta: (delta: StreamDelta) => void) { this.directory = directory; this.onDelta = onDelta }
  private async ready() {
    if (!this.child) {
      const child = utilityProcess.fork(join(__dirname, 'agent-worker.js'), [], { serviceName: 'Granite Agents' })
      this.child = child
      child.on('message', data => {
        if (data.delta) { this.onDelta(data.delta); return }
        const resolve = this.pending.get(data.id)
        if (resolve) { this.pending.delete(data.id); resolve(data.result) }
      })
      child.on('exit', () => {
        if (this.child !== child) return
        this.child = null; this.boot = null
        for (const resolve of this.pending.values()) resolve({ ok: false, error: 'The agent worker stopped unexpectedly. Your saved conversation will recover on the next request.' })
        this.pending.clear()
      })
      this.boot = this.send('init', [this.directory]).then(result => { if (!result.ok) throw new Error(result.error) })
    }
    await this.boot
  }
  private send(action: string, args: unknown[]): Promise<Result<unknown>> {
    return new Promise(resolve => { const id = randomUUID(); this.pending.set(id, resolve); this.child!.postMessage({ id, action, args }) })
  }
  async call(action: string, ...args: unknown[]): Promise<Result<unknown>> {
    try { await this.ready(); return await this.send(action, args) }
    catch { this.child?.kill(); return { ok: false, error: 'Could not open the local agent workspace.' } }
  }
}
