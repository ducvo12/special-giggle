import { toggleDevTimings, useDevTimings } from '../features/chat/devTimings'
import { useEffect, useRef, useState } from 'react'
import Settings from '../features/connections/Settings'
import FileView from '../features/workspace/FileView'
import CreateAgent from '../features/agents/CreateAgent'
import ChatView from '../features/chat/ChatView'
import Sidebar from './Sidebar'
import HarnessSettings from '../features/harness/HarnessSettings'
import type { Page } from './navigation'
import { useAgentSession } from './useAgentSession'
import TreeDialog, { type TreeDialogAction } from '../features/organization/TreeDialog'

export default function App() {
  const devTimings = useDevTimings()
  const [page, setPage] = useState<Page>('chat')
  const [newChatFocus, setNewChatFocus] = useState(0)
  const messageInput = useRef<HTMLTextAreaElement>(null)
  const [settingsVisit, setSettingsVisit] = useState(0)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [identityDirty, setIdentityDirty] = useState(false)
  const [selectedFile, setSelectedFile] = useState('/identity.md')
  const [fileRevision, setFileRevision] = useState(0)
  const [dialog, setDialog] = useState<TreeDialogAction | null>(null)
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
    organization,
    location,
    runUnavailable,
    selectLocation,
    changeOrganization,
    moveConversation,
    conversationId,
    loaded,
    messages,
    draft,
    setDraft,
    busy,
    viewRun,
    runs,
    submitting,
    recovery,
    dismissRecovery,
    continueRun,
    runPending,
    cancelPending,
    viewBusy,
    activeConversationId,
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
    deleteConversation,
    renameConversation,
    newChat,
    addAgent
  } = useAgentSession()

  useEffect(() => {
    const openSettings = (event: KeyboardEvent) => {
      if (!identityDirty && !dialog && (event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setPage('settings')
      }
    }
    window.addEventListener('keydown', openSettings)

    return () => window.removeEventListener('keydown', openSettings)
  }, [identityDirty, dialog])

  useEffect(() => {
    if (follow.current) {
      end.current?.scrollIntoView()
    }
  }, [messages, busy, page])

  function openNewChat() {
    newChat()
    setNewChatFocus(value => value + 1)
    setPage('chat')
  }

  useEffect(() => {
    if (newChatFocus) messageInput.current?.focus()
  }, [newChatFocus])

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
          disabled={identityDirty || Boolean(dialog) || !loaded || managingAgents}
          onClick={openNewChat}
        >
          Granite
        </button>
        <button type="button" role="switch" aria-checked={devTimings.enabled}
          className="quiet-button dev-timing-switch" onClick={toggleDevTimings}
          title="Temporary response timings, kept in memory until the app reloads">
          Dev timings {devTimings.enabled ? 'on' : 'off'}
        </button>
      </header>

      <div className="app-body">
        {sidebarVisible && (
          <Sidebar
          key={agentId}
          page={page}
          agents={agents}
          agentId={agentId}
          agent={agent}
          busy={busy}
          runs={runs}
          loaded={loaded && !managingAgents}
          identityDirty={identityDirty || Boolean(dialog)}
          selectedFile={selectedFile}
          fileRevision={fileRevision}
          onOpenFile={path => { setSelectedFile(path); setPage('file') }}
          onDialog={setDialog}
          onRefreshFiles={() => setFileRevision(value => value + 1)}
          conversations={conversations}
          organization={organization}
          location={location}
          onSelectLocation={next => { selectLocation(next); setPage('chat') }}
          onMoveConversation={moveConversation}
          conversationId={conversationId}
          onRenameConversation={renameConversation}
          onDeleteConversation={deleteConversation}
          onSelectAgent={id => { setPage('chat'); void selectAgent(id) }}
          onNewChat={openNewChat}
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
        ) : page === 'create-agent' ? (
          <CreateAgent
            busy={managingAgents}
            onDirty={setIdentityDirty}
            onBack={() => setPage('chat')}
            onCreated={async created => {
              await addAgent(created)
              setSelectedFile('/identity.md')
              setPage('file')
            }}
          />
        ) : page === 'tools' && agent ? (
          <HarnessSettings
            key={agent.id}
            agent={agent}
            busy={false}
            onDirty={setIdentityDirty}
            onBack={() => {
              setIdentityDirty(false)
              setPage('chat')
            }}
          />
        ) : page === 'file' && agent ? (
          <FileView key={`${agent.id}:${selectedFile}:${fileRevision}`} agent={agent} path={selectedFile}
            busy={busy || managingAgents} onDirty={setIdentityDirty} onSaved={() => setFileRevision(value => value + 1)} />
        ) : (
          <ChatView
            conversationId={conversationId}
            conversationTitle={conversations.find(chat => chat.id === conversationId)?.title}
            section={organization.sections.find(section => section.id === location.sectionId)}
            project={organization.projects.find(project => project.id === location.projectId)}
            messageInput={messageInput}
            agent={agent}
            connections={connections}
            connection={connection}
            modelSelection={modelSelection}
            busy={viewBusy}
            run={viewRun}
            submitting={submitting}
            onEnterProject={async projectId => {
              const target = organization.projects.find(project => project.id === projectId)
              return target ? moveConversation(conversationId, { sectionId: target.sectionId, projectId: target.id }) : false
            }}
            onContinue={continueRun}
            onRunPending={runPending}
            onCancelPending={cancelPending}
            approval={approval}
            onApprove={approve}
            requestPending={false}
            onOpenActiveChat={() => {
              setPage('chat')
              if (activeConversationId) void loadConversation(activeConversationId)
            }}
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
            runUnavailable={runUnavailable}
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

      {dialog && agent && <TreeDialog action={dialog} agent={agent} organization={organization}
        disabled={managingAgents || !loaded} onChange={changeOrganization} onClose={() => setDialog(null)}
        onProjectCreated={project => {
          selectLocation({ sectionId: project.sectionId, projectId: project.id })
          setPage('chat')
          setNewChatFocus(value => value + 1)
        }}
        onNoteCreated={path => { setFileRevision(value => value + 1); setSelectedFile(path); setPage('file') }}
        onNoteRenamed={(previous, next) => {
          setFileRevision(value => value + 1)
          setSelectedFile(path => path === previous ? next : path)
        }} />}

      {recovery && <div className="modal-backdrop">
        <section className="recovery-dialog" role="alertdialog" aria-modal="true" aria-labelledby="recovery-title">
          <h2 id="recovery-title">Granite closed before work finished</h2>
          <p>{recovery.active} interrupted run{recovery.active === 1 ? '' : 's'} stopped. Completed changes are kept.</p>
          {recovery.pending > 0 && <p>{recovery.pending} queued request{recovery.pending === 1 ? '' : 's'} did not start. Their messages are saved; use Run pending messages in each chat when ready.</p>}
          {Boolean(recovery.repositories) && <p>{recovery.repositories} repository outcome{recovery.repositories === 1 ? '' : 's'} need review. Open the affected chat’s repository changes; dismissing this notice does not unlock its writes.</p>}
          <p>Dismissing this notice will not restart any work.</p>
          <button onClick={() => void dismissRecovery()}>OK</button>
        </section>
      </div>}
    </div>
  )
}
