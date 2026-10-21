import { timingFor, useDevTimings } from './devTimings'

const duration = (value?: number) => value === undefined ? '—' : `${(value / 1000).toFixed(2)} s`
const clock = (value: number) => new Date(value).toLocaleTimeString([], {
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
})

export default function ResponseTimings({ messageId }: { messageId: string }) {
  const { enabled } = useDevTimings()
  const timing = timingFor(messageId)
  if (!enabled || !timing?.endedAt) return null
  const revealed = timing.visibleCharacters >= timing.characters
  return (
    <dl className="response-timings" aria-label="Response dev timings">
      <div><dt>Start</dt><dd>{clock(timing.startedAt)}</dd></div>
      <div><dt>End</dt><dd>{clock(timing.endedAt)}</dd></div>
      <div><dt>Thinking (estimated)</dt><dd>{timing.reasoningCharacters ? duration(timing.thinking) : 'Not reported'}</dd></div>
      <div><dt>First text chunk</dt><dd>{duration(timing.firstChunk === undefined ? undefined : timing.firstChunk - timing.start)}</dd></div>
      <div><dt>Last text chunk received</dt><dd>{duration(timing.lastChunk === undefined ? undefined : timing.lastChunk - timing.start)}</dd></div>
      <div><dt>First → last visible text</dt><dd>{!timing.characters ? '—' : !revealed ? 'Revealing…' : duration(timing.lastVisible === undefined || timing.firstVisible === undefined ? undefined : timing.lastVisible - timing.firstVisible)}</dd></div>
    </dl>
  )
}
