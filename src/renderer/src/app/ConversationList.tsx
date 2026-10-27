import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Conversation } from '../../../shared/agent'
import { chatMoveProblem, type AgentOrganization, type ConversationLocation } from '../../../shared/organization'
import { isLiveRun, locksChat, type RunSnapshot } from '../../../shared/run'

type Props = {
  conversations: Conversation[]
  selectedId: string
  disabled: boolean
  actionsDisabled?: boolean
  runs?: RunSnapshot[]
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  organization: AgentOrganization
  onMove: (id: string, location: ConversationLocation) => Promise<boolean>
}

type Menu = { id: string; x: number; y: number; mode: 'options' | 'rename' | 'delete' | 'move' }

export default function ConversationList({ conversations, selectedId, disabled, actionsDisabled = disabled, runs = [], organization, onSelect, onRename, onDelete, onMove }: Props) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [destination, setDestination] = useState('')
  const popup = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const chat = conversations.find(chat => chat.id === menu?.id)
  const locked = runs.some(run => run.conversationId === chat?.id && locksChat(run))
  const live = runs.some(run => run.conversationId === chat?.id && isLiveRun(run))
  function badge(id: string) {
    const run = runs.filter(run => run.conversationId === id && isLiveRun(run)).at(-1)
    if (!run) return null
    const text = run.phase === 'queued' ? `Queued${run.queue?.position ? ` ${run.queue.position}` : ''}`
      : run.phase === 'question' ? 'Answer needed' : run.phase === 'approval' ? 'Approval' : run.phase === 'stopping' ? 'Stopping' : 'Working'
    return <span className="chat-run-badge" title={run.queue?.reason ?? text}>{text}</span>
  }
  const destinations = chat ? organization.sections.flatMap(section => [
    { location: { sectionId: section.id, projectId: null }, label: section.name },
    ...organization.projects.filter(project => project.sectionId === section.id).map(project => ({
      location: { sectionId: section.id, projectId: project.id },
      label: `${section.name} / ${project.name}${project.repositoryPath ? ' (repository)' : ''}`
    }))
  ]).filter(item => !(item.location.sectionId === chat.sectionId && item.location.projectId === chat.projectId) &&
    !chatMoveProblem(chat, item.location, organization)) : []

  function close() {
    setMenu(null)
    trigger.current?.focus()
  }

  useLayoutEffect(() => {
    if (!menu || !popup.current) return
    const rect = popup.current.getBoundingClientRect()
    popup.current.style.left = `${Math.max(6, Math.min(menu.x, window.innerWidth - rect.width - 6))}px`
    popup.current.style.top = `${Math.max(6, Math.min(menu.y, window.innerHeight - rect.height - 6))}px`
    const input = popup.current.querySelector('input')
    if (input) {
      input.focus()
      input.select()
    } else {
      popup.current.querySelector<HTMLElement>('select, button')?.focus()
    }
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent) => {
      if (!saving && !popup.current?.contains(event.target as Node)) setMenu(null)
    }
    const dismiss = () => { if (!saving) setMenu(null) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [menu, saving])

  useEffect(() => {
    if ((disabled || actionsDisabled) && !saving) setMenu(null)
  }, [disabled, actionsDisabled, saving])

  async function submit() {
    if (!menu || saving || disabled || actionsDisabled || menu.mode === 'move' && locked || menu.mode === 'delete' && live) return
    setSaving(true)
    try {
      const success = menu.mode === 'move'
        ? Boolean(destination) && await onMove(menu.id, JSON.parse(destination))
        : menu.mode === 'rename'
        ? await onRename(menu.id, title)
        : await onDelete(menu.id)
      if (success) close()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="conversation-list">
      {conversations.map(chat => (
        <div className={`conversation-row ${selectedId === chat.id ? 'selected' : ''} ${menu?.id === chat.id ? 'menu-open' : ''}`} key={chat.id}>
        <button
          title={chat.title}
          aria-label={chat.title}
          className={`conversation-choice ${selectedId === chat.id ? 'selected' : ''}`}
          disabled={disabled || saving}
          aria-haspopup="menu"
          aria-expanded={menu?.id === chat.id}
          onClick={() => { setMenu(null); onSelect(chat.id) }}
          onContextMenu={event => {
            event.preventDefault()
            if (disabled || actionsDisabled || saving) return
            trigger.current = event.currentTarget
            setMenu({ id: chat.id, x: event.clientX, y: event.clientY, mode: 'options' })
          }}
          onKeyDown={event => {
            if (actionsDisabled) return
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              trigger.current = event.currentTarget
              setMenu({ id: chat.id, x: rect.left, y: rect.bottom, mode: 'options' })
            }
          }}
        >{chat.title}{badge(chat.id)}</button>
        <button
          className="conversation-more"
          aria-label={`Options for ${chat.title}`}
          title="Chat options"
          aria-haspopup="menu"
          aria-expanded={menu?.id === chat.id}
          disabled={disabled || actionsDisabled || saving}
          onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect()
            trigger.current = event.currentTarget
            setMenu({ id: chat.id, x: rect.left, y: rect.bottom + 3, mode: 'options' })
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="8" r="1.2" />
            <circle cx="8" cy="8" r="1.2" />
            <circle cx="13" cy="8" r="1.2" />
          </svg>
        </button>
        </div>
      ))}
      {menu && chat && (
        <div
          ref={popup}
          className="chat-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role={menu.mode === 'options' ? 'menu' : 'dialog'}
          aria-label={menu.mode === 'options' ? 'Chat options' : menu.mode === 'rename' ? 'Rename chat' : menu.mode === 'move' ? 'Move chat' : 'Delete chat'}
          onContextMenu={event => event.preventDefault()}
          onBlur={event => {
            if (!saving && !event.currentTarget.contains(event.relatedTarget as Node | null)) setMenu(null)
          }}
          onKeyDown={event => {
            if (event.key === 'Escape' && !saving) { event.preventDefault(); close() }
            if (menu.mode !== 'options' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const items = Array.from(popup.current?.querySelectorAll('button') ?? [])
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
              : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
            items[next]?.focus()
          }}
        >
          {menu.mode === 'options' ? <>
            <button role="menuitem" onClick={() => { setTitle(chat.title); setMenu({ ...menu, mode: 'rename' }) }}>Rename chat</button>
            <button role="menuitem" disabled={!destinations.length || locked} onClick={() => { setDestination(''); setMenu({ ...menu, mode: 'move' }) }}>Move chat…</button>
            <button role="menuitem" disabled={live} onClick={() => setMenu({ ...menu, mode: 'delete' })}>Delete chat</button>
          </> : (
            <form onSubmit={event => { event.preventDefault(); void submit() }}>
              {menu.mode === 'rename' ? <>
                <label htmlFor="chat-name">Rename chat</label>
                <input id="chat-name" value={title} maxLength={200} disabled={saving} onChange={event => setTitle(event.target.value)} />
              </> : menu.mode === 'move' ? <>
                <label htmlFor="chat-destination">Move chat to</label>
                <select id="chat-destination" value={destination} required disabled={saving} onChange={event => setDestination(event.target.value)}>
                  <option value="" disabled>Choose a location</option>
                  {destinations.map(item => <option key={JSON.stringify(item.location)} value={JSON.stringify(item.location)}>{item.label}</option>)}
                </select>
                <p>Moving changes future context. Entering a repository project is permanent and enables editing when repository tools are available.</p>
              </> : <p>Permanently delete this chat?</p>}
              <div className="chat-menu-actions">
                <button type="button" disabled={saving} onClick={close}>Cancel</button>
                <button type="submit" disabled={saving || disabled || (menu.mode === 'rename' && !title.trim()) || (menu.mode === 'move' && !destination)}>
                  {saving ? 'Saving…' : menu.mode === 'rename' ? 'Save' : menu.mode === 'move' ? 'Move' : 'Delete'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
