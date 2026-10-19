import type { RefObject } from 'react'
import type { Agent, AgentMessage } from '../../../../shared/agent'
import type { SavedConnection, StreamActivity } from '../../../../shared/chat'
import MessageList from './MessageList'

type Props = {
  agent: Agent | undefined
  connections: SavedConnection[]
  connection: SavedConnection | undefined
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
  onNewChat: () => void
  onOpenSettings: () => void
  onDismissError: () => void
  onDraftChange: (draft: string) => void
  onSend: () => Promise<void>
  onStop: () => Promise<void>
}

export default function ChatView({
  agent,
  connections,
  connection,
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
  onNewChat,
  onOpenSettings,
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
      <header>
        <div className="header-title">
          <span>
            {agent?.name ?? 'Agent'}
          </span>

          <span className="header-divider" />

          <select
            aria-label="Active connection"
            value={connection?.id ?? ''}
            disabled={busy || !loaded}
            onChange={event => onSelectConnection(event.target.value)}
          >
            <option value="" disabled>
              {loaded ? 'Choose connection' : 'Loading…'}
            </option>

            {connections.map(item => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.model}
              </option>
            ))}
          </select>
        </div>

        <button className="quiet-button" disabled={busy || !loaded} onClick={onNewChat}>
          New chat
        </button>
      </header>

      <MessageList
        agent={agent}
        connection={connection}
        busy={busy}
        loaded={loaded}
        identityDirty={identityDirty}
        messages={messages}
        activity={activity}
        end={end}
        follow={follow}
        onOpenSettings={onOpenSettings}
      />

      <div className="composer-area">
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
            rows={3}
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

          <div>
            <span>
              {busy
                ? progress
                : 'Enter to send · Shift + Enter for a new line'}
            </span>

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
              <button type="submit" disabled={!draft.trim() || !connection || !agent || !loaded}>
                Send ↗
              </button>
            )}
          </div>
        </form>

        <p className="composer-note">
          {connection ? `Inference: ${connection.name}. ` : ''}Notes, memory, and conversations are saved locally.
        </p>
      </div>
    </main>
  )
}
