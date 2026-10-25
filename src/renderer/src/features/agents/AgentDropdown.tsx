import { useEffect, useId, useRef, useState } from 'react'
import type { Agent } from '../../../../shared/agent'
import Chevron from '../../components/Chevron'

type Props = {
  agents: Agent[]
  selectedId: string
  disabled: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => Promise<boolean>
}

export default function AgentDropdown({
  agents,
  selectedId,
  disabled,
  onSelect,
  onCreate,
  onDelete
}: Props) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<Agent | null>(null)
  const [deleting, setDeleting] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const selected = agents.find(agent => agent.id === selectedId)

  function close() {
    setOpen(false)
    setConfirming(null)
    trigger.current?.focus()
  }

  useEffect(() => {
    if (!open) {
      return
    }

    if (disabled) {
      setOpen(false)
      setConfirming(null)

      return
    }

    const focus = menu.current?.querySelector<HTMLElement>(
      '[aria-checked="true"], [role="menuitemradio"], [role="menuitem"]'
    )
    focus?.focus()

    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false)
        setConfirming(null)
      }
    }
    document.addEventListener('pointerdown', outside)

    return () => document.removeEventListener('pointerdown', outside)
  }, [open, disabled, confirming])

  async function remove() {
    if (!confirming || deleting) {
      return
    }

    setDeleting(true)

    try {
      if (await onDelete(confirming.id)) {
        close()
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="agent-dropdown" ref={container}>
      <button
        ref={trigger}
        className="agent-dropdown-trigger"
        aria-label="Active agent"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-agent-id={selectedId}
        disabled={disabled || deleting}
        onClick={() => {
          setConfirming(null)
          setOpen(current => !current)
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span>
          {selected?.name ?? 'Choose an agent'}
        </span>

        <Chevron expanded />
      </button>

      {open && !disabled && (
        <div
          ref={menu}
          id={menuId}
          className="agent-menu"
          role="menu"
          aria-label="Agents"
          onBlur={event => {
            if (!container.current?.contains(event.relatedTarget as Node | null)) {
              setOpen(false)
              setConfirming(null)
            }
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()

              return
            }

            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              return
            }

            event.preventDefault()
            const items = Array.from(
              menu.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)'
              ) ?? []
            )
            const current = items.indexOf(document.activeElement as HTMLButtonElement)
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
            items[next]?.focus()
          }}
        >
          {confirming ? (
            <div className="agent-delete-confirmation" role="group" aria-label="Confirm deletion">
              <p>
                Delete {confirming.name}?
              </p>

              <small>
                Its workspace, memory, and conversations will be permanently deleted.
              </small>

              <div>
                <button
                  role="menuitem"
                  tabIndex={-1}
                  className="quiet-button"
                  disabled={deleting}
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>

                <button
                  role="menuitem"
                  tabIndex={-1}
                  className="danger-button"
                  disabled={deleting}
                  onClick={() => void remove()}
                >
                  {deleting ? 'Deleting…' : 'Delete agent'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {agents.map(agent => (
                <div className="agent-menu-row" key={agent.id}>
                  <button
                    role="menuitemradio"
                    tabIndex={-1}
                    aria-checked={selectedId === agent.id}
                    data-agent-id={agent.id}
                    className="agent-menu-choice"
                    onClick={() => {
                      close()
                      onSelect(agent.id)
                    }}
                  >
                    <span>
                      {agent.name}
                    </span>

                    <span aria-hidden="true">
                      {selectedId === agent.id ? '✓' : ''}
                    </span>
                  </button>

                  <button
                    role="menuitem"
                    tabIndex={-1}
                    className="agent-menu-delete"
                    aria-label={`Delete agent ${agent.name}`}
                    onClick={() => setConfirming(agent)}
                  >
                    Delete
                  </button>
                </div>
              ))}

              {!agents.length && (
                <p className="agent-menu-empty">
                  No agents yet.
                </p>
              )}

              <button
                role="menuitem"
                tabIndex={-1}
                className="agent-menu-create"
                aria-label="Create agent"
                onClick={() => {
                  close()
                  onCreate()
                }}
              >
                + New agent
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
