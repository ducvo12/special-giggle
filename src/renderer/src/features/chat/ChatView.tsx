import { latestContextResponse } from './context-display'
import ContextIndicator from './ContextIndicator'
import { useState, type RefObject } from 'react'
import ActivityPanel from './ActivityPanel'
import type { ChatAttachment } from './attachments'
import type { Agent, AgentMessage } from '../../../../shared/agent'
import type { SavedConnection, StreamActivity } from '../../../../shared/chat'
import MessageList from './MessageList'
import ChatModelPicker from './ChatModelPicker'
import type { ModelSelection } from './useConnectionModel'
import type { Project, Section } from '../../../../shared/organization'
import type { RunSnapshot } from '../../../../shared/run'
import RunControls, { runLabel } from './RunControls'
import QuestionPrompt from './QuestionPrompt'
import ProjectEntryPrompt from './ProjectEntryPrompt'
import ApprovalPrompt from '../harness/ApprovalPrompt'
import type { ApprovalRequest } from '../../../../shared/harness'

type Props = {
  conversationId: string
  conversationTitle?: string
  section?: Section
  project?: Project
  messageInput: RefObject<HTMLTextAreaElement | null>
  agent: Agent | undefined
  connections: SavedConnection[]
  connection: SavedConnection | undefined
  modelSelection: ModelSelection
  busy: boolean
  run?: RunSnapshot
  submitting: boolean
  onEnterProject: (projectId: string) => Promise<boolean>
  onContinue: () => Promise<void>
  onRunPending: () => Promise<void>
  onCancelPending: () => Promise<void>
  approval: ApprovalRequest | null
  onAnswerQuestion: (answers: string[]) => Promise<boolean>
  onRejectQuestion: () => Promise<boolean>
  onApprove: (allow: boolean) => Promise<void>
  requestPending: boolean
  onOpenActiveChat: () => void
  loaded: boolean
  identityDirty: boolean
  messages: AgentMessage[]
  activity: StreamActivity
  end: RefObject<HTMLDivElement | null>
  follow: RefObject<boolean>
  error: string
  draft: string
  attachments: ChatAttachment[]
  onAttachmentsChange: (files: ChatAttachment[]) => void
  elapsed: number
  stopping: boolean
  runUnavailable?: string
  onSelectConnection: (id: string) => void
  onOpenSettings: () => void
  onCreateAgent: () => void
  onDismissError: () => void
  onDraftChange: (draft: string) => void
  onSend: () => Promise<void>
  onStop: () => Promise<void>
}

