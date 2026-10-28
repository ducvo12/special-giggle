import { useEffect, useState } from 'react'
import type { WorkspaceEntry } from '../../../../shared/agent'
import TreeMenu from '../../components/TreeMenu'
import Chevron from '../../components/Chevron'
import TreeActionIcon from '../../components/TreeActionIcon'

export default function NotesTree({ agentId, path = '/notes/', disabled, actionsDisabled = disabled, selectedFile, revision, onOpen, onCreate, onRename }: {
  agentId: string; path?: string; disabled: boolean; selectedFile: string; revision: number
  actionsDisabled?: boolean; onOpen: (path: string) => void; onCreate: () => void; onRename: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!open) return
    let current = true
    setLoading(true)
    void window.granite.workspace.entries(agentId, path).then(result => {
      if (!current) return
      if (result.ok) { setEntries(result.value); setError('') }
      else setError(result.error)
    }).catch(() => { if (current) setError('Could not load notes.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [agentId, path, open, revision, retry])
  useEffect(() => { if (selectedFile.startsWith(path)) setOpen(true) }, [selectedFile, path])
  const name = path.split('/').filter(Boolean).at(-1)
  return <div className="notes-tree">
    <div className="tree-row">
      <button className="tree-entry" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>
        <span className="tree-chevron" aria-hidden="true"><Chevron expanded={open} /></span><span>{name}/</span>
      </button>
      {path === '/notes/' && <button className="tree-action" aria-label="New note" title="New note" disabled={actionsDisabled} onClick={onCreate}><TreeActionIcon plus /></button>}
    </div>
    {open && <div className="organization-children">
      {loading && <div className="tree-empty">Loading…</div>}
      {error && <div className="tree-empty" role="alert">{error}<button className="tree-action" aria-label="Retry loading notes" onClick={() => setRetry(value => value + 1)}>↻</button></div>}
      {!loading && !error && !entries.length && <div className="tree-empty">No notes yet</div>}
      {entries.map(entry => entry.directory ? <NotesTree key={entry.path} {...{ agentId, disabled, actionsDisabled, selectedFile, revision, onOpen, onCreate, onRename }} path={entry.path} />
        : <div className="tree-row note-row" key={entry.path}>
          <button className={`tree-entry tree-file ${selectedFile === entry.path ? 'selected' : ''}`}
          aria-current={selectedFile === entry.path ? 'page' : undefined}
          title={entry.path} disabled={disabled} onClick={() => onOpen(entry.path)}>
          <span className="tree-file-icon" aria-hidden="true">▤</span><span>{entry.path.split('/').at(-1)}</span>
          </button>
          {entry.path.endsWith('.md') && <TreeMenu label={`Options for note ${entry.path.split('/').at(-1)}`} disabled={actionsDisabled}
            items={[{ label: 'Rename note', action: () => onRename(entry.path) }]} />}
        </div>)}
    </div>}
  </div>
}
