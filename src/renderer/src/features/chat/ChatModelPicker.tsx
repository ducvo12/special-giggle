import Select, { SelectOption } from '../../components/Select'
import type { SavedConnection } from '../../../../shared/chat'
import type { ModelSelection } from './useConnectionModel'

export default function ChatModelPicker({
  connections,
  connection,
  selection,
  disabled,
  onSelectConnection
}: {
  connections: SavedConnection[]
  connection: SavedConnection | undefined
  selection: ModelSelection
  disabled: boolean
  onSelectConnection: (id: string) => void
}) {
  return (
    <>
      <div className="composer-model">
        <Select
          aria-label="Active connection"
          title={connection?.name ?? 'Select connection'}
          value={connection?.id ?? ''}
          disabled={disabled}
          onChange={event => onSelectConnection(event.target.value)}
        >
          <SelectOption value="" disabled>
            Select connection
          </SelectOption>

          {connections.map(item => (
            <SelectOption key={item.id} value={item.id}>
              {item.provider === 'chatgpt' ? item.name : `${item.model} · ${item.name}`}
            </SelectOption>
          ))}
        </Select>
      </div>

      {connection?.provider === 'chatgpt' && (
        <>
          <div className="composer-model">
            <Select
              aria-label="ChatGPT model"
              value={selection.model}
              disabled={disabled || selection.loading || !selection.models.length}
              onChange={event => selection.select(event.target.value)}
            >
              {!selection.model && (
                <SelectOption value="">
                  {selection.loading ? 'Loading models…' : 'No models available'}
                </SelectOption>
              )}

              {selection.models.map(model => (
                <SelectOption key={model.id} value={model.id}>
                  {model.name}
                </SelectOption>
              ))}
            </Select>
          </div>

          <button
            type="button"
            className="quiet-button"
            aria-label="Refresh ChatGPT models"
            title="Refresh account models"
            disabled={disabled || selection.loading}
            onClick={selection.refresh}
          >
            ↻
          </button>
        </>
      )}
    </>
  )
}
