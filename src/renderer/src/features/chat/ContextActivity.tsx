import type { AgentMessage } from '../../../../shared/agent'
import ActivitySection from './ActivitySection'
import ContextSources from './ContextSources'

export default function ContextActivity({ agentId, chatId, messages }: { agentId: string; chatId: string; messages: AgentMessage[] }) {
  let question = 'Saved reply'
  const replies: { message: AgentMessage; question: string }[] = []
  for (const message of messages) {
    if (message.role === 'user') question = message.content.slice(0, 100) || 'User message'
    else if (message.sources?.length) replies.push({ message, question })
  }
  if (!replies.length) return null
  const count = replies.reduce((total, { message }) => total + message.sources!.length, 0)
  return <ActivitySection title="Context retrieval" summary={<span className="activity-count">{count}</span>}>
    <p className="activity-hint">Recorded context for each reply, including search hits and current questions. These entries are not a list of verified citations.</p>
    {replies.slice().reverse().map(({ message, question }) => <details className="activity-item context-retrieval-reply" key={message.id}>
      <summary><span className="activity-file-name" title={question}>Reply to: {question}</span><span className="activity-count">{message.sources!.length}</span></summary>
      <ContextSources agentId={agentId} chatId={chatId} sources={message.sources!} trace />
    </details>)}
  </ActivitySection>
}
