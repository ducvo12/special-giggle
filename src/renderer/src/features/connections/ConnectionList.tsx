import type { SavedConnection } from '../../../../shared/chat'

type Props = {
  connections: SavedConnection[]
  deleting: string | null
  busy: boolean
  onEdit: (connection?: SavedConnection) => void
  onDeleteRequest: (id: string | null) => void
  onDelete: (id: string) => Promise<void>
}

export default function ConnectionList({
  connections,
  deleting,
  busy,
  onEdit,
  onDeleteRequest,
  onDelete
}: Props) {
  return (
    <div className="connection-list">
      {!connections.length && (
        <div className="empty-connections">
          <span>
            ⇄
          </span>

          <h2>
            No connections yet
          </h2>

          <p>
            Connect LM Studio on this device or your desktop,

            <br />

            use your ChatGPT account, or bring a compatible hosted API.
          </p>

          <button className="quiet-button" onClick={() => onEdit()}>
            Add your first connection
          </button>
        </div>
      )}

      {connections.map(item => (
        <article className="connection-card" key={item.id}>
          <div className="connection-icon">
            ⇄
          </div>

          <div className="connection-details">
            <h3>
              {item.name}
            </h3>

            <p>
              {item.model}
            </p>

            <span>
              {item.provider === 'chatgpt'
                ? `ChatGPT · ${item.effort || 'default'} reasoning`
                : item.provider === 'codex'
                  ? 'Legacy Codex connection · edit to reconnect with ChatGPT'
                  : `${item.baseUrl}${item.hasKey ? ' · Key saved' : ''}`}
            </span>
          </div>

          <div className="connection-actions">
            {deleting === item.id ? (
              <>
                <span>
                  Delete connection?
                </span>

                <button
                  className="quiet-button"
                  disabled={busy}
                  onClick={() => onDeleteRequest(null)}
                >
                  Cancel
                </button>

                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() => void onDelete(item.id)}
                >
                  Delete
                </button>
              </>
            ) : (
              <>
                <button className="quiet-button" onClick={() => onEdit(item)}>
                  Edit
                </button>

                <button
                  className="icon-button"
                  aria-label={`Delete ${item.name}`}
                  onClick={() => onDeleteRequest(item.id)}
                >
                  ×
                </button>
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}
