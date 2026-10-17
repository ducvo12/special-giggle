import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { ConnectionDraft, Message, SavedConnection } from '../../shared/chat'
import './styles.css'

const emptyConnection = (): ConnectionDraft => ({ name: '', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', model: '' })
const bridgeError = 'Could not communicate with the desktop backend.'

function App() {
  const [page, setPage] = useState<'chat' | 'settings'>('chat')
  const [connections, setConnections] = useState<SavedConnection[]>([])
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem('granite.connection') ?? '')
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState('')
  const run = useRef<string | null>(null)
  const accumulated = useRef('')
  const end = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLElement>(null)
  const follow = useRef(true)
  const connection = connections.find(item => item.id === selectedId)

  useEffect(() => {
    void window.granite.connections.list().then(result => {
      if (result.ok) {
        setConnections(result.value)
        setSelectedId(current => result.value.some(item => item.id === current) ? current : result.value[0]?.id ?? '')
      } else setError(result.error)
      setLoaded(true)
    }).catch(() => { setError(bridgeError); setLoaded(true) })
    return window.granite.onDelta(delta => {
      if (delta.requestId !== run.current) return
      accumulated.current += delta.text
      const content = accumulated.current
      setMessages(current => current.map((message, index) => index === current.length - 1 && message.role === 'assistant' ? { ...message, content } : message))
    })
  }, [])
  useEffect(() => {
    const openSettings = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); setPage('settings') }
    }
    window.addEventListener('keydown', openSettings)
    return () => window.removeEventListener('keydown', openSettings)
  }, [])
  useEffect(() => { localStorage.setItem('granite.connection', selectedId) }, [selectedId])
  useEffect(() => { if (follow.current) end.current?.scrollIntoView() }, [messages, busy, page])

  async function send() {
    if (run.current || !draft.trim() || !connection) return
    const requestId = crypto.randomUUID()
    const text = draft.trim()
    const history: Message[] = [...messages.filter(message => message.content), { role: 'user', content: text }]
    run.current = requestId; accumulated.current = ''; follow.current = true
    setMessages([...history, { role: 'assistant', content: '', model: connection.model }])
    setDraft(''); setBusy(true); setStopping(false); setError('')
    try {
      const result = await window.granite.stream(requestId, connection.id, history)
      if (!result.ok) setError(result.error)
      const interrupted = !result.ok || result.value.stopped
      setMessages(current => current.flatMap((message, index) => {
        if (index !== current.length - 1 || message.role !== 'assistant') return [message]
        return accumulated.current ? [{ ...message, content: accumulated.current, interrupted }] : []
      }))
      if (!result.ok && !accumulated.current) { setMessages(history.slice(0, -1)); setDraft(text) }
    } catch { setError(bridgeError); setMessages(current => current.filter(message => message.content)) }
    finally { run.current = null; setBusy(false); setStopping(false) }
  }
  async function stop() {
    if (!run.current) return
    setStopping(true)
    try { await window.granite.stop(run.current) }
    catch { setError(bridgeError); setStopping(false) }
  }
  function updateConnections(next: SavedConnection[]) {
    setConnections(next)
    if (!next.some(item => item.id === selectedId)) setSelectedId(next[0]?.id ?? '')
  }

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span className="mark">G</span> Granite</div>
      <span className="section-label">YOUR WORKSPACE</span>
      <button className={`nav-item ${page === 'chat' ? 'active' : ''}`} onClick={() => setPage('chat')}><span>◈</span> Conversation {busy && <span className="live-dot" />}</button>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}><span aria-hidden="true">⚙</span> Settings</button><div className="sidebar-footer"><span className="status-dot" /> Running locally</div></div>
    </aside>
    {page === 'settings' ? <Settings connections={connections} onChange={updateConnections} onBack={() => setPage('chat')} /> :
      <main className="chat-main">
        <header><div className="header-title"><span>Conversation</span><span className="header-divider" /><select aria-label="Active connection" value={connection?.id ?? ''} disabled={busy || !loaded} onChange={event => setSelectedId(event.target.value)}><option value="" disabled>{loaded ? 'Choose connection' : 'Loading…'}</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></div><button className="quiet-button" disabled={busy} onClick={() => { setMessages([]); setError(''); setDraft('') }}>New chat</button></header>
        <section className="messages" ref={viewport} onScroll={() => { const el = viewport.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }} aria-label="Conversation" aria-busy={busy}>
          {!messages.length && <div className="empty-chat"><div className="empty-icon">◈</div><div className="eyebrow">YOUR WORKSPACE, YOUR MODELS</div><h1>What’s on your mind?</h1><p>{connection ? `You're ready to chat with ${connection.name}.` : 'Add a connection to start your first conversation.'}</p>{!connection && loaded && <button onClick={() => setPage('settings')}>Connect a model <span aria-hidden="true">↗</span></button>}</div>}
          {messages.map((message, index) => <article className={`message ${message.role}`} key={index}><span className="message-role">{message.role === 'user' ? 'You' : message.model ?? 'Assistant'}</span><div>{message.content || <span className="thinking">Thinking<span className="animated-dots">…</span></span>}</div>{message.interrupted && <span className="interrupted">Reply interrupted</span>}</article>)}
          <div ref={end} />
        </section>
        <div className="composer-area">
          {error && <div className="error" role="alert">{error}<button className="dismiss" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
          <form className={`composer ${busy ? 'generating' : ''}`} onSubmit={event => { event.preventDefault(); void send() }}>
            <textarea aria-label="Message" value={draft} disabled={!connection || !loaded} placeholder={connection ? 'Message your model…' : 'Add a connection in Settings to begin'} rows={3} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) void send() } }} />
            <div><span>{busy ? 'Generating a response' : 'Enter to send · Shift + Enter for a new line'}</span>{busy ? <button type="button" className="stop-button" disabled={stopping} onClick={() => void stop()}><span aria-hidden="true">■</span> {stopping ? 'Stopping…' : 'Stop'}</button> : <button type="submit" disabled={!draft.trim() || !connection}>Send ↗</button>}</div>
          </form>
          <p className="composer-note">{connection ? `Sent to ${connection.name}. ` : ''}Conversations are not saved yet.</p>
        </div>
      </main>}
  </div>
}

function Settings({ connections, onChange, onBack }: { connections: SavedConnection[]; onChange: (next: SavedConnection[]) => void; onBack: () => void }) {
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

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
