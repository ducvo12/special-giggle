import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { SavedConnection, StreamActivity } from '../../shared/chat'
import type { Agent, AgentMessage, Conversation } from '../../shared/agent'
import Settings from './Settings'
import Workspace from './Workspace'
import AgentSettings from './AgentSettings'
import './styles.css'

const bridgeError = 'Could not communicate with the desktop backend.'
function App() {
  const [page, setPage] = useState<'chat' | 'settings' | 'workspace' | 'identity' | 'create-agent'>('chat')
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState('')
  const [identityDirty, setIdentityDirty] = useState(false)
  const selection = useRef(0)
  const currentAgent = useRef('')
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

  const agent = agents.find(agent => agent.id === agentId)
  async function loadConversation(id: string, owner = agentId) {
    const result = await window.granite.conversations.get(owner, id)
    if (currentAgent.current !== owner) return
    if (!result.ok) { setError(result.error); return }
    setConversationId(id); setMessages(result.value.messages)
  }
  async function refreshList() {
    const result = await window.granite.conversations.list(agentId)
    if (result.ok) setConversations(result.value)
    else setError(result.error)
  }
  async function selectAgent(id: string) {
    if (run.current) return
    const token = ++selection.current
    currentAgent.current = id; setAgentId(id); setLoaded(false)
    setMessages([]); setConversations([]); setConversationId(''); setDraft(''); setError('')
    try {
      const chats = await window.granite.conversations.list(id)
      if (token !== selection.current) return
      if (!chats.ok) throw new Error(chats.error)
      setConversations(chats.value)
      const saved = localStorage.getItem(`granite.conversation.${id}`) ?? (id === 'atlas' ? localStorage.getItem('granite.conversation') : null)
      const chat = chats.value.find(chat => chat.id === saved) ?? chats.value[0]
      if (chat) await loadConversation(chat.id, id)
      localStorage.setItem('granite.agent', id)
    } catch (error) { if (token === selection.current) setError(error instanceof Error ? error.message : bridgeError) }
    finally { if (token === selection.current) setLoaded(true) }
  }
  useEffect(() => {
    let mounted = true
    void Promise.all([window.granite.connections.list(), window.granite.agents.list()]).then(async ([connections, agents]) => {
      if (!mounted) return
      if (connections.ok) {
        setConnections(connections.value)
        setSelectedId(current => connections.value.some(item => item.id === current) ? current : connections.value[0]?.id ?? '')
      } else setError(connections.error)
      if (!agents.ok) { setError(agents.error); setLoaded(true); return }
      setAgents(agents.value)
      const saved = localStorage.getItem('granite.agent')
      const selected = agents.value.find(agent => agent.id === saved) ?? agents.value[0]
      if (selected) await selectAgent(selected.id)
      else setLoaded(true)
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
    return () => { mounted = false; ++selection.current; off() }
  }, [])
  useEffect(() => {
    const openSettings = (event: KeyboardEvent) => { if (!identityDirty && (event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); setPage('settings') } }
    window.addEventListener('keydown', openSettings)
    return () => window.removeEventListener('keydown', openSettings)
  }, [identityDirty])
  useEffect(() => {
    if (!busy) return
    const started = Date.now(); setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])
  useEffect(() => { localStorage.setItem('granite.connection', selectedId) }, [selectedId])
  useEffect(() => { if (conversationId) localStorage.setItem(`granite.conversation.${agentId}`, conversationId) }, [conversationId, agentId])
  useEffect(() => { if (follow.current) end.current?.scrollIntoView() }, [messages, busy, page])

  async function send() {
    if (run.current || !draft.trim() || !connection || !agent || !loaded) return
    const requestId = crypto.randomUUID(), text = draft.trim()
    run.current = requestId; follow.current = true
    setBusy(true); setStopping(false); setError(''); setDraft('')
    setActivity({ reasoningCharacters: 0, answerCharacters: 0 })
    let id = conversationId
    try {
      if (!id) {
        const created = await window.granite.conversations.create(agent.id)
        if (!created.ok) throw new Error(created.error)
        id = created.value.id; setConversationId(id)
      }
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', content: text }, { id: requestId, role: 'assistant', content: '', model: connection.model, tools: [], status: 'running' }])
      const result = await window.granite.stream(requestId, agent.id, id, connection.id, text)
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
      <span className="section-label">AGENTS</span>
      <div className="agent-switcher"><select aria-label="Active agent" value={agentId} disabled={busy || !loaded || identityDirty} onChange={event => void selectAgent(event.target.value)}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button className="quiet-button" aria-label="Create agent" title="Create agent" disabled={busy || !loaded || identityDirty} onClick={() => setPage('create-agent')}>+</button></div>
      <button className={`nav-item ${page === 'chat' ? 'active' : ''}`} disabled={identityDirty} onClick={() => setPage('chat')}><span>◈</span> Conversations {busy && <span className="live-dot" />}</button>
      <button className={`nav-item ${page === 'workspace' ? 'active' : ''}`} disabled={identityDirty || !agent} onClick={() => setPage('workspace')}><span>▧</span> Workspace</button>
      <button className={`nav-item ${page === 'identity' ? 'active' : ''}`} disabled={identityDirty || !agent} onClick={() => setPage('identity')}><span>◇</span> Identity</button>
      <div className="conversation-list">{conversations.map(chat => <button key={chat.id} title={chat.title} disabled={busy || !loaded || identityDirty} className={conversationId === chat.id ? 'selected' : ''} onClick={() => { setPage('chat'); setError(''); void loadConversation(chat.id) }}>{chat.title}</button>)}</div>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} disabled={identityDirty} onClick={() => setPage('settings')}><span>⚙</span> Settings</button><div className="sidebar-footer"><span className="status-dot" /> Saved on this device</div></div>
    </aside>
    {page === 'settings' ? <Settings connections={connections} onChange={next => { setConnections(next); if (!next.some(c => c.id === selectedId)) setSelectedId(next[0]?.id ?? '') }} onBack={() => setPage('chat')} /> : (page === 'identity' || page === 'create-agent') && agent ? <AgentSettings key={`${page}:${agent.id}`} agent={agent} creating={page === 'create-agent'} busy={busy} onDirty={setIdentityDirty} onBack={() => setPage('chat')} onCreated={async created => { setAgents(current => [...current, created]); await selectAgent(created.id); setPage('identity') }} /> : page === 'workspace' && agent ? <Workspace key={agent.id} agent={agent} busy={busy} /> :
      <main className="chat-main">
        <header><div className="header-title"><span>{agent?.name ?? 'Agent'}</span><span className="header-divider" /><select aria-label="Active connection" value={connection?.id ?? ''} disabled={busy || !loaded} onChange={event => setSelectedId(event.target.value)}><option value="" disabled>{loaded ? 'Choose connection' : 'Loading…'}</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></div><button className="quiet-button" disabled={busy || !loaded} onClick={() => { setConversationId(''); setMessages([]); setError(''); setDraft('') }}>New chat</button></header>
        <section className="messages" onScroll={event => { const el = event.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }} aria-label="Conversation" aria-busy={busy}>
          {!messages.length && <div className="empty-chat"><div className="empty-icon">◈</div><div className="eyebrow">MEET {agent?.name.toUpperCase()}</div><h1>A little continuity.</h1><p>{connection ? 'An assistant with a workspace, notes, and a memory of what matters to you.' : 'Add a connection to start your first conversation.'}</p>{!connection && loaded && <button disabled={identityDirty} onClick={() => setPage('settings')}>Connect a model ↗</button>}</div>}
          {messages.map(message => <article className={`message ${message.role}`} key={message.id}>
            <span className="message-role">{message.role === 'user' ? 'You' : `${agent?.name ?? 'Agent'} · ${message.model ?? ''}`}</span>
            {!!message.tools?.length && <div className="tool-activity" aria-label="Tool activity">{message.tools.map(tool => <details key={tool.id}><summary><span className={`tool-state ${tool.status}`} />{tool.name}<span>{tool.status}</span></summary><pre>{tool.input}{tool.output ? `\n\n${tool.output}` : ''}</pre></details>)}</div>}
            <div>{message.content || (message.status === 'running' ? <span className="thinking">{activity.reasoningCharacters ? 'Model is reasoning' : `${agent?.name ?? 'Agent'} is working`}<span className="animated-dots">…</span></span> : message.notice ? null : <span className="interrupted">No answer received</span>)}</div>
            {message.notice && <span className="interrupted">{message.notice}</span>}
            {message.interrupted && <span className="interrupted">{message.status === 'error' ? message.error : 'Reply interrupted · completed file changes are kept'}</span>}
          </article>)}<div ref={end} />
        </section>
        <div className="composer-area">
          {error && <div className="error" role="alert">{error}<button className="dismiss" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
          <form className={`composer ${busy ? 'generating' : ''}`} onSubmit={event => { event.preventDefault(); void send() }}>
            <textarea aria-label="Message" value={draft} disabled={!connection || !agent || !loaded} placeholder={connection ? `Message ${agent?.name ?? 'your agent'}…` : 'Add a connection in Settings to begin'} rows={3} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) void send() } }} />
            <div><span>{busy ? `${agent?.name ?? 'Agent'} is working · ${elapsed}s${activity.reasoningCharacters ? ` · ${activity.reasoningCharacters.toLocaleString()} reasoning characters` : ''}` : 'Enter to send · Shift + Enter for a new line'}</span>{busy ? <button type="button" className="stop-button" disabled={stopping} onClick={() => void stop()}>■ {stopping ? 'Stopping…' : 'Stop'}</button> : <button type="submit" disabled={!draft.trim() || !connection || !agent || !loaded}>Send ↗</button>}</div>
          </form>
          <p className="composer-note">{connection ? `Inference: ${connection.name}. ` : ''}Notes, memory, and conversations are saved locally.</p>
        </div>
      </main>}
  </div>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
