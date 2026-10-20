import { useEffect, useState } from 'react'
import Settings from '../features/connections/Settings'
import Workspace from '../features/workspace/Workspace'
import AgentSettings from '../features/agents/AgentSettings'
import ChatView from '../features/chat/ChatView'
import Sidebar from './Sidebar'
import type { Page } from './navigation'
import { useAgentSession } from './useAgentSession'

export default function App() {
  const [page, setPage] = useState<Page>('chat')
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
    conversations,
    conversationId,
    loaded,
    messages,
    draft,
    setDraft,
    busy,
    stopping,
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
        onPageChange={setPage}
      />

      {page === 'settings' ? (
        <Settings
          connections={connections}
          onChange={next => {
            setConnections(next)

            if (!next.some(c => c.id === selectedId)) {
              setSelectedId(next[0]?.id ?? '')
            }
          }}
          onBack={() => setPage('chat')}
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
      ) : page === 'workspace' && agent ? (
        <Workspace key={agent.id} agent={agent} busy={busy} />
      ) : (
        <ChatView
          agent={agent}
          connections={connections}
          connection={connection}
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
          onNewChat={newChat}
          onOpenSettings={() => setPage('settings')}
          onCreateAgent={() => setPage('create-agent')}
          onDismissError={() => setError('')}
          onDraftChange={setDraft}
          onSend={send}
          onStop={stop}
        />
      )}
    </div>
  )
}
