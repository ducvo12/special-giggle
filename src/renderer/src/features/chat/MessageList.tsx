import type { RefObject } from 'react'
import type { Agent, AgentMessage } from '../../../../shared/agent'
import type { StreamActivity } from '../../../../shared/chat'

type Props = {
  agent: Agent | undefined
  busy: boolean
  loaded: boolean
  identityDirty: boolean
  messages: AgentMessage[]
  activity: StreamActivity
  end: RefObject<HTMLDivElement | null>
  follow: RefObject<boolean>
  onCreateAgent: () => void
}

export default function MessageList({
  agent,
  busy,
  loaded,
  identityDirty,
  messages,
  activity,
  end,
  follow,
  onCreateAgent
}: Props) {
  return (
    <section
      className={messages.length ? 'messages' : 'messages messages-empty'}
      onScroll={event => {
        const el = event.currentTarget
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      }}
      aria-label="Conversation"
      aria-busy={busy}
    >
      {!messages.length && (
        <div className="empty-chat">
          <div className="empty-icon" aria-hidden="true">
            ◈
          </div>

          {agent && (
            <h1>
              {agent.name}
            </h1>
          )}

          {!agent && loaded && (
            <button disabled={identityDirty} onClick={onCreateAgent}>
              Create agent
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
