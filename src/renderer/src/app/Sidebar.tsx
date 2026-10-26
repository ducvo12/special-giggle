import { useEffect, useState } from 'react'
import ConversationList from './ConversationList'
import type { Agent, Conversation } from '../../../shared/agent'
import type { Page } from './navigation'
import AgentDropdown from '../features/agents/AgentDropdown'
import type { AgentOrganization, ConversationLocation, Project } from '../../../shared/organization'
import TreeMenu, { type TreeMenuItem } from '../components/TreeMenu'
import NotesTree from '../features/workspace/NotesTree'
import type { TreeDialogAction } from '../features/organization/TreeDialog'
import { defaultTreeSort, readTreeSort, sortTreeEntries, type TreeSort } from './tree-sort'
import Chevron from '../components/Chevron'
import type { RunSnapshot } from '../../../shared/run'
import RepositoryLink, { useRepositoryEditors } from '../features/organization/RepositoryLink'
import type { SavedConnection } from '../../../shared/chat'
import ConnectionUsageCircles from '../features/connections/ConnectionUsage'

type Props = {
  page: Page
  agents: Agent[]
  agentId: string
  agent: Agent | undefined
  connections: SavedConnection[]
  busy: boolean
  runs: RunSnapshot[]
  loaded: boolean
  identityDirty: boolean
  conversations: Conversation[]
  organization: AgentOrganization
  location: ConversationLocation
  selectedFile: string
  fileRevision: number
  onOpenFile: (path: string) => void
  onDialog: (action: TreeDialogAction) => void
  onSelectLocation: (location: ConversationLocation) => void
  onMoveConversation: (id: string, location: ConversationLocation) => Promise<boolean>
  conversationId: string
  onSelectAgent: (id: string) => void
  onRenameConversation: (id: string, title: string) => Promise<boolean>
  onDeleteConversation: (id: string) => Promise<boolean>
  onDeleteAgent: (id: string) => Promise<boolean>
  onNewChat: () => void
  onSelectConversation: (id: string) => void
  onPageChange: (page: Page) => void
}

