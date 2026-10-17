import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { Connection, Message } from '../../shared/chat'
import './styles.css'

function App() {
  const [connection, setConnection] = useState<Connection>({ baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', model: '' })
  const [models, setModels] = useState<string[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Not tested')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  function update(key: keyof Connection, value: string) {
    setConnection(previous => ({ ...previous, [key]: value }))
    setStatus('Not tested')
    setError('')
    if (key !== 'model') setModels([])
  }

  async function connect() {
    setConnecting(true); setError(''); setStatus('Checking…')
    try {
      const result = await window.granite.models(connection)
      if (!result.ok) { setError(result.error); setStatus('Connection failed'); return }
      setModels(result.value)
      if (!connection.model || !result.value.includes(connection.model)) {
        setConnection(previous => ({ ...previous, model: result.value[0] ?? previous.model }))
      }
      setStatus(result.value.length ? `${result.value.length} model${result.value.length === 1 ? '' : 's'} available` : 'Connected · no models listed')
    } catch { setError('Could not communicate with the desktop backend.'); setStatus('Connection failed') }
    finally { setConnecting(false) }
  }

  async function send() {
    if (busy || !draft.trim() || !connection.model.trim()) return
    const text = draft.trim()
    const history: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(history); setDraft(''); setBusy(true); setError('')
    try {
      const result = await window.granite.chat(connection, history)
      if (result.ok) setMessages([...history, { role: 'assistant', content: result.value }])
      else { setMessages(history.slice(0, -1)); setDraft(text); setError(result.error) }
    } catch { setMessages(history.slice(0, -1)); setDraft(text); setError('Could not communicate with the desktop backend.') }
    finally { setBusy(false) }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="mark">G</span> Granite</div>
        <span className="section-label">YOUR WORKSPACE</span>
        <div className="nav-item"><span>◈</span> Conversation</div>
        <div className="sidebar-footer"><span className="status-dot" /> Running locally</div>
      </aside>
      <main className="chat-main">
        <header><span>Conversation</span><button className="quiet-button" disabled={busy || connecting} onClick={() => { setMessages([]); setError(''); setDraft('') }}>New chat</button></header>
        <section className="connection" aria-label="Model connection">
          <div className="connection-heading"><h2>Connect a model</h2><span role="status">{status}</span></div>
          <fieldset disabled={busy || connecting}>
            <label className="endpoint">API base URL<input type="url" value={connection.baseUrl} onChange={event => update('baseUrl', event.target.value)} placeholder="http://desktop-ip:1234/v1" /></label>
            <label>API key · optional<input type="password" autoComplete="off" value={connection.apiKey} onChange={event => update('apiKey', event.target.value)} placeholder="Only if your server requires one" /></label>
            <label>Model ID<input list="models" value={connection.model} onChange={event => update('model', event.target.value)} placeholder="Load models or enter an ID" /><datalist id="models">{models.map(model => <option key={model} value={model} />)}</datalist></label>
          </fieldset>
          <div className="connection-bottom"><p>OpenAI-compatible API. For desktop LM Studio, use its network address instead of localhost. Keys stay in memory.</p><button disabled={busy || connecting || !connection.baseUrl.trim()} onClick={connect}>{connecting ? 'Checking…' : 'Load models'}</button></div>
        </section>
        <section className="messages" aria-label="Conversation" aria-busy={busy}>
          {messages.length === 0 && <div className="empty-chat"><div className="eyebrow">YOUR FIRST CONVERSATION</div><h1>What’s on your mind?</h1><p>Connect a model above, then send a message.<br />This chat stays open until you close the app or start a new one.</p></div>}
          {messages.map((message, index) => <article className={`message ${message.role}`} key={index}><span className="message-role">{message.role === 'user' ? 'You' : connection.model}</span><div>{message.content}</div></article>)}
          {busy && <div className="thinking" role="status">Waiting for the model…</div>}
          <div ref={end} />
        </section>
        <div className="composer-area">
          {error && <div className="error" role="alert">{error}</div>}
          <form className="composer" onSubmit={event => { event.preventDefault(); void send() }}>
            <textarea aria-label="Message" value={draft} disabled={busy} placeholder="Message your model…" rows={3} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
            <div><span>Enter to send · Shift + Enter for a new line</span><button type="submit" disabled={busy || connecting || !draft.trim() || !connection.model.trim()}>{busy ? 'Waiting…' : 'Send ↗'}</button></div>
          </form>
          <p className="composer-note">Messages are sent to the API address above. Connection settings and chat are not saved yet.</p>
        </div>
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
