type Clock = {
  requestId: string
  started: number
  messageId?: string
  finalText?: string
  renderedText?: string
  renderedAt?: number
  durationMs?: number
  persist?: (messageId: string, durationMs: number) => void
}

// Independent of the optional developer timing instrumentation.
export class ResponseClock {
  private records = new Map<string, Clock>()
  private aliases = new Map<string, string>()
  private listeners = new Set<() => void>()
  version = 0
  private now: () => number
  constructor(now = () => performance.now()) { this.now = now }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.version
  private publish() { this.version++; this.listeners.forEach(listener => listener()) }
  get(id: string) { return this.records.get(this.aliases.get(id) ?? id) }
  begin(requestId: string) {
    this.records.set(requestId, { requestId, started: this.now() })
  }
  bind(requestId: string, messageId: string, finalText: string, persist: Clock['persist']) {
    const clock = this.get(requestId)
    if (!clock) return
    this.aliases.set(messageId, requestId)
    Object.assign(clock, { messageId, finalText, persist })
    this.finish(clock)
    this.publish()
  }
  rendered(id: string, text: string) {
    const clock = this.get(id)
    if (!clock || clock.durationMs !== undefined || clock.renderedText === text) return
    clock.renderedText = text
    clock.renderedAt = this.now()
    this.finish(clock)
  }
  private finish(clock: Clock) {
    if (clock.durationMs !== undefined || !clock.messageId || clock.finalText !== clock.renderedText || clock.renderedAt === undefined) return
    clock.durationMs = Math.max(0, Math.round(clock.renderedAt - clock.started))
    clock.persist?.(clock.messageId, clock.durationMs)
    this.publish()
  }
  elapsed(id: string) {
    const clock = this.get(id)
    return clock ? clock.durationMs ?? Math.max(0, this.now() - clock.started) : undefined
  }
}
export const responseClock = new ResponseClock()
