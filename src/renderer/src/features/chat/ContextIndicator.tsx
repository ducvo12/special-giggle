import { contextDisplay } from './context-display'
import { useId, useRef, useState } from 'react'
import type { ContextUsage } from '../../../../shared/chat'

export default function ContextIndicator({ usage, limit, maxOutput, busy, loading, hasResponse }: {
  usage?: ContextUsage
  limit?: number
  maxOutput?: number
  busy: boolean
  loading: boolean
  hasResponse: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState({ left: 8, bottom: 48 })
  function placeTooltip() {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(300, window.innerWidth - 60)
    setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), bottom: window.innerHeight - rect.top + 8 })
  }
  const display = contextDisplay({ usage, limit, maxOutput, busy, loading, hasResponse })
  const { percentage } = display
  return (
    <div onMouseEnter={placeTooltip} onFocus={placeTooltip} className={`context-indicator ${open ? 'open' : ''}`} onKeyDown={event => {
      if (event.key === 'Escape') { setOpen(false); event.currentTarget.querySelector('button')?.blur() }
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <button ref={trigger} type="button" className="context-trigger" aria-label={display.label} aria-describedby={id}
        onClick={() => setOpen(value => !value)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" className="context-ring-track" />
          {percentage !== undefined && <circle cx="12" cy="12" r="9" pathLength="100"
            strokeDasharray={`${Math.min(100, Math.max(0, percentage))} 100`} transform="rotate(-90 12 12)" className="context-ring-value" />}
          {percentage === undefined && <text x="12" y="15" textAnchor="middle" className="context-ring-unknown">{display.summary === '...' ? '...' : '—'}</text>}
        </svg>
      </button>
      <div id={id} role="tooltip" className="context-tooltip" style={position}>
        <strong>Context usage</strong>
        <span>{display.summary}</span>
        <dl>
          <div><dt>Used</dt><dd>{display.used}</dd></div>
          <div><dt>Context window</dt><dd>{display.limit}</dd></div>
          <div><dt>Input tokens</dt><dd>{display.input}</dd></div>
          <div><dt>Output tokens</dt><dd>{display.output}</dd></div>
          <div><dt>Cached input</dt><dd>{display.cached}</dd></div>
          <div><dt>Reasoning tokens</dt><dd>{display.reasoning}</dd></div>
          {maxOutput !== undefined && <div><dt>Max output tokens</dt><dd>{display.maxOutput}</dd></div>}
        </dl>
      </div>
    </div>
  )
}
