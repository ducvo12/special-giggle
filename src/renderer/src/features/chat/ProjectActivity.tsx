import { useEffect, useState } from 'react'
import type { PreviewSnapshot } from '../../../../shared/setup'
import ActivitySection from './ActivitySection'
import { activePreviews } from './activity-summary'

export default function ProjectActivity({ agentId, chatId, busy }: { agentId: string; chatId: string; busy: boolean }) {
  const [previews, setPreviews] = useState<PreviewSnapshot[]>([])
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const result = await window.granite.previews.list(agentId, chatId)
        if (!current) return
        if (result.ok) { setPreviews(result.value); setError('') }
        else setError(result.error)
      } catch { if (current) setError('Could not load running apps.') }
      finally { if (current) timer = setTimeout(() => void load(), 1500) }
    }
    void load()
    return () => { current = false; clearTimeout(timer) }
  }, [agentId, chatId])
  async function action(operation: () => Promise<{ ok: boolean; error?: string }>) {
    setWorking(true); setError('')
    try { const result = await operation(); if (!result.ok) setError(result.error ?? 'Action failed.') }
    catch { setError('Could not communicate with the desktop backend.') }
    finally { setWorking(false) }
  }
  const visible = activePreviews(previews)
  return <>
    {error && <p className="activity-error" role="alert">{error}</p>}
    <ActivitySection title="Running apps" summary={<span className="activity-count">{visible.length}</span>}>
      {visible.map(preview => <details key={preview.id} className="activity-item">
        <summary><span className="activity-file-name" title={preview.command}>{preview.command}</span><span className="activity-status is-active">{preview.status === 'ready' ? 'Running' : 'Starting'}</span></summary>
        {preview.error && <p className="activity-error" role="alert">{preview.error}</p>}
        <code className="activity-command">{preview.url}</code>
        {preview.stale && <p className="activity-hint">Refresh to include newer edits.</p>}
        {preview.output && <pre aria-label="App output">{preview.output}</pre>}
        <div className="preview-actions">
          <button type="button" className="quiet-button" disabled={working || preview.status !== 'ready'} onClick={() => void action(() => window.granite.previews.open(agentId, chatId, preview.id))}>Open</button>
          <button type="button" className="quiet-button" disabled={working || busy} onClick={() => void action(() => window.granite.previews.restart(agentId, chatId, preview.id))}>Refresh</button>
          <button type="button" className="quiet-button" disabled={working} onClick={() => void action(() => window.granite.previews.stop(agentId, chatId, preview.id))}>Stop</button>
        </div>
      </details>)}
    </ActivitySection>
  </>
}
