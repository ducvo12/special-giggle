import { useEffect, useState } from 'react'
import type { PreviewSnapshot, SetupGrant } from '../../../../shared/setup'

export default function ProjectActivity({ agentId, chatId, busy }: { agentId: string; chatId: string; busy: boolean }) {
  const [previews, setPreviews] = useState<PreviewSnapshot[]>([])
  const [grants, setGrants] = useState<SetupGrant[]>([])
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  useEffect(() => {
    let current = true
    const load = async () => {
      try {
        const [previewResult, grantResult] = await Promise.all([window.granite.previews.list(agentId, chatId), window.granite.setup.grants(agentId, chatId)])
        if (!current) return
        if (previewResult.ok) setPreviews(previewResult.value)
        if (grantResult.ok) setGrants(grantResult.value)
      } catch { if (current) setError('Could not load project activity.') }
    }
    void load(); const timer = setInterval(() => void load(), 1500)
    return () => { current = false; clearInterval(timer) }
  }, [agentId, chatId])
  async function action(run: () => Promise<{ ok: boolean; error?: string }>) {
    setWorking(true); setError('')
    try { const result = await run(); if (!result.ok) setError(result.error ?? 'Action failed.') }
    catch { setError('Could not communicate with the desktop backend.') }
    finally { setWorking(false) }
  }
  const visible = previews.filter(preview => ['starting','ready'].includes(preview.status) || preview === previews.at(-1))
  const visibleGrants = grants.filter(grant => grant.operation !== 'preview').slice(-5)
  if (!visible.length && !visibleGrants.length && !error) return null
  return <div className="project-activity" aria-label="Project activity">
    {error && <p role="alert">{error}</p>}
    {!!visibleGrants.length && <details><summary>Task permissions · {visibleGrants.filter(grant => grant.state === 'active').length} active</summary>
      <p>Limited to this repository and task. Revoking applies to subsequent actions; use Stop to halt a running command.</p>
      {visibleGrants.map(grant => <div key={grant.id}><span>{grant.reason} · {grant.state}</span><button type="button" disabled={working || grant.state === 'revoked'} onClick={() => void action(() => window.granite.setup.revoke(agentId, chatId, grant.id))}>Revoke task permissions</button></div>)}
    </details>}
    {visible.map(preview => <details key={preview.id} className="preview-card"><summary>Local preview · {preview.status}{preview.stale ? ' · older code' : ''}</summary>
      <p>Code snapshot {preview.revision.slice(0, 10) || 'preparing'} · {new Date(preview.capturedAt).toLocaleTimeString()}{preview.stale ? '. Refresh to include newer edits.' : '. Refresh after edits outside Granite.'}</p>
      {preview.error && <p role="alert">{preview.error}</p>}
      <code>{preview.url}</code>
      <pre aria-label="Preview output">{preview.output}</pre>
      <div className="preview-actions">
        <button type="button" disabled={working || preview.status !== 'ready'} onClick={() => void action(() => window.granite.previews.open(agentId, chatId, preview.id))}>Open preview</button>
        <button type="button" disabled={working || busy} onClick={() => void action(() => window.granite.previews.restart(agentId, chatId, preview.id))}>Refresh from current code</button>
        <button type="button" disabled={working || !['starting','ready'].includes(preview.status)} onClick={() => void action(() => window.granite.previews.stop(agentId, chatId, preview.id))}>Stop preview</button>
      </div>
    </details>)}
  </div>
}
