import { useId, useRef, useState } from 'react'
import type { ApprovalRequest } from '../../../../shared/harness'
import PromptChoices from '../chat/PromptChoices'

export default function ApprovalPrompt({ request, onAnswer, autoFocus = true }: {
  request: ApprovalRequest; onAnswer: (allow: boolean) => Promise<void>; autoFocus?: boolean
}) {
  const titleId = useId()
  const detailId = useId()
  const pending = useRef(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  async function answer(allow: boolean) {
    if (pending.current) return
    pending.current = true; setWorking(true); setError('')
    try { await onAnswer(allow) }
    catch { setError('Could not send your decision. Try again.') }
    finally { pending.current = false; setWorking(false) }
  }
  return <div className="approval-panel">
    <div className="approval-dialog" role="region" aria-labelledby={titleId} aria-describedby={detailId} aria-busy={working}
      onKeyDown={event => {
        if (event.key === 'Escape' && !working) { event.preventDefault(); void answer(false) }
      }}>
      <h2 id={titleId} className="prompt-title">{request.title}</h2>
      <pre id={detailId}>{request.detail}</pre>
      <PromptChoices options={['Allow once', 'Reject']} label={request.title} disabled={working} autoFocus={autoFocus} onChoose={index => void answer(index === 0)} />
      <p className="prompt-key-hint">{working ? 'Sending…' : '↑ ↓ to choose · Enter to submit'}</p>
      {error && <p className="prompt-error" role="alert">{error}</p>}
    </div>
  </div>
}
