import { useState } from 'react'
import type { RunSnapshot } from '../../../../shared/run'
import { isLiveRun } from '../../../../shared/run'

export default function ProjectEntryPrompt({ run, currentProject, onMove }: {
  run?: RunSnapshot; currentProject?: string | null; onMove: (projectId: string) => Promise<boolean>
}) {
  const [confirm, setConfirm] = useState(false)
  const [working, setWorking] = useState(false)
  const entry = run?.projectEntry
  if (!entry || currentProject === entry.projectId) return null
  const live = Boolean(run && isLiveRun(run))
  return <div className="project-entry-prompt" role="status">
    <p>To edit {entry.name}, this chat must move permanently into that project. It can read the repository from here.</p>
    {confirm ? <>
      <p>After moving, this chat cannot leave the repository project. Future runs can edit its files.</p>
      <button disabled={live || working} onClick={() => { setWorking(true); void onMove(entry.projectId).finally(() => setWorking(false)) }}>Confirm permanent move</button>
      <button disabled={working} onClick={() => setConfirm(false)}>Cancel</button>
    </> : <button disabled={live} onClick={() => setConfirm(true)}>{live ? 'Finish this reply before moving' : `Move into ${entry.name}…`}</button>}
  </div>
}
