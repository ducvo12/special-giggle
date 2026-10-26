import { useEffect, useId, useRef, useState } from 'react'
import type { SavedConnection } from '../../../../shared/chat'
import { currentUsageWindows, type ConnectionUsage, type RateLimitWindow } from '../../../../shared/connection-usage'

const names = { requests: 'Requests', tokens: 'Tokens', 'project-tokens': 'Project tokens' }
const percentage = (window: RateLimitWindow) => window.remaining / window.limit * 100
const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })

function UsageCircle({ usage, connection, number, now }: {
  usage: ConnectionUsage
  connection: SavedConnection
  number: number
  now: number
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, bottom: 48 })
  const trigger = useRef<HTMLButtonElement>(null)
  const windows = currentUsageWindows(usage, now)
  if (!windows.length) return null

  const remaining = Math.min(...windows.map(percentage))
  const summary = `${format(remaining)}% remaining`
  function placeTooltip() {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return

    const width = Math.min(280, window.innerWidth - 16)
    setPosition({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      bottom: window.innerHeight - rect.top + 8
    })
  }

  return (
    <div className={`connection-usage ${open ? 'open' : ''}`}
      onMouseEnter={placeTooltip} onFocus={placeTooltip}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          setOpen(false)
          trigger.current?.blur()
        }
      }}>
      <button ref={trigger} type="button" className="connection-usage-trigger"
        aria-label={`Connection ${number}: ${connection.name}, ${summary}`}
        aria-describedby={id} onClick={() => setOpen(value => !value)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" className="connection-usage-track" />
          <circle cx="12" cy="12" r="9" pathLength="100" strokeDasharray={`${remaining} 100`}
            transform="rotate(-90 12 12)" className="connection-usage-value" />
        </svg>
      </button>

      <div id={id} role="tooltip" className="connection-usage-tooltip" style={position}>
        <strong>
          {connection.name}
        </strong>

        <span>
          Connection {number} · {usage.model}
        </span>

        {windows.map(window => (
          <div key={window.kind} className="connection-usage-detail">
            <span>
              {names[window.kind]} · {format(percentage(window))}% remaining
            </span>

            <span>
              {format(window.remaining)} / {format(window.limit)}
              {window.resetsAt !== undefined && ` · resets ${new Date(window.resetsAt).toLocaleTimeString()}`}
            </span>
          </div>
        ))}

        <small>
          Last reported {new Date(usage.observedAt).toLocaleTimeString()}
          {windows.length > 1 && ' · Circle shows the lowest remaining limit'}
        </small>
      </div>
    </div>
  )
}

export default function ConnectionUsageCircles({ connections }: { connections: SavedConnection[] }) {
  const [readings, setReadings] = useState<ConnectionUsage[]>([])
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    let disposed = false
    let updated = false
    const unsubscribe = window.granite.connections.onUsage(usage => {
      updated = true
      setReadings(usage)
      setNow(Date.now())
    })
    void window.granite.connections.usage().then(result => {
      if (!disposed && !updated && result.ok) setReadings(result.value)
    }).catch(() => {})
    const timer = window.setInterval(() => setNow(Date.now()), 1000)

    return () => {
      disposed = true
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [connections])

  return (
    <div className="connection-usage-list" role="group" aria-label="Connection usage limits">
      {connections.map((connection, index) => {
        const usage = readings.find(reading => reading.connectionId === connection.id)
        return usage && <UsageCircle key={connection.id} connection={connection} usage={usage} number={index + 1} now={now} />
      })}
    </div>
  )
}
