import { useEffect, useId, useRef, useState } from 'react'
import Select, { SelectOption } from '../../components/Select'
import type { SavedConnection } from '../../../../shared/chat'
import type { ModelSelection } from './useConnectionModel'

const effortLabel = (value: string) => value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Default'

export default function ChatModelPicker({
  connections, connection, selection, disabled, onSelectConnection
}: {
  connections: SavedConnection[]
  connection: SavedConnection | undefined
  selection: ModelSelection
  disabled: boolean
  onSelectConnection: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const control = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const slider = useRef<HTMLInputElement>(null)
  const popupId = useId()
  const levels = selection.reasoningLevels
  const supported = levels.length > 0
  const currentEffort = selection.effort || selection.defaultReasoningLevel || ''
  const index = levels.findIndex(level => level.effort === currentEffort)
  const modelName = selection.models.find(model => model.id === selection.model)?.name || selection.model
  const canOpen = supported || (connection?.provider === 'chatgpt' && !selection.locked)

  useEffect(() => {
    setOpen(false)
  }, [connection?.id, disabled, selection.locked])

  useEffect(() => {
    if (!open) return
    slider.current?.focus()
    const close = (event: PointerEvent) => {
      if ((event.target as Element).closest('.custom-select-menu')) return
      if (!control.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <>
      <div className="composer-model">
        <Select
          aria-label="Active connection"
          title={selection.locked ? 'Start a new chat to change connections' : 'Select connection'}
          value={connection?.id ?? ''}
          disabled={disabled || selection.locked}
          onChange={event => onSelectConnection(event.target.value)}
        >
          <SelectOption value="" disabled>Select connection</SelectOption>
          {connections.map(item => (
            <SelectOption key={item.id} value={item.id}>{item.name}</SelectOption>
          ))}
        </Select>
      </div>

      {connection && (
        <div className="composer-model effort-control" ref={control}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              trigger.current?.focus()
            }
          }}
        >
          <button
            ref={trigger}
            type="button"
            className="quiet-button effort-trigger"
            aria-label={`${modelName || 'Model'} · ${effortLabel(currentEffort)} reasoning`}
            aria-expanded={open}
            aria-controls={open ? popupId : undefined}
            aria-haspopup="dialog"
            disabled={disabled || selection.loading || !canOpen}
            onClick={() => setOpen(value => !value)}
          >
            <span className="effort-model-name">{modelName || (selection.loading ? 'Loading models…' : 'No models available')}</span>
            {supported && <span className="effort-value">{effortLabel(currentEffort)} ▾</span>}
          </button>

          {open && !disabled && (
            <div id={popupId} role="dialog" aria-label="Model and reasoning" className="effort-popup">
              {supported && (
                <>
                  <div className="effort-heading">
                    <strong>{effortLabel(currentEffort)}</strong>
                  </div>
                </>
              )}
              {connection.provider === 'chatgpt' && (
                <Select
                  aria-label="ChatGPT model"
                  value={selection.model}
                  disabled={selection.locked || selection.loading}
                  title={selection.locked ? 'Start a new chat to change models' : 'Select model'}
                  onChange={event => selection.select(event.target.value)}
                >
                  {selection.models.map(model => (
                    <SelectOption key={model.id} value={model.id}>{model.name}</SelectOption>
                  ))}
                </Select>
              )}
              {connection.provider !== 'chatgpt' && <div className="effort-model-caption">{modelName}</div>}
              {supported && (
                <>
                  <div className="effort-slider-track">
                    <div className="effort-slider-dots" aria-hidden="true">
                      {levels.map(level => <span key={level.effort} />)}
                    </div>
                    <input
                      ref={slider}
                      type="range"
                      aria-label="Reasoning effort"
                      aria-valuetext={effortLabel(currentEffort)}
                      min={0}
                      max={Math.max(0, levels.length - 1)}
                      step={1}
                      value={Math.max(0, index)}
                      disabled={levels.length < 2}
                      onChange={event => selection.selectEffort(levels[Number(event.target.value)].effort)}
                    />
                  </div>

                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
