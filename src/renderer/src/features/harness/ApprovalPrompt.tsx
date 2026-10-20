import { useEffect, useRef, useState } from 'react'
import type { ApprovalRequest } from '../../../../shared/harness'

export default function ApprovalPrompt({
  request,
  onAnswer,
  onStop
}: {
  request: ApprovalRequest
  onAnswer: (allow: boolean) => Promise<void>
  onStop: () => Promise<void>
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector('button')?.focus()

    return () => previous?.focus()
  }, [request.id])

  async function answer(allow: boolean) {
    setWorking(true)

    try {
      await onAnswer(allow)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="approval-backdrop">
      <div
        className="approval-dialog"
        ref={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        aria-describedby="approval-detail"
        onKeyDown={event => {
          if (event.key === 'Escape' && !working) {
            event.preventDefault()
            void answer(false)
          }

          if (event.key === 'Tab') {
            const buttons = [
              ...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
            ]
            const first = buttons[0],
              last = buttons.at(-1)

            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <div className="eyebrow">
          YOUR APPROVAL
        </div>

        <h2 id="approval-title">
          {request.title}
        </h2>

        <p>
          This permission applies to this action only. Denying it sends the decision back to your agent.
        </p>

        <pre id="approval-detail">
          {request.detail}
        </pre>

        <div className="approval-actions">
          <button className="quiet-button" disabled={working} onClick={() => void answer(false)}>
            Deny
          </button>

          <button className="quiet-button" disabled={working} onClick={() => void onStop()}>
            Stop agent
          </button>

          <button disabled={working} onClick={() => void answer(true)}>
            Allow once
          </button>
        </div>
      </div>
    </div>
  )
}
