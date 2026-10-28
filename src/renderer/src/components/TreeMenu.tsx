import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import TreeActionIcon from './TreeActionIcon'

export type TreeMenuItem = { label: string; action?: () => void; checked?: boolean; disabled?: boolean }

export default function TreeMenu({ label, items, disabled, plus = false }: {
  label: string; items: TreeMenuItem[]; disabled?: boolean; plus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  function close() { setOpen(false); trigger.current?.focus() }
  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return
    const anchor = trigger.current.getBoundingClientRect()
    const rect = popup.current.getBoundingClientRect()
    popup.current.style.left = `${Math.max(6, Math.min(anchor.left, innerWidth - rect.width - 6))}px`
    popup.current.style.top = `${Math.max(6, Math.min(anchor.bottom + 4, innerHeight - rect.height - 6))}px`
    popup.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open])
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismiss = () => setOpen(false)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open])
  return <>
    <button ref={trigger} className="tree-action" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
      disabled={disabled} onClick={() => setOpen(value => !value)}><TreeActionIcon plus={plus} /></button>
    {open && createPortal(<div ref={popup} className="tree-menu" role="menu" aria-label={label}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const buttons = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus()
      }}>
      {items.map((item, index) => item.action ? <button key={index} type="button"
        role={item.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={item.checked}
        disabled={item.disabled} onClick={() => { close(); item.action?.() }}>
        <span>{item.label}</span>{item.checked !== undefined && <span aria-hidden="true">{item.checked ? '✓' : ''}</span>}
      </button> : <div key={index} className="tree-menu-label">{item.label}</div>)}
    </div>, document.body)}
  </>
}
