import { responseClock } from './response-clock'
import FormattedResponse from './FormattedResponse'
import { recordVisible } from './devTimings'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { RunStatus } from '../../../../shared/agent'

export default function StreamingText({
  messageId, text, status, end, follow
}: {
  messageId: string
  text: string
  status?: RunStatus
  end: RefObject<HTMLDivElement | null>
  follow: RefObject<boolean>
}) {
  const [visible, setVisible] = useState(status === 'running' ? '' : text)
  const revealed = useRef(visible)
  const animated = useRef(status === 'running')
  const previousFrame = useRef(0)
  const credit = useRef(0)

  useEffect(() => {
    // Existing history is immediate. Only replies observed while streaming animate.
    if (
      !animated.current ||
      (status && status !== 'running' && status !== 'complete') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !text.startsWith(revealed.current)
    ) {
      animated.current = status === 'running'
      revealed.current = text
      setVisible(text)
      return
    }

    let frame: number
    function tick(now: number) {
      const elapsed = previousFrame.current ? Math.min(64, now - previousFrame.current) : 16
      previousFrame.current = now
      const remaining = text.length - revealed.current.length
      // A steady baseline for small chunks; catch up quickly when a large burst arrives.
      credit.current += Math.max(80, remaining / 0.18) * elapsed / 1000
      const count = Math.min(remaining, Math.floor(credit.current))
      if (count > 0) {
        let next = revealed.current.length + count
        // Never reveal half of a UTF-16 surrogate pair.
        const last = text.charCodeAt(next - 1)
        if (last >= 0xd800 && last <= 0xdbff && next < text.length) next++
        credit.current = Math.max(0, credit.current - (next - revealed.current.length))
        revealed.current = text.slice(0, next)
        setVisible(revealed.current)
      }
      if (revealed.current.length < text.length) {
        frame = requestAnimationFrame(tick)
      } else {
        previousFrame.current = 0
        credit.current = 0
      }
    }

    if (revealed.current !== text) frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text, status])

  useEffect(() => {
    recordVisible(messageId, visible.length)
    if (follow.current) end.current?.scrollIntoView()
  }, [messageId, visible, end, follow])

  useEffect(() => {
    // Two frames let the committed text paint before capturing its visible time.
    let second: number
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => responseClock.rendered(messageId, visible))
    })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [messageId, visible])

  return <FormattedResponse text={visible} />
}
