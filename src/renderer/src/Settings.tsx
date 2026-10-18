import React, { useEffect, useRef, useState } from 'react'
import type { ConnectionDraft, SavedConnection } from '../../shared/chat'
const emptyConnection = (): ConnectionDraft => ({ name: '', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', model: '' })
const bridgeError = 'Could not communicate with the desktop backend.'

export default function Settings({ connections, onChange, onBack }: { connections: SavedConnection[]; onChange: (next: SavedConnection[]) => void; onBack: () => void }) {
  const [editing, setEditing] = useState<ConnectionDraft | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) nameInput.current?.focus() }, [editing?.id, editing === null])
  const original = connections.find(item => item.id === editing?.id)
  const changedEndpoint = original && original.baseUrl !== editing?.baseUrl.trim().replace(/\/+$/, '')
  function edit(item?: SavedConnection) {
    setEditing(item ? { id: item.id, name: item.name, baseUrl: item.baseUrl, model: item.model, apiKey: '' } : emptyConnection())
    setModels([]); setError(''); setNotice(''); setDeleting(null)
  }
  function field(key: keyof ConnectionDraft, value: string | boolean) {
    setEditing(current => current ? { ...current, [key]: value } : null)
    setError(''); setNotice('')
    if (key === 'baseUrl' || key === 'apiKey') setModels([])
  }
  async function loadModels() {
    if (!editing) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await window.granite.models(editing)
      if (!result.ok) { setError(result.error); return }
      setModels(result.value)
      if (!editing.model && result.value[0]) field('model', result.value[0])
      setNotice(result.value.length ? `Connected · ${result.value.length} model${result.value.length === 1 ? '' : 's'} available` : 'Connected · no models listed. Enter a model ID below.')
    } catch { setError(bridgeError) } finally { setBusy(false) }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!editing) return
    setBusy(true); setError('')
    try {
      const result = await window.granite.connections.save(editing)
      if (!result.ok) { setError(result.error); return }
      onChange([...connections.filter(item => item.id !== result.value.id), result.value])
      setEditing(null); setNotice('Connection saved.')
    } catch { setError(bridgeError) } finally { setBusy(false) }
  }
  async function remove(id: string) {
    setBusy(true); setError('')
    try {
      const result = await window.granite.connections.delete(id)
      if (!result.ok) { setError(result.error); return }
      onChange(connections.filter(item => item.id !== id)); setDeleting(null); setNotice('Connection deleted.')
    } catch { setError(bridgeError) } finally { setBusy(false) }
  }
  return <main className="settings-main">
    <header><span>Settings</span><button className="quiet-button" onClick={onBack}>Back to chat</button></header>
    <div className="settings-content">
      <div className="settings-title"><div><div className="eyebrow">PREFERENCES</div><h1>Settings</h1></div></div>
      <div className="settings-tabs"><button aria-current="page">Connections</button></div>
      <div className="section-heading"><div><h2>Model connections</h2><p>Bring a local server or an OpenAI-compatible API.</p></div>{!editing && <button onClick={() => edit()}>+ Add connection</button>}</div>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {editing ? <form className="connection-editor" onSubmit={save}>
        <div className="editor-heading"><h2>{editing.id ? 'Edit connection' : 'New connection'}</h2><span className="badge">OPENAI COMPATIBLE</span></div>
        <fieldset disabled={busy}>
          <label>Connection name<input ref={nameInput} required maxLength={100} value={editing.name} onChange={e => field('name', e.target.value)} placeholder="Home desktop" /></label>
          <label>API base URL<input required type="url" value={editing.baseUrl} onChange={e => field('baseUrl', e.target.value)} placeholder="http://100.x.x.x:1234/v1" /><small>Include the API prefix, usually /v1. Use your desktop’s IP for remote LM Studio.</small></label>
          <label>API key <span className="optional">Optional</span><input type="password" autoComplete="new-password" disabled={editing.removeKey} value={editing.apiKey} onChange={e => field('apiKey', e.target.value)} placeholder={original?.hasKey ? 'Saved securely · leave blank to keep' : 'Only if the server requires one'} /></label>
          {original?.hasKey && <label className="checkbox-label"><input type="checkbox" checked={Boolean(editing.removeKey)} onChange={e => { field('removeKey', e.target.checked); if (e.target.checked) field('apiKey', '') }} /> Remove saved API key</label>}
          {changedEndpoint && original.hasKey && <p className="field-hint">The URL changed. Re-enter the key or remove the saved key before saving.</p>}
          <div className="model-field"><label>Model ID<input required list="available-models" value={editing.model} onChange={e => field('model', e.target.value)} placeholder="Load models or enter an ID" /><datalist id="available-models">{models.map(model => <option key={model} value={model} />)}</datalist></label><button type="button" className="quiet-button" onClick={() => void loadModels()} disabled={!editing.baseUrl.trim()}>{busy ? 'Checking…' : 'Load models'}</button></div>
        </fieldset>
        <div className="editor-footer"><p>Keys are encrypted with your system’s credential protection.</p><div><button type="button" className="quiet-button" disabled={busy} onClick={() => { setEditing(null); setError(''); setNotice('') }}>Cancel</button><button disabled={busy} type="submit">{busy ? 'Working…' : 'Save connection'}</button></div></div>
      </form> : <div className="connection-list">
        {!connections.length && <div className="empty-connections"><span>⇄</span><h2>No connections yet</h2><p>Connect LM Studio on this device or your desktop,<br />or bring a compatible hosted API.</p><button className="quiet-button" onClick={() => edit()}>Add your first connection</button></div>}
        {connections.map(item => <article className="connection-card" key={item.id}><div className="connection-icon">⇄</div><div className="connection-details"><h3>{item.name}</h3><p>{item.model}</p><span>{item.baseUrl} {item.hasKey && '· Key saved'}</span></div><div className="connection-actions">{deleting === item.id ? <><span>Delete connection?</span><button className="quiet-button" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button><button className="danger-button" disabled={busy} onClick={() => void remove(item.id)}>Delete</button></> : <><button className="quiet-button" onClick={() => edit(item)}>Edit</button><button className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => setDeleting(item.id)}>×</button></>}</div></article>)}
      </div>}
      <p className="settings-footnote">Connections are saved on this device. Model inference runs at the endpoint you choose.</p>
    </div>
  </main>
}
