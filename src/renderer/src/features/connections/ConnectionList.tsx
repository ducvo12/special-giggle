import type { SavedConnection } from '../../../../shared/chat'

function OpenAIIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1683a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4947zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1683a.0757.0757 0 0 1-.071 0l-4.8303-2.7866A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1195 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4072-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1635a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813v6.7227zm1.1448-2.5833 3.0137-1.7412 3.0137 1.7412v3.4824l-3.0137 1.7413-3.0137-1.7413z" />
    </svg>
  )
}

function CustomServerIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  )
}

type Props = {
  connections: SavedConnection[]
  deleting: string | null
  busy: boolean
  onEdit: (connection?: SavedConnection) => void
  onConnect: (type: 'openai' | 'custom') => void
  onRefresh: (id: string) => Promise<void>
  onDeleteRequest: (id: string | null) => void
  onDelete: (id: string) => Promise<void>
}

export default function ConnectionList({
  connections,
  deleting,
  busy,
  onEdit,
  onConnect,
  onRefresh,
  onDeleteRequest,
  onDelete
}: Props) {
  return (
    <div className="providers-container">
      {/* 1. Connected Providers */}
      <section className="providers-section" aria-label="Connected providers">
        <h2 className="providers-section-title">Connected providers</h2>

        <div className="providers-list">
          {connections.length === 0 ? (
            <div className="provider-card-empty">
              No connected providers yet. Choose a provider below to connect.
            </div>
          ) : (
            connections.map(item => {
              const isOpenAI = item.provider === 'openai' || item.provider === 'chatgpt' || item.name.toLowerCase().includes('openai')
              const isChatGPT = item.provider === 'chatgpt'
              const isCustom = item.provider !== 'chatgpt' && (!item.baseUrl || !item.baseUrl.includes('api.openai.com'))

              return (
                <article className="provider-card" key={item.id}>
                  <div className="provider-main-info">
                    <div className="provider-icon-badge">
                      {isOpenAI && !isCustom ? <OpenAIIcon /> : <CustomServerIcon />}
                    </div>

                    <div className="provider-text">
                      <div className="provider-title-row">
                        <span className="provider-name">{item.name || (isOpenAI ? 'OpenAI' : 'Custom Provider')}</span>
                        {isCustom && <span className="provider-badge">Custom</span>}
                        {isChatGPT && <span className="provider-badge">ChatGPT</span>}
                      </div>

                      <p className="provider-description">
                        {isChatGPT
                          ? `ChatGPT account · ${item.model ? `default: ${item.model}` : 'automatic default'}`
                          : item.model
                            ? `${item.model} · ${item.baseUrl}`
                            : item.baseUrl}
                      </p>
                    </div>
                  </div>

                  <div className="provider-actions">
                    {deleting === item.id ? (
                      <div className="disconnect-confirm">
                        <span>Disconnect?</span>
                        <button
                          type="button"
                          className="quiet-button"
                          disabled={busy}
                          onClick={() => onDeleteRequest(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          disabled={busy}
                          onClick={() => void onDelete(item.id)}
                        >
                          Confirm
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="quiet-button"
                          disabled={busy}
                          onClick={() => void onRefresh(item.id)}
                          title="Reload models list"
                        >
                          Reload
                        </button>
                        <button
                          type="button"
                          className="quiet-button"
                          disabled={busy}
                          onClick={() => onEdit(item)}
                          title="Configure connection"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="disconnect-button"
                          disabled={busy}
                          onClick={() => onDeleteRequest(item.id)}
                        >
                          Disconnect
                        </button>
                      </>
                    )}
                  </div>
                </article>
              )
            })
          )}
        </div>
      </section>

      {/* 2. Popular / Available Providers */}
      <section className="providers-section" aria-label="Popular providers">
        <h2 className="providers-section-title">Popular providers</h2>

        <div className="providers-list">
          {/* OpenAI */}
          <article className="provider-card">
            <div className="provider-main-info">
              <div className="provider-icon-badge">
                <OpenAIIcon />
              </div>

              <div className="provider-text">
                <div className="provider-title-row">
                  <span className="provider-name">OpenAI</span>
                </div>
                <p className="provider-description">
                  Connect using an OpenAI API key or your ChatGPT account
                </p>
              </div>
            </div>

            <div className="provider-actions">
              <button
                type="button"
                className="connect-button"
                disabled={busy}
                onClick={() => onConnect('openai')}
              >
                + Connect
              </button>
            </div>
          </article>

          {/* OpenAI-compatible (Custom) */}
          <article className="provider-card">
            <div className="provider-main-info">
              <div className="provider-icon-badge">
                <CustomServerIcon />
              </div>

              <div className="provider-text">
                <div className="provider-title-row">
                  <span className="provider-name">OpenAI-compatible</span>
                  <span className="provider-badge">Custom</span>
                </div>
                <p className="provider-description">
                  Connect to LM Studio, Ollama, vLLM, or any compatible endpoint
                </p>
              </div>
            </div>

            <div className="provider-actions">
              <button
                type="button"
                className="connect-button"
                disabled={busy}
                onClick={() => onConnect('custom')}
              >
                + Connect
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>
  )
}
