import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AgentMessage } from '../../../../shared/agent'
import { responseClock } from './response-clock'

export default function ResponseDuration({ message }: { message: AgentMessage }) {
  useSyncExternalStore(responseClock.subscribe, responseClock.snapshot)
  const [, tick] = useState(0)
  const clock = responseClock.get(message.id)
  const duration = message.responseDurationMs ?? clock?.durationMs
  useEffect(() => {
    if (!clock || duration !== undefined || !['running', 'complete'].includes(message.status ?? '')) return
    const timer = window.setInterval(() => tick(value => value + 1), 100)
    return () => window.clearInterval(timer)
  }, [clock, duration, message.status])
  useEffect(() => {
    if (message.status !== 'complete' || message.content) return
    let second: number
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => responseClock.rendered(message.id, '')) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [message.id, message.status, message.content])
  if (duration === undefined && (!clock || !['running', 'complete'].includes(message.status ?? ''))) return null
  const elapsed = duration ?? responseClock.elapsed(message.id) ?? 0
  return <span className="response-duration">{duration === undefined ? 'Responding' : 'Response time'} · {(elapsed / 1000).toFixed(1)}s</span>
}
