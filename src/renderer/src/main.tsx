import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { SavedConnection, StreamActivity } from '../../shared/chat'
import type { AgentMessage, Conversation, WorkspaceEntry } from '../../shared/agent'
import Settings from './Settings'
import './styles.css'

const bridgeError = 'Could not communicate with the desktop backend.'
function App() {
  const [page, setPage] = useState<'chat' | 'settings' | 'workspace'>('chat')
  const [connections, setConnections] = useState<SavedConnection[]>([])
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem('granite.connection') ?? '')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationId, setConversationId] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [activity, setActivity] = useState<StreamActivity>({ reasoningCharacters: 0, answerCharacters: 0 })
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const run = useRef<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const connection = connections.find(item => item.id === selectedId)

  async function loadConversation(id: string) {
    const result = await window.granite.conversations.get(id)
    if (!result.ok) { setError(result.error); return }
    setConversationId(id); setMessages(result.value.messages)
  }
  async function refreshList() {
    const result = await window.granite.conversations.list()
    if (result.ok) setConversations(result.value)
    else setError(result.error)
  }
  useEffect(() => {
    let mounted = true
    void Promise.all([window.granite.connections.list(), window.granite.conversations.list()]).then(async ([connections, chats]) => {
      if (!mounted) return
      if (connections.ok) {
        setConnections(connections.value)
        setSelectedId(current => connections.value.some(item => item.id === current) ? current : connections.value[0]?.id ?? '')
      } else setError(connections.error)
      if (chats.ok) {
        setConversations(chats.value)
        const saved = localStorage.getItem('granite.conversation')
        const id = chats.value.find(chat => chat.id === saved)?.id ?? chats.value[0]?.id
        if (id) await loadConversation(id)
      } else setError(chats.error)
      if (mounted) setLoaded(true)
    }).catch(() => { if (mounted) { setError(bridgeError); setLoaded(true) } })
    const off = window.granite.onDelta(delta => {
      if (delta.requestId !== run.current) return
      if (delta.activity) setActivity(delta.activity)
      setMessages(current => current.map((message, index) => {
        if (index !== current.length - 1 || message.role !== 'assistant') return message
        const tools = delta.tool ? [...(message.tools ?? []).filter(t => t.id !== delta.tool!.id), delta.tool] : message.tools
        return { ...message, content: message.content + delta.text, tools }
      }))
    })
    return () => { mounted = false; off() }
  }, [])
  useEffect(() => {
    const openSettings = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); setPage('settings') } }
    window.addEventListener('keydown', openSettings)
    return () => window.removeEventListener('keydown', openSettings)
  }, [])
  useEffect(() => {
    if (!busy) return
    const started = Date.now(); setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])
  useEffect(() => { localStorage.setItem('granite.connection', selectedId) }, [selectedId])
  useEffect(() => { if (conversationId) localStorage.setItem('granite.conversation', conversationId) }, [conversationId])
  useEffect(() => { if (follow.current) end.current?.scrollIntoView() }, [messages, busy, page])

  async function send() {
    if (run.current || !draft.trim() || !connection) return
    const requestId = crypto.randomUUID(), text = draft.trim()
    run.current = requestId; follow.current = true
    setBusy(true); setStopping(false); setError(''); setDraft('')
    setActivity({ reasoningCharacters: 0, answerCharacters: 0 })
    let id = conversationId
    try {
      if (!id) {
        const created = await window.granite.conversations.create()
        if (!created.ok) throw new Error(created.error)
        id = created.value.id; setConversationId(id)
      }
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', content: text }, { id: requestId, role: 'assistant', content: '', model: connection.model, tools: [], status: 'running' }])
      const result = await window.granite.stream(requestId, id, connection.id, text)
      if (!result.ok) setError(result.error)
      await loadConversation(id); await refreshList()
    } catch (error) { setError(error instanceof Error ? error.message : bridgeError); setDraft(text) }
    finally { run.current = null; setBusy(false); setStopping(false) }
  }
  async function stop() {
    if (!run.current) return
    setStopping(true)
    try { await window.granite.stop(run.current) } catch { setError(bridgeError); setStopping(false) }
  }
  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span className="mark">G</span> Granite</div>
      <span className="section-label">ATLAS</span>
      <button className={`nav-item ${page === 'chat' ? 'active' : ''}`} onClick={() => setPage('chat')}><span>◈</span> Conversations {busy && <span className="live-dot" />}</button>
      <button className={`nav-item ${page === 'workspace' ? 'active' : ''}`} onClick={() => setPage('workspace')}><span>▧</span> Workspace</button>
      <div className="conversation-list">{conversations.map(chat => <button key={chat.id} title={chat.title} disabled={busy || !loaded} className={conversationId === chat.id ? 'selected' : ''} onClick={() => { setPage('chat'); setError(''); void loadConversation(chat.id) }}>{chat.title}</button>)}</div>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}><span>⚙</span> Settings</button><div className="sidebar-footer"><span className="status-dot" /> Saved on this device</div></div>
    </aside>
    {page === 'settings' ? <Settings connections={connections} onChange={next => { setConnections(next); if (!next.some(c => c.id === selectedId)) setSelectedId(next[0]?.id ?? '') }} onBack={() => setPage('chat')} /> : page === 'workspace' ? <Workspace busy={busy} /> :
      <main className="chat-main">
        <header><div className="header-title"><span>Atlas</span><span className="header-divider" /><select aria-label="Active connection" value={connection?.id ?? ''} disabled={busy || !loaded} onChange={event => setSelectedId(event.target.value)}><option value="" disabled>{loaded ? 'Choose connection' : 'Loading…'}</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></div><button className="quiet-button" disabled={busy || !loaded} onClick={() => { setConversationId(''); setMessages([]); setError(''); setDraft('') }}>New chat</button></header>
        <section className="messages" onScroll={event => { const el = event.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }} aria-label="Conversation" aria-busy={busy}>
          {!messages.length && <div className="empty-chat"><div className="empty-icon">◈</div><div className="eyebrow">MEET ATLAS</div><h1>A little continuity.</h1><p>{connection ? 'An assistant with a workspace, notes, and a memory of what matters to you.' : 'Add a connection to start your first conversation.'}</p>{!connection && loaded && <button onClick={() => setPage('settings')}>Connect a model ↗</button>}</div>}
          {messages.map(message => <article className={`message ${message.role}`} key={message.id}>
            <span className="message-role">{message.role === 'user' ? 'You' : `Atlas · ${message.model ?? ''}`}</span>
            {!!message.tools?.length && <div className="tool-activity" aria-label="Tool activity">{message.tools.map(tool => <details key={tool.id}><summary><span className={`tool-state ${tool.status}`} />{tool.name}<span>{tool.status}</span></summary><pre>{tool.input}{tool.output ? `\n\n${tool.output}` : ''}</pre></details>)}</div>}
            <div>{message.content || (message.status === 'running' ? <span className="thinking">{activity.reasoningCharacters ? 'Model is reasoning' : 'Atlas is working'}<span className="animated-dots">…</span></span> : message.notice ? null : <span className="interrupted">No answer received</span>)}</div>
            {message.notice && <span className="interrupted">{message.notice}</span>}
            {message.interrupted && <span className="interrupted">{message.status === 'error' ? message.error : 'Reply interrupted · completed file changes are kept'}</span>}
          </article>)}<div ref={end} />
        </section>
        <div className="composer-area">
          {error && <div className="error" role="alert">{error}<button className="dismiss" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
          <form className={`composer ${busy ? 'generating' : ''}`} onSubmit={event => { event.preventDefault(); void send() }}>
            <textarea aria-label="Message" value={draft} disabled={!connection || !loaded} placeholder={connection ? 'Message Atlas…' : 'Add a connection in Settings to begin'} rows={3} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) void send() } }} />
            <div><span>{busy ? `Atlas is working · ${elapsed}s${activity.reasoningCharacters ? ` · ${activity.reasoningCharacters.toLocaleString()} reasoning characters` : ''}` : 'Enter to send · Shift + Enter for a new line'}</span>{busy ? <button type="button" className="stop-button" disabled={stopping} onClick={() => void stop()}>■ {stopping ? 'Stopping…' : 'Stop'}</button> : <button type="submit" disabled={!draft.trim() || !connection || !loaded}>Send ↗</button>}</div>
          </form>
          <p className="composer-note">{connection ? `Inference: ${connection.name}. ` : ''}Notes, memory, and conversations are saved locally.</p>
        </div>
      </main>}
  </div>
}

