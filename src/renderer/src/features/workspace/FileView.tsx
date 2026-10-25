import { useEffect, useState } from 'react'
import type { Agent } from '../../../../shared/agent'
import FormattedResponse from '../chat/FormattedResponse'

export default function FileView({ agent, path, busy, onDirty, onSaved }: {
  agent: Agent; path: string; busy: boolean; onDirty: (value: boolean) => void; onSaved: () => void
}) {
  const [original, setOriginal] = useState('')
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const dirty = text !== original
  const editable = path === '/identity.md' || path === '/memory.md' || path.startsWith('/notes/') && path.endsWith('.md')
  useEffect(() => { onDirty(dirty || saving); return () => onDirty(false) }, [dirty, saving, onDirty])
  useEffect(() => {
    let current = true
    setLoading(true)
    void window.granite.workspace.read(agent.id, path).then(result => {
      if (!current) return
      if (result.ok) { setOriginal(result.value); setText(result.value); setError('') }
      else setError(result.error)
    }).catch(() => { if (current) setError('Could not load this file.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [agent.id, path, revision])

  async function save() {
    if (busy || loading || saving || !dirty) return
    setSaving(true)
    setError('')
    try {
      const result = await window.granite.workspace.save(agent.id, path, text, original)
      if (!result.ok) { setError(result.error); return }
      setOriginal(result.value); setText(result.value); setEditing(false); onSaved()
    } catch { setError('Could not save this file. Your draft is still here.') }
    finally { setSaving(false) }
  }
  return <main className="file-main">
    <header className="file-heading">
      <div className="file-breadcrumb" title={`${agent.name}${path}`}>{agent.name} / {path.slice(1)}{dirty && <span className="file-dirty"> · Unsaved</span>}</div>
      <div className="file-actions">
        {editing ? <>
          <button className="quiet-button" disabled={saving} onClick={() => { setText(original); setEditing(false); setError('') }}>Cancel</button>
          <button disabled={busy || loading || saving || !dirty} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
        </> : <>
          <button className="quiet-button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh</button>
          {editable && <button className="quiet-button" disabled={busy || loading || Boolean(error)} onClick={() => setEditing(true)}>Edit</button>}
        </>}
      </div>
    </header>
    {error && <div className="file-error error" role="alert">{error}
      {editing && <button className="quiet-button" disabled={saving} onClick={() => { setText(original); setEditing(false); setRevision(value => value + 1) }}>Discard draft and reload</button>}
    </div>}
    {editing ? <div className="file-editor-wrap">
      <textarea className="file-editor" aria-label={`Edit ${path.split('/').at(-1)}`} autoFocus spellCheck={false}
        value={text} maxLength={path === '/identity.md' ? 32_000 : 100_000} disabled={saving}
        onChange={event => setText(event.target.value)} onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); void save() }
          if (event.key === 'Tab') {
            event.preventDefault()
            const element = event.currentTarget
            const start = element.selectionStart, end = element.selectionEnd
            setText(text.slice(0, start) + '  ' + text.slice(end))
            requestAnimationFrame(() => { element.selectionStart = element.selectionEnd = start + 2 })
          }
        }} />
      <div className="file-editor-status">Markdown · {text.split('\n').length} lines · {text.length.toLocaleString()} characters</div>
    </div> : <section className="file-preview" aria-label="File preview" aria-busy={loading}>
      {loading ? <p>Loading…</p> : !error && (path.endsWith('.md') ? <FormattedResponse text={text || '*This file is empty.*'} /> : <pre>{text}</pre>)}
    </section>}
  </main>
}
