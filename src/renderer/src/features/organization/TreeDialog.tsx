import { useEffect, useId, useRef, useState } from 'react'
import type { Agent } from '../../../../shared/agent'
import type { Result } from '../../../../shared/chat'
import type { AgentOrganization, SectionMode } from '../../../../shared/organization'

export type TreeDialogAction = { type: 'section-create' | 'note-create' } |
  { type: 'note-rename'; path: string } |
  { type: 'section-settings' | 'project-create'; sectionId: string } |
  { type: 'project-settings'; projectId: string }

export default function TreeDialog({ action, agent, organization, disabled, onChange, onClose, onNoteCreated, onNoteRenamed }: {
  action: TreeDialogAction; agent: Agent; organization: AgentOrganization; disabled: boolean
  onChange: (operation: () => Promise<Result<unknown>>) => Promise<boolean>
  onClose: () => void; onNoteCreated: (path: string) => void
  onNoteRenamed: (previous: string, next: string) => void
}) {
  const section = 'sectionId' in action ? organization.sections.find(section => section.id === action.sectionId) : undefined
  const project = 'projectId' in action ? organization.projects.find(project => project.id === action.projectId) : undefined
  const [name, setName] = useState(action.type === 'note-rename' ? action.path.split('/').at(-1) ?? ''
    : action.type.endsWith('settings') ? section?.name ?? project?.name ?? '' : '')
  const [mode, setMode] = useState<SectionMode>('shared')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const modal = useRef<HTMLDivElement>(null)
  const heading = useId()
  const title = action.type === 'section-create' ? 'New section' : action.type === 'project-create' ? 'New project'
    : action.type === 'note-create' ? 'New note' : action.type === 'note-rename' ? 'Rename note' : action.type === 'section-settings' ? 'Section settings' : 'Project settings'
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    modal.current?.querySelector<HTMLElement>('input, button')?.focus()
    return () => previous?.focus()
  }, [])
  const locked = disabled || working
  const api = window.granite.organization
  async function change(operation: () => Promise<Result<unknown>>, close = true) {
    setWorking(true); setError('')
    try {
      let message = ''
      const success = await onChange(async () => {
        const result = await operation()
        if (!result.ok) message = result.error
        return result
      })
      if (success && close) onClose()
      else if (!success) setError(message || 'Could not save these changes. Try again.')
      return success
    } catch { setError('Could not save these changes. Try again.') }
    finally { setWorking(false) }
  }
  async function submit() {
    if (locked) return
    if (action.type === 'note-rename') {
      let next = ''
      const success = await change(async () => {
        const result = await window.granite.workspace.renameNote(agent.id, action.path, name)
        if (result.ok) next = result.value
        return result
      })
      if (success) onNoteRenamed(action.path, next)
    } else if (action.type === 'note-create') {
      const filename = name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`
      if (!name.trim() || /[\\/\u0000-\u001f]/.test(filename) || filename === '..md') { setError('Choose a note name without slashes or control characters.'); return }
      const path = `/notes/${filename}`
      if (await change(() => window.granite.workspace.save(agent.id, path, `# ${filename.slice(0, -3)}\n`, null))) onNoteCreated(path)
    } else if (action.type === 'section-create') await change(() => api.createSection(agent.id, name, mode))
    else if (action.type === 'project-create' && section) await change(() => api.createProject(agent.id, section.id, name))
    else if (action.type === 'section-settings' && section) await change(() => api.renameSection(agent.id, section.id, name))
    else if (action.type === 'project-settings' && project) await change(() => api.renameProject(agent.id, project.id, name))
  }
  return <div className="tree-dialog-backdrop">
    <div className="tree-dialog" ref={modal} role="dialog" aria-modal="true" aria-labelledby={heading}
      onKeyDown={event => {
        if (event.key === 'Escape' && !locked) { event.preventDefault(); onClose() }
        if (event.key === 'Tab') {
          const controls = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])
          if (!controls.length) { event.preventDefault(); return }
          if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
          else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
        }
      }}>
      <h2 id={heading}>{title}</h2>
      {error && <div className="error" role="alert">{error}</div>}
      {action.type === 'section-settings' && section?.kind === 'general' ? <p>General is the built-in Shared section for chats. It cannot contain projects.</p> :
        <form onSubmit={event => { event.preventDefault(); void submit() }}>
          <label>{action.type.startsWith('note-') ? 'File name' : 'Name'}<input aria-label={action.type.startsWith('note-') ? 'Note name' : title + ' name'}
            required maxLength={80} value={name} disabled={locked} onChange={event => setName(event.target.value)} /></label>
          {action.type === 'section-create' && <label>Memory<select aria-label="Section memory" value={mode} disabled={locked} onChange={event => setMode(event.target.value as SectionMode)}>
            <option value="shared">Shared</option><option value="closed">Closed</option>
          </select></label>}
          <div className="tree-dialog-actions"><button className="quiet-button" type="button" disabled={locked} onClick={onClose}>Cancel</button>
            <button disabled={locked || !name.trim() || (action.type.endsWith('settings') && name.trim() === (section?.name ?? project?.name))}>{working ? 'Saving…' : action.type === 'note-rename' ? 'Rename' : action.type.endsWith('settings') ? 'Save name' : 'Create'}</button></div>
        </form>}
      {action.type === 'section-settings' && section && <div className="tree-dialog-extra">
        <p>Memory: {section.mode === 'closed' ? 'Closed' : 'Shared'}</p>
        {section.mode === 'closed' && <><p>Making this section Shared exposes its existing chats and project context to other Shared sections. This cannot be reversed.</p>
          <button disabled={locked} onClick={() => void change(() => api.shareSection(agent.id, section.id))}>Make section Shared</button></>}
        {section.kind === 'general' && <button className="quiet-button" disabled={locked} onClick={onClose}>Close</button>}
      </div>}
      {action.type === 'project-settings' && project && <div className="tree-dialog-extra">
        {project.repositoryPath ? <><p>Repository</p><code>{project.repositoryPath}</code></> : <>
          <p>Linking a folder permanently binds this project and its chats to that repository. Other projects may link the same folder; simultaneous edits can conflict.</p>
          <button disabled={locked} onClick={() => void change(() => api.chooseRepository(agent.id, project.id))}>Link repository folder</button>
        </>}
      </div>}
    </div>
  </div>
}
