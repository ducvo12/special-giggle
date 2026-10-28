import type { RepositoryReport } from '../../../../shared/repository.ts'
import type { PreviewSnapshot } from '../../../../shared/setup.ts'
import type { RunSnapshot } from '../../../../shared/run.ts'

export function activitySummary(reports: RepositoryReport[], run?: RunSnapshot) {
  const latest = run?.repository ? reports.find(report => report.runId === run.id) : reports.at(-1)
  const visible = reports.filter(report => report === latest || report.state === 'attention')
  const added = run?.repository?.added ?? latest?.changes.reduce((total, change) => total + change.added, 0) ?? 0
  const removed = run?.repository?.removed ?? latest?.changes.reduce((total, change) => total + change.removed, 0) ?? 0
  const commands = reports.flatMap(report => (report.commands ?? []).map(command => ({ ...command, runId: report.runId })))
  const active = commands.filter(command => ['starting', 'running', 'publishing'].includes(command.status))
  return { latest, visible, added, removed, active }
}

export function activePreviews(previews: PreviewSnapshot[]) {
  return previews.filter(preview => preview.status === 'starting' || preview.status === 'ready')
}