export default function Sidebar({ page, agents, agentId, agent, connections, busy, runs, loaded, identityDirty, conversations,
  organization, location, selectedFile, fileRevision, onOpenFile, onDialog, onSelectLocation,
  onMoveConversation, conversationId, onSelectAgent, onDeleteAgent, onDeleteConversation,
  onRenameConversation, onNewChat, onSelectConversation, onPageChange }: Props) {
  const [sectionsOpen, setSectionsOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const repositoryEditors = useRepositoryEditors()
  const storageKey = `granite.tree-sort.${agentId}`
  const [sorts, setSorts] = useState<Record<string, TreeSort>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
      return Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, readTreeSort(JSON.stringify(value))]))
    } catch { return {} }
  })
  const disabled = !loaded || identityDirty
  const actionsDisabled = disabled
  useEffect(() => {
    setCollapsed(previous => {
      const next = new Set(previous)
      next.delete(location.sectionId)
      if (location.projectId) next.delete(location.projectId)
      return next
    })
    setSectionsOpen(true)
  }, [location.sectionId, location.projectId, conversationId])

  function toggle(id: string) {
    setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function sort(scope: string) { return sorts[scope] ?? defaultTreeSort }
  function changeSort(scope: string, value: TreeSort) {
    const next = { ...sorts, [scope]: value }
    setSorts(next)
    localStorage.setItem(storageKey, JSON.stringify(next))
  }
  function sortItems(scope: string, noun: string): TreeMenuItem[] {
    const current = sort(scope)
    return [{ label: `Sort ${noun} by` },
      ...([['activity', 'Most recently chatted'], ['name', 'Alphabetical order'], ['created', 'Most recently made']] as const).map(([by, label]) => ({
        label, checked: current.by === by, action: () => changeSort(scope, { ...current, by })
      })), { label: 'Direction' },
      ...([['asc', 'Ascending'], ['desc', 'Descending']] as const).map(([direction, label]) => ({
        label, checked: current.direction === direction, action: () => changeSort(scope, { ...current, direction })
      }))]
  }
  function chatList(chats: Conversation[]) {
    return <ConversationList conversations={chats} organization={organization}
      selectedId={page === 'chat' ? conversationId : ''} disabled={disabled} actionsDisabled={actionsDisabled} runs={runs}
      onSelect={onSelectConversation} onRename={onRenameConversation} onDelete={onDeleteConversation} onMove={onMoveConversation} />
  }
  function projectTree(project: Project) {
    const open = !collapsed.has(project.id)
    return <div key={project.id} className="organization-project-group" role="group" aria-label={project.name}>
      <div className="tree-row">
        <button className="tree-chevron tree-action" aria-label={`${open ? 'Collapse' : 'Expand'} project ${project.name}`} aria-expanded={open}
          disabled={disabled} onClick={() => toggle(project.id)}><Chevron expanded={open} /></button>
        <button className={`organization-location tree-entry ${page === 'chat' && !conversationId && location.projectId === project.id ? 'selected' : ''}`}
          aria-current={page === 'chat' && !conversationId && location.projectId === project.id ? 'location' : undefined}
          title={`New chat in ${project.name}`} disabled={disabled}
          onClick={() => onSelectLocation({ sectionId: project.sectionId, projectId: project.id })}>
          <span>{project.name}/</span>
        </button>
        <TreeMenu label={`Options for project ${project.name}`} disabled={disabled} items={[
          ...sortItems(project.id, 'chats'), { label: 'Project' },
          { label: 'Project settings', disabled: actionsDisabled, action: () => onDialog({ type: 'project-settings', projectId: project.id }) }
        ]} />
        <button className="tree-action" aria-label={`New chat in ${project.name}`} title="New chat" disabled={actionsDisabled}
          onClick={() => onSelectLocation({ sectionId: project.sectionId, projectId: project.id })}>+</button>
      </div>
      {open && <div className="organization-children">
        {project.repositoryPath && <RepositoryLink agentId={agentId} project={project} disabled={actionsDisabled}
          choices={repositoryEditors.choices} onChoices={repositoryEditors.setChoices} />}
        {chatList(sortTreeEntries(conversations.filter(chat => chat.projectId === project.id), conversations, sort(project.id)))}
      </div>}
    </div>
  }

  return <aside id="app-sidebar" className="sidebar file-sidebar" aria-label="Agent explorer">
    <button className="new-chat-button quiet-button" aria-label="New chat" title="New chat in General" disabled={actionsDisabled || !agent} onClick={onNewChat}>
      <span aria-hidden="true">+</span>New chat
    </button>
    <div className="agent-tree-header">
      <AgentDropdown agents={agents} selectedId={agentId} disabled={actionsDisabled}
        onSelect={onSelectAgent} onDelete={onDeleteAgent} onCreate={() => onPageChange('create-agent')} />
      <button className="tree-action" aria-label="Create agent" title="New agent" disabled={actionsDisabled} onClick={() => onPageChange('create-agent')}>+</button>
    </div>
    {agent && <div className="agent-file-tree">
      <div className="agent-files">
        {['/identity.md', '/memory.md'].map(path => <button key={path}
          className={`tree-entry tree-file ${page === 'file' && selectedFile === path ? 'selected' : ''}`} title={path.slice(1)}
          aria-current={page === 'file' && selectedFile === path ? 'page' : undefined}
          disabled={disabled} onClick={() => onOpenFile(path)}><span className="tree-file-icon" aria-hidden="true">▤</span><span>{path.slice(1)}</span></button>)}
        <button className={`tree-entry ${page === 'tools' ? 'selected' : ''}`} disabled={actionsDisabled}
          onClick={() => onPageChange('tools')}><span className="tree-file-icon" aria-hidden="true">▱</span><span>tools &amp; skills/</span></button>
        <NotesTree key={agent.id} agentId={agent.id} disabled={disabled} selectedFile={page === 'file' ? selectedFile : ''}
          actionsDisabled={disabled || busy} revision={fileRevision} onOpen={onOpenFile} onCreate={() => onDialog({ type: 'note-create' })}
          onRename={path => onDialog({ type: 'note-rename', path })} />
        <div className="tree-row sections-tree-header">
          <button className="tree-entry" disabled={disabled} aria-expanded={sectionsOpen} onClick={() => setSectionsOpen(open => !open)}>
            <span className="tree-chevron" aria-hidden="true"><Chevron expanded={sectionsOpen} /></span><span>sections/</span>
          </button>
          <TreeMenu label="Sections options" disabled={disabled} items={sortItems('sections', 'sections')} />
          <button className="tree-action" aria-label="New section" title="New section" disabled={actionsDisabled} onClick={() => onDialog({ type: 'section-create' })}>+</button>
        </div>
        {sectionsOpen && <div className="organization-navigation organization-children" aria-label="Sections and projects">
          {sortTreeEntries(organization.sections, conversations, sort('sections')).map(section => {
            const open = !collapsed.has(section.id)
            const children = sortTreeEntries<Conversation | Project>([
              ...conversations.filter(chat => chat.sectionId === section.id && !chat.projectId),
              ...organization.projects.filter(project => project.sectionId === section.id)
            ], conversations, sort(section.id))
            return <section key={section.id} className="organization-section-group" aria-label={section.name}>
              <div className="tree-row">
                <button className="tree-chevron tree-action" aria-label={`${open ? 'Collapse' : 'Expand'} section ${section.name}`} aria-expanded={open}
                  disabled={disabled} onClick={() => toggle(section.id)}><Chevron expanded={open} /></button>
                <button className={`organization-location tree-entry ${page === 'chat' && !conversationId && location.sectionId === section.id && !location.projectId ? 'selected' : ''}`}
                  aria-current={page === 'chat' && !conversationId && location.sectionId === section.id && !location.projectId ? 'location' : undefined}
                  title={`${section.name} · ${section.mode === 'closed' ? 'Closed' : 'Shared'}`} disabled={disabled}
                  onClick={() => onSelectLocation({ sectionId: section.id, projectId: null })}>
                  <span>{section.name}/</span>{section.mode === 'closed' && <span className="organization-mode">Closed</span>}
                </button>
                <TreeMenu label={`Options for section ${section.name}`} disabled={disabled} items={[
                  ...sortItems(section.id, 'contents'), { label: 'Section' },
                  { label: 'Section settings', disabled: actionsDisabled, action: () => onDialog({ type: 'section-settings', sectionId: section.id }) }
                ]} />
                <TreeMenu label={`Add to ${section.name}`} plus disabled={actionsDisabled} items={[
                  { label: 'New chat', action: () => onSelectLocation({ sectionId: section.id, projectId: null }) },
                  ...(section.kind === 'general' ? [] : [{ label: 'New project', action: () => onDialog({ type: 'project-create', sectionId: section.id }) }])
                ]} />
              </div>
              {open && <div className="organization-children">
                {children.map(child => 'title' in child ? <div key={child.id}>{chatList([child])}</div> : projectTree(child))}
              </div>}
            </section>
          })}
        </div>}
      </div>
    </div>}
    <div className="sidebar-footer">
      <button type="button" className={`sidebar-settings quiet-button ${page === 'settings' ? 'selected' : ''}`}
        aria-label="Settings" title="Settings" aria-current={page === 'settings' ? 'page' : undefined}
        disabled={identityDirty} onClick={() => onPageChange('settings')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9.5 3-.6 2.3-1.4.8L5.2 5.5 2.7 9.8l1.7 1.7v1.6l-1.7 1.7 2.5 4.3 2.3-.6 1.4.8.6 2.3h5l.6-2.3 1.4-.8 2.3.6 2.5-4.3-1.7-1.7v-1.6l1.7-1.7-2.5-4.3-2.3.6-1.4-.8L14.5 3Z" />
          <circle cx="12" cy="12.3" r="3" />
        </svg>
      </button>

      <ConnectionUsageCircles connections={connections} />
    </div>
  </aside>
}
