import type { RefObject } from 'react'
import type { Agent, AgentMessage } from '../../../../shared/agent'
import type { SavedConnection, StreamActivity } from '../../../../shared/chat'
import MessageList from './MessageList'
import ChatModelPicker from './ChatModelPicker'
import type { ModelSelection } from './useConnectionModel'

type Props = {
  agent: Agent | undefined
  connections: SavedConnection[]
  connection: SavedConnection | undefined
  modelSelection: ModelSelection
  busy: boolean
  loaded: boolean
  identityDirty: boolean
  messages: AgentMessage[]
  activity: StreamActivity
  end: RefObject<HTMLDivElement | null>
  follow: RefObject<boolean>
  error: string
  draft: string
  elapsed: number
  stopping: boolean
  onSelectConnection: (id: string) => void
  onOpenSettings: () => void
  onCreateAgent: () => void
  onDismissError: () => void
  onDraftChange: (draft: string) => void
  onSend: () => Promise<void>
  onStop: () => Promise<void>
}

export default function ChatView({
  agent,
  connections,
  connection,
  modelSelection,
  busy,
  loaded,
  identityDirty,
  messages,
  activity,
  end,
  follow,
  error,
  draft,
  elapsed,
  stopping,
  onSelectConnection,
  onOpenSettings,
  onCreateAgent,
  onDismissError,
  onDraftChange,
  onSend,
  onStop
}: Props) {
  const reasoningProgress = activity.reasoningCharacters
    ? ` · ${activity.reasoningCharacters.toLocaleString()} reasoning characters`
    : ''
  const progress = `${agent?.name ?? 'Agent'} is working · ${elapsed}s${reasoningProgress}`

  return (
    <main className="chat-main">
      <MessageList
        agent={agent}
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
            aria-label="Message"
            value={draft}
            disabled={!connection || !agent || !loaded}
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

                if (!busy) {
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
                  ■ {stopping ? 'Stopping…' : 'Stop'}
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  aria-label="Send message"
                  title="Send message"
                  disabled={!draft.trim() || !modelSelection.ready || !agent || !loaded}
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
  )
}
