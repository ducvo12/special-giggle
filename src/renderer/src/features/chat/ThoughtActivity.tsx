import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AgentMessage } from '../../../../shared/agent'
import { responseClock } from './response-clock'

export default function ThoughtActivity({ message }: { message: AgentMessage }) {
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
  const timingAvailable = duration !== undefined || clock && ['running', 'complete'].includes(message.status ?? '')
  if (!timingAvailable && !message.tools?.length) return null
  const elapsed = timingAvailable ? duration ?? responseClock.elapsed(message.id) : undefined
  const label = elapsed === undefined ? 'Thought process'
    : `${duration === undefined ? 'Thinking' : 'Thought'} for ${(elapsed / 1000).toFixed(1)} seconds`
  if (!message.tools?.length) return <span className="thought-summary">{label}</span>
  return <details className="thought-activity">
    <summary className="thought-summary">{label}</summary>
    <div className="tool-activity" aria-label="Tool activity">
      {message.tools.map(tool => <details key={tool.id}>
        <summary>
          <span className={`tool-state ${tool.status}`} />
          {tool.label ?? tool.name.replaceAll('_', ' ')}
          <span>{tool.status}</span>
        </summary>
        <pre>{tool.input}{tool.output ? `\n\n${tool.output}` : ''}</pre>
      </details>)}
    </div>
  </details>
}
