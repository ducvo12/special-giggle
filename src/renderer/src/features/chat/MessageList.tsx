import ThoughtActivity from './ThoughtActivity'
import { responseClock } from './response-clock'
import ResponseTimings from './ResponseTimings'
import { timingFor } from './devTimings'
import StreamingText from './StreamingText'
import { useLayoutEffect, useRef, type RefObject } from 'react'
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
  // A streaming reply already present on entry is a resumed snapshot. Reveal
  // that snapshot immediately; newly arriving chunks still animate normally.
  const resumedReplies = useRef(new Set(messages.filter(message =>
    message.role === 'assistant' && message.status === 'running' && message.content
  ).map(message => message.id)))

  const resumedEntries = useRef(new Set(resumedReplies.current.size ? messages.map(message => message.id) : []))

  useLayoutEffect(() => {
    if (loaded) {
      follow.current = true
      end.current?.scrollIntoView({ block: 'end', behavior: 'instant' })
    }
  }, [loaded, end, follow])

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
        <article className={`message ${message.role}${resumedEntries.current.has(message.id) || resumedReplies.current.has(responseClock.get(message.id)?.requestId ?? message.id) ? 'resumed-entry' : ''}`} key={responseClock.get(message.id)?.requestId ?? timingFor(message.id)?.requestId ?? message.id}>
          {message.role === 'user' && <span className="message-role">You</span>}

          {message.role === 'assistant' && <ThoughtActivity message={message} />}
          {message.delivery === 'pending' && <span className="message-delivery">Received · pending</span>}
          {message.delivery === 'cancelled' && <span className="message-delivery">Not processed · cancelled</span>}

          <div>
            {message.content ? (
              message.role === 'assistant' ? (
                <StreamingText skipInitialAnimation={resumedReplies.current.has(message.id)} messageId={message.id} text={message.content} status={message.status} end={end} follow={follow} />
              ) : message.content
            ) :
              (message.status === 'running' ? (
                <span className="thinking">
                  {activity.reasoningCharacters
                    ? 'Model is reasoning'
                    : `${agent?.name ?? 'Agent'} is working`}

                  <span className="animated-dots">
                    …
                  </span>
                </span>
              ) : message.notice || message.questions?.length ? null : (
                <span className="interrupted">
                  No answer received
                </span>
              ))}
          </div>

          {message.questions?.map(question => <div className="question-history" key={question.id}>
            {question.questions.map((item, index) => <p key={index}>{item.title}{question.answers ? ` — ${question.answers[index] || 'No answer provided'}` : ` · ${question.status === 'pending' ? 'Awaiting answer' : question.status}`}</p>)}
          </div>)}
          {message.role === 'assistant' && <ResponseTimings messageId={message.id} />}

          {message.notice && (
            <span className="interrupted">
              {message.notice}
            </span>
          )}

          {message.interrupted && !message.notice?.startsWith('Provisional reply interrupted') && (
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
