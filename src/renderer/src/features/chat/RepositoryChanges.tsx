import { useEffect, useRef, useState } from 'react'
import type { RepositoryReport } from '../../../../shared/repository'
import type { RunSnapshot } from '../../../../shared/run'

export default function RepositoryChanges({ agentId, conversationId, run }: { agentId: string; conversationId: string; run?: RunSnapshot }) {
  const [reports, setReports] = useState<RepositoryReport[]>([])
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [open, setOpen] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(200)
  const disclosure = useRef<HTMLDetailsElement>(null)
  const signature = JSON.stringify(run?.repository)
  useEffect(() => setVisibleLimit(200), [conversationId, run?.id])
  useEffect(() => {
    let current = true
    setError('')
    if (conversationId) void window.granite.repositories.reports(agentId, conversationId).then(result => {
      if (!current) return
      if (result.ok) setReports(result.value)
      else setError(result.error)
    }).catch(() => { if (current) setError('Could not load repository changes.') })
    return () => { current = false }
  }, [agentId, conversationId, run?.phase, signature])

  useEffect(() => {
    if (!open) return
    const close = () => { if (disclosure.current) disclosure.current.open = false }
    const outside = (event: PointerEvent) => { if (!disclosure.current?.contains(event.target as Node)) close() }
    const scroll = (event: Event) => { if (!disclosure.current?.contains(event.target as Node)) close() }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open])

  async function review(report: RepositoryReport, acknowledge: boolean) {
    setWorking(true); setError('')
    try {
      const result = await window.granite.repositories.review(agentId, conversationId, report.runId, acknowledge)
      if (result.ok) setReports(previous => previous.map(item => item.runId === report.runId ? result.value : item))
      else setError(result.error)
    } catch { setError('Could not review the repository outcome.') }
    finally { setWorking(false) }
  }
  const latest = run?.repository ? reports.find(report => report.runId === run.id) : reports.at(-1)
  const added = run?.repository?.added ?? latest?.changes.reduce((n, change) => n + change.added, 0) ?? 0
  const removed = run?.repository?.removed ?? latest?.changes.reduce((n, change) => n + change.removed, 0) ?? 0
  const visible = reports.filter(report => report === latest || report.state === 'attention')
  const attention = reports.some(report => report.state === 'attention') || run?.repository?.state === 'attention'
  if (!reports.length && !run?.repository && !error) return null
  return <details ref={disclosure} className={`repository-changes${attention || error ? ' needs-attention' : ''}`}
    onToggle={event => setOpen(event.currentTarget.open)}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        event.currentTarget.open = false
        event.currentTarget.querySelector('summary')?.focus()
      }
    }}>
    <summary aria-label={`Repository changes: ${added} lines added, ${removed} lines removed${attention ? '. Needs review' : ''}`}
      title={attention ? 'Repository changes need review' : 'View latest repository changes'}>
      <span className="diff-added">+{added}</span><span className="diff-removed">−{removed}</span>
    </summary>
    <div className="repository-change-panel" role="region" aria-label="Repository change details">
    {error && <p role="alert">{error}</p>}
    {!visible.length && <p>{run?.repository ? 'Loading changes…' : 'No repository changes.'}</p>}
    {visible.map(report => <details key={report.runId} open>
      <summary>{report.name} · {report.changes.length} changed {report.changes.some(change => change.directory) ? 'items' : report.changes.length === 1 ? 'file' : 'files'}
        <span className="diff-added"> +{report.changes.reduce((n, change) => n + change.added, 0)}</span>
        <span className="diff-removed"> −{report.changes.reduce((n, change) => n + change.removed, 0)}</span>
        {report.gitChanged ? ' · Git state changed' : ''}
        {report.state === 'active' ? ' · working' : report.state === 'attention' ? ' · needs review' : ''}
      </summary>
      <p>Changes from this run. Unchanged files are excluded. Edits to these files made outside Granite may also appear. Stop keeps completed changes.</p>
      {report.error && <p role="alert">{report.error}</p>}
      {(report.commands ?? []).slice(-5).map(command => <details key={command.id} className="repository-file-change" open={['starting','running','publishing'].includes(command.status)}>
        <summary>Command · {command.status} · {command.publication === 'staged' ? 'changes staged' : command.publication === 'applied' ? 'changes applied' : command.publication === 'partial' ? 'some changes applied' : 'staged changes discarded'}</summary>
        <code>{command.command}</code>
        {command.output && <pre aria-label="Command output">{command.output}</pre>}
        {command.error && <p role="alert">{command.error}</p>}
      </details>)}
      {report.state === 'attention' && <div className="repository-review-actions">
        <button type="button" disabled={working} onClick={() => void review(report, false)}>Recheck stopped work</button>
        <button type="button" disabled={working} onClick={() => void review(report, true)}>I’ve reviewed the remaining outcome</button>
      </div>}
      {[...report.changes].sort((a, b) => Number(Boolean(a.generated)) - Number(Boolean(b.generated))).slice(0, visibleLimit).map(change => <details key={change.path} className="repository-file-change">
        <summary>{change.previousPath ? `${change.previousPath} → ` : ''}{change.path} · {change.directory ? 'folder · ' : ''}{change.kind}
          {change.modeChanged ? ' · permissions changed' : ''}
          {change.symbolicLink ? ' · symbolic link' : change.generated ? ' · dependency/generated output' : change.binary ? ' · binary' : change.large ? ' · large file' : ` · +${change.added} −${change.removed}`}</summary>
        {change.diff ? <pre>{change.diff}{change.truncated ? '\n[Diff shortened for display.]' : ''}</pre> : <p>{change.directory ? 'Folder structure or permissions changed.' : change.generated ? 'Dependency/generated output changed; individual text-line counts are omitted.' : change.binary ? 'Binary contents changed.' : change.large ? 'Contents changed; this file is too large for the inline diff.' : change.kind === 'renamed' ? 'Contents unchanged.' : 'No text lines changed.'}</p>}
      </details>)}
      {report.changes.length > visibleLimit && <button type="button" onClick={() => setVisibleLimit(count => count + 200)}>Show more changes · {report.changes.length - visibleLimit} remaining</button>}
    </details>)}
    </div>
  </details>
}
