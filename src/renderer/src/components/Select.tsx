import { Children, isValidElement, useId, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

type OptionProps = { value: string; disabled?: boolean; children?: ReactNode }
export function SelectOption(_props: OptionProps) { return null }
function textOf(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : String(child)).join('')
}

type Props = {
  value: string
  onChange: (event: { target: { value: string } }) => void
  children: ReactNode
  disabled?: boolean
  title?: string
  'aria-label'?: string
  editable?: boolean
  required?: boolean
  placeholder?: string
}

export default function Select({ value, onChange, children, disabled, title, editable, required, placeholder, 'aria-label': ariaLabel }: Props) {
  const options: OptionProps[] = []
  function collect(nodes: ReactNode) {
    Children.forEach(nodes, child => {
      if (!isValidElement<OptionProps>(child)) return
      if (child.type === SelectOption) options.push(child.props)
      else collect(child.props.children)
    })
  }
  collect(children)
  const id = useId()
  const control = useRef<HTMLButtonElement & HTMLInputElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<{
    left: number; top?: number; bottom?: number; width: number; maxHeight: number
  }>({ left: 0, top: 0, width: 0, maxHeight: 260 })
  const search = useRef({ text: '', time: 0 })
  const available = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0)
  const selected = options.find(option => option.value === value)

  function show() {
    if (control.current?.matches(':disabled')) return
    const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
    setActive(selectedIndex >= 0 ? selectedIndex : available[0] ?? 0)
    setOpen(true)
  }
  function choose(index: number) {
    const option = options[index]
    if (!option || option.disabled || control.current?.matches(':disabled')) return
    onChange({ target: { value: option.value } })
    setOpen(false)
    control.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    if (control.current?.matches(':disabled')) { setOpen(false); return }
    const rect = control.current!.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const upwards = below < 180 && above > below
    const maxHeight = Math.min(260, upwards ? above : below)
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16)
    // Anchor the nearest edge so wrapping at the final width cannot move the menu away.
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: upwards ? undefined : rect.bottom + 4,
      bottom: upwards ? window.innerHeight - rect.top + 4 : undefined,
      width,
      maxHeight
    })
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && event.target !== control.current && !control.current?.contains(event.target as Node)) setOpen(false)
    }
    const close = () => setOpen(false)
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) close() }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open, disabled, children])

  useLayoutEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, id])

  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); if (event.key === 'Escape' && open) event.preventDefault(); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (!editable || open || event.key.startsWith('Arrow'))) {
      event.preventDefault()
      if (!open) { show(); return }
      const index = available.indexOf(active)
      setActive(event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1)! : available[(index + (event.key === 'ArrowUp' ? -1 : 1) + available.length) % available.length] ?? 0)
    } else if ((event.key === 'Enter' || (!editable && event.key === ' ')) && (open || !editable)) {
      event.preventDefault()
      if (open) choose(active); else show()
    } else if (!editable && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      const now = Date.now()
      search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase(), time: now }
      const match = available.find(index => textOf(options[index].children).trim().toLowerCase().startsWith(search.current.text))
      if (!open) show()
      if (match !== undefined) setActive(match)
    }
  }
  const common = {
    ref: control, disabled, title, role: 'combobox', 'aria-label': ariaLabel,
    'aria-expanded': open, 'aria-controls': open ? id : undefined,
    'aria-haspopup': 'listbox' as const, 'aria-activedescendant': open && options[active] ? `${id}-${active}` : undefined,
    onKeyDown: keyDown, onBlur: () => setOpen(false)
  }
  return <>
    {editable ? <input {...common} className="custom-select-input" value={value} required={required} placeholder={placeholder} aria-autocomplete="list" onClick={show} onChange={event => { onChange({ target: { value: event.target.value } }); show() }} /> :
      <button {...common} type="button" className="custom-select-trigger" onClick={() => open ? setOpen(false) : show()}>
        <span>{selected ? textOf(selected.children).trim() || selected.value : value || placeholder || 'Select…'}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>}
    {open && createPortal(<div ref={popup} id={id} role="listbox" aria-label={ariaLabel ?? 'Options'} className="custom-select-menu" style={position} onPointerDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={`${option.value}-${index}`} id={`${id}-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} className={`custom-select-option ${active === index ? 'highlighted' : ''}`} onPointerMove={() => !option.disabled && setActive(index)} onClick={() => choose(index)}>
        <span>{textOf(option.children).trim() || option.value}</span><span aria-hidden="true">{option.value === value ? '✓' : ''}</span>
      </div>)}
      {!options.length && <div className="custom-select-empty">No options available</div>}
    </div>, document.body)}
  </>
}
