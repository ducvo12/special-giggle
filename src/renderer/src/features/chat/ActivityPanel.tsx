import { useEffect, useState } from 'react'
import type { AgentMessage } from '../../../../shared/agent'
import type { RepositoryReport } from '../../../../shared/repository'
import type { RunSnapshot } from '../../../../shared/run'
import type { ChatAttachment } from './attachments'
import RepositoryChanges from './RepositoryChanges'
import ProjectActivity from './ProjectActivity'
import AttachedFiles from './AttachedFiles'
import ActivitySection from './ActivitySection'
import { activitySummary } from './activity-summary'

export default function ActivityPanel({ agentId, conversationId, repository, busy, stopping, run, messages, attachments, disabled, onAttachmentsChange, onStop }: {
  agentId: string; conversationId: string; repository: boolean; busy: boolean; stopping: boolean
  run?: RunSnapshot; messages: AgentMessage[]; attachments: ChatAttachment[]; disabled: boolean
  onAttachmentsChange: (files: ChatAttachment[]) => void
  onStop: () => Promise<void>
}) {
  const [reports, setReports] = useState<RepositoryReport[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(conversationId))
  useEffect(() => {
    if (!conversationId || !agentId) return
    let current = true
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const result = await window.granite.repositories.reports(agentId, conversationId)
        if (!current) return
        if (result.ok) { setReports(result.value); setError('') }
        else setError(result.error)
      } catch { if (current) setError('Could not load repository activity. Retrying…') }
      finally {
        if (current) { setLoading(false); timer = setTimeout(() => void load(), 1500) }
      }
    }
    void load()
    return () => { current = false; clearTimeout(timer) }
  }, [agentId, conversationId])
  const { active } = activitySummary(reports, run)
  return <aside id="chat-activity-panel" className="chat-activity-panel" aria-label="Chat activity">
    <div className="activity-panel-body" aria-busy={loading}>
      {error && <p className="activity-error" role="alert">{error}</p>}
      <RepositoryChanges agentId={agentId} conversationId={conversationId} run={run} reports={reports}
        onChange={updated => setReports(previous => previous.map(report => report.runId === updated.runId ? updated : report))} />
      <AttachedFiles key={`${agentId}:${conversationId}`} attachments={attachments} messages={messages} disabled={disabled} onChange={onAttachmentsChange} />
      <ActivitySection title="Terminal processes" summary={<span className="activity-count">{active.length}</span>}>
        {active.map(command => <details key={`${command.runId}:${command.id}`} className="activity-item">
          <summary><span className="activity-file-name" title={command.command}>{command.command}</span><span className={`activity-status ${['starting', 'running', 'publishing'].includes(command.status) ? 'is-active' : ''}`}>{command.status}</span></summary>
          <code className="activity-command">{command.command}</code>
          <p className="activity-hint">{command.cwd} · {command.publication === 'staged' ? 'Changes staged' : command.publication === 'applied' ? 'Changes applied' : command.publication === 'partial' ? 'Some changes applied' : 'Changes discarded'}{command.exitCode != null ? ` · Exit ${command.exitCode}` : ''}</p>
          {command.output && <pre aria-label="Terminal output">{command.output}</pre>}
          {command.error && <p className="activity-error" role="alert">{command.error}</p>}
          {busy && command.runId === run?.id && ['starting', 'running', 'publishing'].includes(command.status) && <button className="quiet-button" disabled={stopping} onClick={() => void onStop()}>{stopping ? 'Stopping…' : 'Stop task'}</button>}
        </details>)}
      </ActivitySection>
      {repository && agentId && conversationId ? <ProjectActivity agentId={agentId} chatId={conversationId} busy={busy} />
        : <ActivitySection title="Running apps" summary={<span className="activity-count">0</span>} />}
    </div>
  </aside>
}
