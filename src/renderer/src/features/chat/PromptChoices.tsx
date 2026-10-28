import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

export default function PromptChoices({ options, label, disabled = false, disabledIndices = [], autoFocus = true, onChoose, custom }: {
  options: string[]; label: string; disabled?: boolean; autoFocus?: boolean
  disabledIndices?: number[]
  onChoose: (index: number) => void
  custom?: { value: string; optional?: boolean; onChange: (value: string) => void; onSubmit: () => void }
}) {
  const id = useId()
  const list = useRef<HTMLOListElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(() => {
    const first = options.findIndex((_, index) => !disabledIndices.includes(index))
    return first < 0 ? options.length : first
  })
  const [keyboard, setKeyboard] = useState(true)
  const count = options.length + Number(Boolean(custom))
  useEffect(() => {
    if (!autoFocus) return
    const previous = document.activeElement as HTMLElement | null
    ;(options.length ? list.current : input.current)?.focus({ preventScroll: true })
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  function activate(index: number) {
    setActive(index); setKeyboard(true)
    ;(custom && index === options.length ? input.current : list.current)?.focus({ preventScroll: true })
  }
  function navigate(event: KeyboardEvent) {
    if (disabled || event.nativeEvent.isComposing) return
    const editing = event.target === input.current
    let next: number | undefined
    if (event.key === 'ArrowDown') next = (active + 1) % count
    else if (event.key === 'ArrowUp') next = (active - 1 + count) % count
    else if (!editing && event.key === 'Home') next = 0
    else if (!editing && event.key === 'End') next = count - 1
    if (next !== undefined) {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1
      for (let tries = 0; tries < count && disabledIndices.includes(next); tries++) next = (next + direction + count) % count
      if (!disabledIndices.includes(next)) activate(next)
    }
    else if (event.key === 'Enter' && (event.target === list.current || editing)) {
      event.preventDefault()
      if (custom && active === options.length) custom.onSubmit()
      else if (!disabledIndices.includes(active)) onChoose(active)
    }
  }
  return <ol ref={list} className="prompt-choices" role="listbox" aria-label={label}
    aria-disabled={disabled} aria-activedescendant={`${id}-${active}`} tabIndex={disabled ? -1 : 0} onKeyDown={navigate}>
    {options.map((option, index) => <li key={`${index}:${option}`} id={`${id}-${index}`} role="option"
      aria-selected={keyboard && active === index} aria-disabled={disabled || disabledIndices.includes(index)} className={keyboard && active === index ? 'is-highlighted' : ''}>
      <button type="button" tabIndex={-1} disabled={disabled || disabledIndices.includes(index)} onMouseDown={event => event.preventDefault()} onClick={() => onChoose(index)}>
        <span className="prompt-choice-number">{index + 1}.</span><span>{option}</span>
      </button>
    </li>)}
    {custom && <li id={`${id}-${options.length}`} role="option" aria-selected={keyboard && active === options.length}
      className={`prompt-custom-choice${!options.length ? ' prompt-text-only' : ''}${keyboard && active === options.length ? ' is-highlighted' : ''}`}>
      <label>{options.length > 0 && <span className="prompt-choice-number">{options.length + 1}.</span>}<span className="prompt-custom-label">Your answer{custom.optional && <small>Optional</small>}</span>
        <input ref={input} aria-label={`Your answer: ${label}`} required={!custom.optional} placeholder={custom.optional ? 'Type an answer or press Enter to skip…' : 'Type your answer…'} maxLength={4000} value={custom.value} disabled={disabled}
          onFocus={() => setActive(options.length)} onPointerDown={() => { setActive(options.length); setKeyboard(false) }}
          onChange={event => custom.onChange(event.target.value)} />
      </label>
      <button type="button" className="prompt-text-action" disabled={disabled || !custom.optional && !custom.value.trim()} onClick={custom.onSubmit}>Submit</button>
    </li>}
  </ol>
}
