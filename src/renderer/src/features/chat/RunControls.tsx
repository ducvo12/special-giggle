import PromptChoices from './PromptChoices'
import { isLiveRun, type RunSnapshot } from '../../../../shared/run'
import type { AgentMessage } from '../../../../shared/agent'

export function runLabel(run: RunSnapshot) {
  if (run.phase === 'queued') return `${run.queue?.reason ?? 'Queued'}${run.queue?.position ? ` · position ${run.queue.position}` : ''}`
  return ({ preparing: 'Preparing reply', streaming: 'Responding', tools: 'Using tools', question: 'Waiting for your answer', approval: 'Waiting for your approval',
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
  return <div className={`run-status-bar${!live ? ' run-status-prompt' : ''}`} role="status" aria-live="polite">
    <span>{run ? runLabel(run) : 'Reply interrupted'}{run?.error && <span role="alert"> · {run.error}</span>}{pending ? ' · messages awaiting an explicit restart' : ''}</span>
    {!live && <div className="run-status-actions">
      <PromptChoices key={pending ? 'pending' : 'interrupted'} label={pending ? 'Pending messages' : 'Interrupted reply'} autoFocus={false} disabled={disabled}
        options={pending ? ['Run pending messages', 'Reject'] : ['Continue']}
        onChoose={index => { void (pending ? index === 0 ? onRunPending() : onCancelPending() : onContinue()) }} />
    </div>}
  </div>
}
