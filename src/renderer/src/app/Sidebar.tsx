import type { Agent, Conversation } from '../../../shared/agent'
import type { Page } from './navigation'
import AgentDropdown from '../features/agents/AgentDropdown'

type Props = {
  page: Page
  agents: Agent[]
  agentId: string
  agent: Agent | undefined
  busy: boolean
  loaded: boolean
  identityDirty: boolean
  conversations: Conversation[]
  conversationId: string
  onSelectAgent: (id: string) => void
  onDeleteAgent: (id: string) => Promise<boolean>
  onNewChat: () => void
  onSelectConversation: (id: string) => void
  onPageChange: (page: Page) => void
}

export default function Sidebar({
  page,
  agents,
  agentId,
  agent,
  busy,
  loaded,
  identityDirty,
  conversations,
  conversationId,
  onSelectAgent,
  onDeleteAgent,
  onNewChat,
  onSelectConversation,
  onPageChange
}: Props) {
  if (page === 'settings') {
    return (
      <aside id="app-sidebar" className="sidebar" aria-label="Settings navigation">
        <button className="quiet-button settings-back" onClick={() => onPageChange('chat')}>
          <span aria-hidden="true">←</span> Back to chat
        </button>
        <span className="section-label">SETTINGS</span>
        <nav aria-label="Settings categories">
          <button className="nav-item active" aria-current="page" onClick={() => onPageChange('settings')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4" />
            </svg>
            Connections
          </button>
        </nav>
      </aside>
    )
  }

  return (
    <aside id="app-sidebar" className="sidebar">
      <span className="section-label">
        AGENTS
      </span>

      <div className="agent-switcher">
        <AgentDropdown
          agents={agents}
          selectedId={agentId}
          disabled={busy || !loaded || identityDirty}
          onSelect={onSelectAgent}
          onDelete={onDeleteAgent}
          onCreate={() => onPageChange('create-agent')}
        />
      </div>

      <button
        className="new-chat-button quiet-button"
        aria-label="New chat"
        disabled={busy || !loaded || identityDirty || !agent}
        onClick={onNewChat}
      >
        <span aria-hidden="true">
          +
        </span>

        New chat
      </button>

      <button
        className={`nav-item ${page === 'chat' ? 'active' : ''}`}
        disabled={identityDirty}
        onClick={() => onPageChange('chat')}
      >
        <span>
          ◈
        </span>

        {' '}Conversations{' '}

        {busy && (
          <span className="live-dot" />
        )}
      </button>

      <button
        className={`nav-item ${page === 'workspace' ? 'active' : ''}`}
        disabled={identityDirty || !agent}
        onClick={() => onPageChange('workspace')}
      >
        <span>
          ▧
        </span>

        {' '}Workspace
      </button>

      <button
        className={`nav-item ${page === 'identity' ? 'active' : ''}`}
        disabled={identityDirty || !agent}
        onClick={() => onPageChange('identity')}
      >
        <span>
          ◇
        </span>

        {' '}Identity
      </button>

      <button
        className={`nav-item ${page === 'tools' ? 'active' : ''}`}
        disabled={identityDirty || !agent || busy}
        onClick={() => onPageChange('tools')}
      >
        <span>
          ⌘
        </span>

        {' '}Tools & skills
      </button>

      <div className="conversation-list">
        {conversations.map(chat => (
          <button
            key={chat.id}
            title={chat.title}
            disabled={busy || !loaded || identityDirty}
            className={conversationId === chat.id ? 'selected' : ''}
            onClick={() => onSelectConversation(chat.id)}
          >
            {chat.title}
          </button>
        ))}
      </div>

      <div className="sidebar-bottom">
        <button
          className="nav-item"
          disabled={identityDirty}
          onClick={() => onPageChange('settings')}
        >
          <span>
            ⚙
          </span>

          {' '}Settings
        </button>

        <div className="sidebar-footer">
          <span className="status-dot" />

          {' '}Saved on this device
        </div>
      </div>
    </aside>
  )
}
