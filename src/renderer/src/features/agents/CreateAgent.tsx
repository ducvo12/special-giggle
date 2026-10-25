import { useEffect, useState } from 'react'
import type { Agent } from '../../../../shared/agent'

export default function CreateAgent({ busy, onDirty, onCreated, onBack }: {
  busy: boolean; onDirty: (dirty: boolean) => void; onCreated: (agent: Agent) => Promise<void>; onBack: () => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { onDirty(Boolean(name.trim()) || saving); return () => onDirty(false) }, [name, saving, onDirty])
  async function create() {
    if (saving || busy || !name.trim()) return
    setSaving(true); setError('')
    try {
      const result = await window.granite.agents.create(name)
      if (!result.ok) { setError(result.error); return }
      await onCreated(result.value)
    } catch { setError('Could not create the agent. Try again.') }
    finally { setSaving(false) }
  }
  return <main className="settings-main">
    <header><span>New agent</span><button className="quiet-button" disabled={saving} onClick={onBack}>Cancel</button></header>
    <div className="settings-content">
      <h1>New agent</h1>
      <p className="agent-description">Give your agent a name. Its identity, memory, notes, and sections will appear in the explorer.</p>
      {error && <div className="error" role="alert">{error}</div>}
      <form className="connection-editor" onSubmit={event => { event.preventDefault(); void create() }}>
        <label>Agent name<input aria-label="Agent name" autoFocus required maxLength={80} value={name} disabled={saving || busy}
          placeholder="e.g. Nova" onChange={event => setName(event.target.value)} /></label>
        <div className="editor-footer"><button disabled={saving || busy || !name.trim()}>{saving ? 'Creating…' : 'Create agent'}</button></div>
      </form>
    </div>
  </main>
}
