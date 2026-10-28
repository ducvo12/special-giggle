import { useEffect, useState } from 'react'
import type { RepositoryReport } from '../../../../shared/repository'
import type { RunSnapshot } from '../../../../shared/run'
import ActivitySection from './ActivitySection'
import { activitySummary } from './activity-summary'

export default function RepositoryChanges({ agentId, conversationId, run, reports, onChange }: {
  agentId: string; conversationId: string; run?: RunSnapshot; reports: RepositoryReport[]
  onChange: (report: RepositoryReport) => void
}) {
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(200)
  useEffect(() => setVisibleLimit(200), [conversationId, run?.id])
  const { visible, added, removed } = activitySummary(reports, run)
  async function review(report: RepositoryReport, acknowledge: boolean) {
    setWorking(true); setError('')
    try {
      const result = await window.granite.repositories.review(agentId, conversationId, report.runId, acknowledge)
      if (result.ok) onChange(result.value)
      else setError(result.error)
    } catch { setError('Could not review the repository outcome.') }
    finally { setWorking(false) }
  }
  return <ActivitySection title="Line changes" summary={
    <span className="activity-line-totals" aria-label={`${added} lines added, ${removed} lines removed`}>
      <span className="diff-added">+{added.toLocaleString()}</span>
      <span className="diff-removed">−{removed.toLocaleString()}</span>
    </span>
  }>
      {error && <p className="activity-error" role="alert">{error}</p>}
      {visible.filter(report => report.state === 'attention' || report.error).map(report => <div className="activity-attention" key={report.runId}>
        <p>{report.name} · {report.error || 'Changes need review.'}</p>
        {report.state === 'attention' && <div className="repository-review-actions">
          <button className="quiet-button" disabled={working} onClick={() => void review(report, false)}>Recheck</button>
          <button className="quiet-button" disabled={working} onClick={() => void review(report, true)}>Mark reviewed</button>
        </div>}
      </div>)}
      {visible.map(report => <div key={report.runId}>
        {(visible.length > 1 || report.gitChanged) && <p className="activity-hint">{report.name}{report.state === 'attention' ? ' · Needs review' : ''}{report.gitChanged ? ' · Git state changed' : ''}</p>}
        {[...report.changes].sort((a, b) => Number(Boolean(a.generated)) - Number(Boolean(b.generated))).slice(0, visibleLimit).map(change => <details key={change.path} className="activity-item repository-file-change">
          <summary><span className="activity-file-name" title={change.path}>{change.path}</span>
            <span className="activity-file-counts"><span className="diff-added">+{change.added}</span> <span className="diff-removed">−{change.removed}</span></span>
          </summary>
          <p className="activity-hint">{change.previousPath ? `${change.previousPath} → ` : ''}{change.kind}{change.directory ? ' · folder' : ''}{change.modeChanged ? ' · permissions changed' : ''}{change.symbolicLink ? ' · symbolic link' : ''}</p>
          {change.diff ? <pre>{change.diff}{change.truncated ? '\n[Diff shortened for display.]' : ''}</pre>
            : <p className="activity-hint">{change.directory ? 'Folder structure or permissions changed.' : change.generated ? 'Generated output changed; text-line counts are omitted.' : change.binary ? 'Binary contents changed.' : change.large ? 'This file is too large for the inline diff.' : 'No text lines changed.'}</p>}
        </details>)}
        {report.changes.length > visibleLimit && <button className="quiet-button" onClick={() => setVisibleLimit(count => count + 200)}>Show {Math.min(200, report.changes.length - visibleLimit)} more</button>}
      </div>)}
  </ActivitySection>
}
