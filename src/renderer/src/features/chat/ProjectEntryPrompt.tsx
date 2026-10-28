import { useRef, useState } from 'react'
import { isLiveRun, type RunSnapshot } from '../../../../shared/run'
import PromptChoices from './PromptChoices'

export default function ProjectEntryPrompt({ run, currentProject, onMove }: {
  run?: RunSnapshot; currentProject?: string | null; onMove: (projectId: string) => Promise<boolean>
}) {
  const [confirm, setConfirm] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const entry = run?.projectEntry
  if (!entry || currentProject === entry.projectId || dismissed) return null
  const live = Boolean(run && isLiveRun(run))
  async function choose(index: number) {
    if (pending.current) return
    if (index === 1) { setDismissed(true); return }
    if (live) return
    if (!confirm) { setConfirm(true); return }
    pending.current = true; setWorking(true); setError('')
    try {
      if (await onMove(entry!.projectId)) setDismissed(true)
      else setError('Could not move this chat. Try again.')
    } catch { setError('Could not move this chat. Try again.') }
    finally { pending.current = false; setWorking(false) }
  }
  return <div className="project-entry-prompt">
    <p>To edit {entry.name}, this chat must move permanently into that project. It can read the repository from here.</p>
    {confirm && <p>After moving, this chat cannot leave the repository project. Future runs can edit its files.</p>}
    <PromptChoices key={`${confirm}:${live}`} label={confirm ? 'Confirm project move' : 'Project move'} autoFocus={false}
      options={[confirm ? 'Confirm permanent move' : live ? 'Finish this reply before moving' : `Move into ${entry.name}…`, 'Reject']}
      disabled={working} disabledIndices={live ? [0] : []} onChoose={index => void choose(index)} />
    {error && <p className="prompt-error" role="alert">{error}</p>}
  </div>
}