export default function ChatView({
  conversationId,
  conversationTitle,
  section,
  project,
  messageInput,
  agent,
  connections,
  connection,
  modelSelection,
  busy,
  run,
  submitting,
  onEnterProject,
  onContinue,
  onRunPending,
  onCancelPending,
  approval,
  onApprove,
  onAnswerQuestion,
  onRejectQuestion,
  requestPending,
  onOpenActiveChat,
  loaded,
  identityDirty,
  messages,
  activity,
  end,
  follow,
  error,
  draft,
  attachments,
  onAttachmentsChange,
  elapsed,
  stopping,
  runUnavailable,
  onSelectConnection,
  onOpenSettings,
  onCreateAgent,
  onDismissError,
  onDraftChange,
  onSend,
  onStop
}: Props) {
  const [panelOpen, setPanelOpen] = useState(true)
  const contextResponse = latestContextResponse(messages, modelSelection.model)
  const reasoningProgress = activity.reasoningCharacters
    ? ` · ${activity.reasoningCharacters.toLocaleString()} reasoning characters`
    : ''
  const progress = `${run ? runLabel(run) : 'Preparing reply'} · ${elapsed}s${reasoningProgress}`

  return (
    <div className="chat-workspace">
      {section && (
        <header className="chat-heading">
          <nav className="chat-breadcrumb" aria-label="Chat location">
            <ol>
              <li title={section.name}>{section.name}</li>
              {project && <li title={project.name}>{project.name}</li>}
              <li aria-current="page" title={conversationTitle}>{conversationId ? conversationTitle ?? 'Chat' : 'New chat'}</li>
            </ol>
          </nav>
          <span className="chat-heading-status">{conversationId ? section.mode === 'closed' ? 'Closed' : 'Shared' : 'Unsaved draft'}</span>
          <button className="quiet-button activity-toggle" aria-label={panelOpen ? 'Hide chat details' : 'Show chat details'} title={panelOpen ? 'Hide chat details' : 'Show chat details'}
            aria-expanded={panelOpen} aria-controls="chat-activity-panel" onClick={() => setPanelOpen(open => !open)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>
            {attachments.length > 0 && <span>{attachments.length}</span>}
          </button>
        </header>
      )}
      <div className="chat-workspace-body">
        <main className="chat-main">
          <MessageList
            key={conversationId || 'new-chat'}
            agent={agent}
            conversationId={conversationId}
            busy={busy}
            loaded={loaded}
            identityDirty={identityDirty}
            messages={messages}
            activity={activity}
            end={end}
            follow={follow}
            onCreateAgent={onCreateAgent}
          />

          <div className="composer-area">
            <ProjectEntryPrompt key={conversationId} run={run} currentProject={project?.id} onMove={onEnterProject} />
            <RunControls run={run} messages={messages} disabled={submitting || !loaded || Boolean(runUnavailable)}
              onContinue={onContinue} onRunPending={onRunPending} onCancelPending={onCancelPending} />
            {run?.question && <QuestionPrompt key={run.question.id} question={run.question} onAnswer={onAnswerQuestion} onReject={onRejectQuestion} />}
            {approval && <ApprovalPrompt key={approval.id} request={approval} onAnswer={onApprove} />}
            {runUnavailable && <p className="organization-notice" role="status">{runUnavailable}</p>}
            {requestPending && !busy && (
              <div className="background-response" role="status">
                <span>Another chat is responding</span>
                <button type="button" className="quiet-button" onClick={onOpenActiveChat}>View reply</button>
              </div>
            )}
            {modelSelection.error && (
              <div className="error" role="alert">
                {modelSelection.error} Reload models in Connections to try again.
              </div>
            )}

            {error && (
              <div className="error" role="alert">
                {error}

                <button className="dismiss" aria-label="Dismiss error" onClick={onDismissError}>
                  ×
                </button>
              </div>
            )}

            <form
              className={`composer ${busy ? 'generating' : ''}`}
              onSubmit={event => {
                event.preventDefault()
                void onSend()
              }}
            >
              <textarea
                ref={messageInput}
                aria-label="Message"
                value={draft}
                disabled={!connection || !agent || !loaded || Boolean(runUnavailable)}
                placeholder={
                  connection
                    ? `Message ${agent?.name ?? 'your agent'}…`
                    : 'Add a connection in Settings to begin'
                }
                rows={2}
                onChange={event => onDraftChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()

                    if (!submitting) {
                      void onSend()
                    }
                  }
                }}
              />

              <div className="composer-controls">
                <span className="composer-status">
                  {busy ? progress : 'Enter to send · Shift + Enter for a new line'}
                </span>

                <div className="composer-actions">
                  <ContextIndicator
                    status={run?.context ?? contextResponse?.contextStatus}
                    usage={contextResponse?.contextUsage}
                    loading={!loaded || modelSelection.contextLoading}
                    hasResponse={Boolean(contextResponse)}
                    limit={modelSelection.contextWindow}
                    maxOutput={modelSelection.maxOutputTokens}
                    busy={busy}
                  />
                  {connections.length ? (
                    <ChatModelPicker
                      connections={connections}
                      connection={connection}
                      selection={modelSelection}
                      disabled={busy || !loaded}
                      onSelectConnection={onSelectConnection}
                    />
                  ) : (
                    <button
                      type="button"
                      className="model-connect quiet-button"
                      disabled={busy || !loaded || identityDirty}
                      onClick={onOpenSettings}
                    >
                      Connect model
                    </button>
                  )}

                  {busy ? (
                    <button
                      type="button"
                      className="stop-button"
                      disabled={stopping}
                      onClick={() => void onStop()}
                    >
                      ■ {stopping ? 'Stopping…' : run?.startedAt === null ? 'Cancel queued' : 'Stop'}
                    </button>
                  ) : null}
                  {(
                    <button
                      type="submit"
                      className="send-button"
                      aria-label={busy ? 'Send update' : 'Send message'}
                      title={busy ? 'Send a message to steer this run' : 'Send message'}
                      disabled={submitting || (!draft.trim() && !attachments.length) || !modelSelection.ready || !agent || !loaded || Boolean(runUnavailable)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 19V5m-6 6 6-6 6 6" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </main>
      {panelOpen && <ActivityPanel key={`${agent?.id}:${conversationId}:${project?.id ?? section?.id}`} agentId={agent?.id ?? ''} conversationId={conversationId}
        repository={Boolean(project?.repositoryPath)} busy={busy} stopping={stopping} run={run} messages={messages}
        attachments={attachments} disabled={!agent || !loaded || submitting} onAttachmentsChange={onAttachmentsChange}
        onStop={onStop} />}
      </div>
    </div>
  )
}
