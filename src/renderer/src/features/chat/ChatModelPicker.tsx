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
        <select
          aria-label="Active connection"
          title={connection?.name ?? 'Select connection'}
          value={connection?.id ?? ''}
          disabled={disabled}
          onChange={event => onSelectConnection(event.target.value)}
        >
          <option value="" disabled>
            Select connection
          </option>

          {connections.map(item => (
            <option key={item.id} value={item.id}>
              {item.provider === 'chatgpt' ? item.name : `${item.model} · ${item.name}`}
            </option>
          ))}
        </select>

        <span aria-hidden="true">
          ⌄
        </span>
      </div>

      {connection?.provider === 'chatgpt' && (
        <>
          <div className="composer-model">
            <select
              aria-label="ChatGPT model"
              value={selection.model}
              disabled={disabled || selection.loading || !selection.models.length}
              onChange={event => selection.select(event.target.value)}
            >
              {!selection.model && (
                <option value="">
                  {selection.loading ? 'Loading models…' : 'No models available'}
                </option>
              )}

              {selection.models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>

            <span aria-hidden="true">
              ⌄
            </span>
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
