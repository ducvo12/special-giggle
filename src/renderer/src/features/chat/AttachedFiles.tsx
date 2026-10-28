import { useEffect, useRef, useState } from 'react'
import ActivitySection from './ActivitySection'
import type { AgentMessage } from '../../../../shared/agent'
import { readAttachments, sentAttachments, type ChatAttachment } from './attachments'

export default function AttachedFiles({ attachments, messages, disabled, onChange }: {
  attachments: ChatAttachment[]; messages: AgentMessage[]; disabled: boolean
  onChange: (files: ChatAttachment[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const sent = messages.filter(message => message.role === 'user').flatMap(message =>
    sentAttachments(message.content).map((file, index) => ({ ...file, id: `${message.id}:${index}` })))
  return <>
    <input ref={input} type="file" multiple hidden aria-label="Attach text or code files" disabled={disabled || reading}
      onChange={async event => {
        const files = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ''
        if (!files.length) return
        setReading(true); setError('')
        try { const next = await readAttachments(files, attachments); if (mounted.current) onChange(next) }
        catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not read the files.') }
        finally { if (mounted.current) setReading(false) }
      }} />
    {error && <p className="activity-error" role="alert">{error}</p>}
    <ActivitySection title="Attached files" summary={<span className="activity-count">{attachments.length + sent.length}</span>}
      actions={<button type="button" className="activity-add" title="Attach text or code files · 24 KB total per message" disabled={disabled || reading} onClick={() => input.current?.click()}>Attach</button>}>
    {reading && <p role="status" className="activity-empty">Reading files…</p>}
    {attachments.map(file => <div key={file.id} className="activity-file-row">
      <span className="activity-file-name" title={file.name}>{file.name}<small>{file.size.toLocaleString()} bytes · Next message</small></span>
      <button className="quiet-button" aria-label={`Remove ${file.name}`} disabled={disabled || reading} onClick={() => onChange(attachments.filter(item => item.id !== file.id))}>×</button>
    </div>)}
    {sent.map(file => <details className="activity-item" key={file.id}>
      <summary>{file.name}<span className="activity-status">Sent</span></summary>
      <pre>{file.content}</pre>
    </details>)}
    </ActivitySection>
  </>
}
