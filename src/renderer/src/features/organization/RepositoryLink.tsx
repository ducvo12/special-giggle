import { useEffect, useState } from 'react'
import type { Project } from '../../../../shared/organization'
import type { RepositoryEditorChoices } from '../../../../shared/repository-editor'
import TreeMenu from '../../components/TreeMenu'

export function useRepositoryEditors() {
  const [choices, setChoices] = useState<RepositoryEditorChoices | null>(null)
  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const result = await window.granite.repositories.editors()
        if (active && result.ok) setChoices(result.value)
      } catch { /* The repository action reports bridge failures when used. */ }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('focus', refresh) }
  }, [])
  return { choices, setChoices }
}

export default function RepositoryLink({ agentId, project, disabled, choices, onChoices }: {
  agentId: string; project: Project; disabled: boolean; choices: RepositoryEditorChoices | null
  onChoices: (choices: RepositoryEditorChoices) => void
}) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const editor = choices?.editors.find(editor => editor.id === choices.selectedId)
  async function open(editorId?: string, choose = false) {
    if (working || disabled) return
    setWorking(true); setError('')
    try {
      const result = await (choose ? window.granite.repositories.chooseEditor(agentId, project.id)
        : window.granite.repositories.open(agentId, project.id, editorId))
      if (!result.ok) setError(result.error)
      else if (result.value) onChoices(result.value)
    } catch { setError('Could not open this repository. Try again from Open with…') }
    finally { setWorking(false) }
  }
  return <div className="repository-launcher">
    <div className="tree-row">
      <button className="tree-entry repository-tree-link" aria-label={`Open repository for ${project.name}`}
        title={`${editor ? `Open in ${editor.name}` : 'Open in an editor'}\n${project.repositoryPath}`}
        disabled={disabled || working} onClick={() => void open()}>
        <span aria-hidden="true">↗</span><span>{working ? 'Opening…' : 'Repository'}</span>
      </button>
      <TreeMenu label={`Open with… for ${project.name}`} disabled={disabled || working} items={[
        { label: 'Open with…' },
        ...(choices?.editors ?? []).map(editor => ({ label: editor.name, checked: editor.id === choices?.selectedId, action: () => void open(editor.id) })),
        { label: 'Choose another application…', action: () => void open(undefined, true) }
      ]} />
    </div>
    {error && <p className="repository-open-error" role="alert">{error}</p>}
  </div>
}
