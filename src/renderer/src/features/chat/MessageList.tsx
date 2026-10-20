import type { RefObject } from 'react'
import type { Agent, AgentMessage } from '../../../../shared/agent'
import type { SavedConnection, StreamActivity } from '../../../../shared/chat'

type Props = {
  agent: Agent | undefined
  connection: SavedConnection | undefined
  busy: boolean
  loaded: boolean
  identityDirty: boolean
  messages: AgentMessage[]
  activity: StreamActivity
  end: RefObject<HTMLDivElement | null>
  follow: RefObject<boolean>
  onOpenSettings: () => void
  onCreateAgent: () => void
}

export default function MessageList({
  agent,
  connection,
  busy,
  loaded,
  identityDirty,
  messages,
  activity,
  end,
  follow,
  onOpenSettings,
  onCreateAgent
}: Props) {
  return (
    <section
      className="messages"
      onScroll={event => {
        const el = event.currentTarget
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      }}
      aria-label="Conversation"
      aria-busy={busy}
    >
      {!messages.length && (
        <div className="empty-chat">
          <div className="empty-icon">
            ◈
          </div>

          <div className="eyebrow">
            {agent ? `MEET ${agent.name.toUpperCase()}` : 'YOUR AGENTS'}
          </div>

          <h1>
            {agent ? 'A little continuity.' : 'Create your first agent.'}
          </h1>

          <p>
            {!agent
              ? 'Give an agent a name to start its own workspace, memory, and conversations.'
              : connection
                ? 'An assistant with a workspace, notes, and a memory of what matters to you.'
                : 'Add a connection to start your first conversation.'}
          </p>

          {!agent && loaded && (
            <button disabled={identityDirty} onClick={onCreateAgent}>
              Create agent
            </button>
          )}

          {agent && !connection && loaded && (
            <button disabled={identityDirty} onClick={onOpenSettings}>
              Connect a model ↗
            </button>
          )}
        </div>
      )}

      {messages.map(message => (
        <article className={`message ${message.role}`} key={message.id}>
          <span className="message-role">
            {message.role === 'user' ? 'You' : `${agent?.name ?? 'Agent'} · ${message.model ?? ''}`}
          </span>

          {!!message.tools?.length && (
            <div className="tool-activity" aria-label="Tool activity">
              {message.tools.map(tool => (
                <details key={tool.id}>
                  <summary>
                    <span className={`tool-state ${tool.status}`} />

                    {tool.name}

                    <span>
                      {tool.status}
                    </span>
                  </summary>

                  <pre>
                    {tool.input}{tool.output ? `\n\n${tool.output}` : ''}
                  </pre>
                </details>
              ))}
            </div>
          )}

          <div>
            {message.content ||
              (message.status === 'running' ? (
                <span className="thinking">
                  {activity.reasoningCharacters
                    ? 'Model is reasoning'
                    : `${agent?.name ?? 'Agent'} is working`}

                  <span className="animated-dots">
                    …
                  </span>
                </span>
              ) : message.notice ? null : (
                <span className="interrupted">
                  No answer received
                </span>
              ))}
          </div>

          {message.notice && (
            <span className="interrupted">
              {message.notice}
            </span>
          )}

          {message.interrupted && (
            <span className="interrupted">
              {message.status === 'error'
                ? message.error
                : 'Reply interrupted · completed file changes are kept'}
            </span>
          )}
        </article>
      ))}

      <div ref={end} />
    </section>
  )
}
