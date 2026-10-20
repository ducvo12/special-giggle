import { useEffect, useState } from 'react'
import Settings from '../features/connections/Settings'
import Workspace from '../features/workspace/Workspace'
import AgentSettings from '../features/agents/AgentSettings'
import ChatView from '../features/chat/ChatView'
import Sidebar from './Sidebar'
import HarnessSettings from '../features/harness/HarnessSettings'
import ApprovalPrompt from '../features/harness/ApprovalPrompt'
import type { Page } from './navigation'
import { useAgentSession } from './useAgentSession'

export default function App() {
  const [page, setPage] = useState<Page>('chat')
  const [settingsVisit, setSettingsVisit] = useState(0)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [identityDirty, setIdentityDirty] = useState(false)
  const {
    agents,
    managingAgents,
    agentId,
    agent,
    connections,
    setConnections,
    selectedId,
    setSelectedId,
    connection,
    modelSelection,
    conversations,
    conversationId,
    loaded,
    messages,
    draft,
    setDraft,
    busy,
    stopping,
    approval,
    approve,
    activity,
    elapsed,
    error,
    setError,
    end,
    follow,
    loadConversation,
    selectAgent,
    send,
    stop,
    deleteAgent,
    newChat,
    addAgent
  } = useAgentSession()

  useEffect(() => {
    const openSettings = (event: KeyboardEvent) => {
      if (!identityDirty && (event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setPage('settings')
      }
    }
    window.addEventListener('keydown', openSettings)

    return () => window.removeEventListener('keydown', openSettings)
  }, [identityDirty])

  useEffect(() => {
    if (follow.current) {
      end.current?.scrollIntoView()
    }
  }, [messages, busy, page])

  return (
    <div className="app">
      <header className={`app-header ${window.granite.platform === 'darwin' ? 'app-header-mac' : ''}`}>
        <button
          className="sidebar-toggle quiet-button"
          aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          aria-expanded={sidebarVisible}
          aria-controls="app-sidebar"
          onClick={() => setSidebarVisible(visible => !visible)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
        <button
          className="home-button"
          aria-label="Granite home"
          title={identityDirty ? 'Save or discard your changes to return home' : 'Home'}
          disabled={identityDirty || busy || !loaded || managingAgents}
          onClick={() => {
            newChat()
            setPage('chat')
          }}
        >
          Granite
        </button>
      </header>

      <div className="app-body">
        {sidebarVisible && (
          <Sidebar
          page={page}
          agents={agents}
          agentId={agentId}
          agent={agent}
          busy={busy}
          loaded={loaded && !managingAgents}
          identityDirty={identityDirty}
          conversations={conversations}
          conversationId={conversationId}
          onSelectAgent={id => void selectAgent(id)}
          onNewChat={() => {
            newChat()
            setPage('chat')
          }}
          onDeleteAgent={async id => {
            const deleted = await deleteAgent(id)

            if (!deleted || id === agentId) {
              setPage('chat')
            }

            return deleted
          }}
          onSelectConversation={id => {
            setPage('chat')
            setError('')
            void loadConversation(id)
          }}
          onPageChange={next => {
            if (next === 'settings') {
              setSettingsVisit(visit => visit + 1)
            }
            setPage(next)
          }}
          />
        )}

        {page === 'settings' ? (
          <Settings
            key={settingsVisit}
            connections={connections}
            onChange={next => {
              setConnections(next)

              if (!next.some(c => c.id === selectedId)) {
                setSelectedId(next[0]?.id ?? '')
              }
            }}
          />
        ) : page === 'create-agent' || (page === 'identity' && agent) ? (
          <AgentSettings
            key={`${page}:${agent?.id ?? 'new'}`}
            agent={agent}
            creating={page === 'create-agent'}
            busy={busy}
            onDirty={setIdentityDirty}
            onBack={() => setPage('chat')}
            onCreated={async created => {
              await addAgent(created)
              setPage('identity')
            }}
          />
        ) : page === 'tools' && agent ? (
          <HarnessSettings
            key={agent.id}
            agent={agent}
            busy={busy}
            onDirty={setIdentityDirty}
            onBack={() => {
              setIdentityDirty(false)
              setPage('chat')
            }}
          />
        ) : page === 'workspace' && agent ? (
          <Workspace key={agent.id} agent={agent} busy={busy} />
        ) : (
          <ChatView
            agent={agent}
            connections={connections}
            connection={connection}
            modelSelection={modelSelection}
            busy={busy}
            loaded={loaded && !managingAgents}
            identityDirty={identityDirty}
            messages={messages}
            activity={activity}
            end={end}
            follow={follow}
            error={error}
            draft={draft}
            elapsed={elapsed}
            stopping={stopping}
            onSelectConnection={setSelectedId}
            onOpenSettings={() => setPage('settings')}
            onCreateAgent={() => setPage('create-agent')}
            onDismissError={() => setError('')}
            onDraftChange={setDraft}
            onSend={send}
            onStop={stop}
          />
        )}

      </div>

      {approval && (
        <ApprovalPrompt key={approval.id} request={approval} onAnswer={approve} onStop={stop} />
      )}
    </div>
  )
}