function Workspace({ busy }: { busy: boolean }) {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [file, setFile] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const request = useRef(0)
  async function list(next = path) {
    const result = await window.granite.workspace.entries(next)
    if (result.ok) { setPath(next); setEntries(result.value); setError('') } else setError(result.error)
  }
  async function read(next: string) {
    const token = ++request.current
    const result = await window.granite.workspace.read(next)
    if (token !== request.current) return
    if (result.ok) { setFile(next); setText(result.value); setError('') } else setError(result.error)
  }
  useEffect(() => { void list(); void read('/identity.md') }, [])
  return <main className="settings-main"><header><span>Atlas / Workspace</span><button className="quiet-button" onClick={() => { void list(); if (file) void read(file) }}>Refresh</button></header><div className="workspace-intro"><p>Atlas can read and edit files here. Identity is read-only to the agent. {busy ? 'Atlas is working; refresh to see its latest changes.' : 'Ask Atlas to save a note or remember a preference.'}</p></div><div className="workspace-browser"><nav aria-label="Workspace files"><div className="workspace-path">{path}</div>{path !== '/' && <button onClick={() => void list(path.replace(/[^/]+\/$/, '') || '/')}>↑ Parent folder</button>}{entries.map(entry => <button key={entry.path} className={file === entry.path ? 'selected' : ''} onClick={() => entry.directory ? void list(entry.path) : void read(entry.path)}>{entry.directory ? '▸' : '·'} {entry.path.split('/').filter(Boolean).at(-1)}</button>)}</nav><section className="file-preview">{error && <div className="error" role="alert">{error}</div>}<h2>{file}</h2><pre>{text}</pre></section></div></main>
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
