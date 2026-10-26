import { isLiveRun, type RunSnapshot } from '../../../../shared/run'
import type { AgentMessage } from '../../../../shared/agent'

export function runLabel(run: RunSnapshot) {
  if (run.phase === 'queued') return `${run.queue?.reason ?? 'Queued'}${run.queue?.position ? ` · position ${run.queue.position}` : ''}`
  return ({ preparing: 'Preparing reply', streaming: 'Responding', tools: 'Using tools', approval: 'Waiting for your approval',
    reconnecting: 'Reconnecting · one retry', stopping: 'Stopping', complete: 'Finished', stopped: 'Stopped',
    interrupted: 'Interrupted — Granite restarted', not_started: 'Not started — Granite restarted', error: 'Reply could not finish' })[run.phase]
}

export default function RunControls({ run, messages, disabled, onContinue, onRunPending, onCancelPending }: {
  run?: RunSnapshot
  messages: AgentMessage[]
  disabled: boolean
  onContinue: () => Promise<void>
  onRunPending: () => Promise<void>
  onCancelPending: () => Promise<void>
}) {
  const live = run && isLiveRun(run)
  const pending = !live && messages.some(message => message.delivery === 'pending')
  const interrupted = !live && [...messages].reverse().find(message => message.role === 'assistant')?.interrupted
  if (!live && !pending && !interrupted) return null
  return <div className="run-status-bar" role="status" aria-live="polite">
    <span>{run ? runLabel(run) : 'Reply interrupted'}{run?.error && <span role="alert"> · {run.error}</span>}{pending ? ' · messages awaiting an explicit restart' : ''}</span>
    {!live && <div className="run-status-actions">
      {pending ? <>
        <button className="quiet-button" disabled={disabled} onClick={() => void onRunPending()}>Run pending messages</button>
        <button className="quiet-button" disabled={disabled} onClick={() => void onCancelPending()}>Cancel pending request</button>
      </> : interrupted && <button className="quiet-button" disabled={disabled} onClick={() => void onContinue()}>Continue</button>}
    </div>}
  </div>
}
