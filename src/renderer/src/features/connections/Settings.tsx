import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ConnectionDraft, SavedConnection } from '../../../../shared/chat'
import ConnectionEditor from './ConnectionEditor'
import ConnectionList from './ConnectionList'

const emptyConnection = (): ConnectionDraft => ({
  name: '',
  baseUrl: 'http://127.0.0.1:1234/v1',
  apiKey: '',
  model: ''
})

const bridgeError = 'Could not communicate with the desktop backend.'

export default function Settings({
  connections,
  onChange
}: {
  connections: SavedConnection[]
  onChange: (next: SavedConnection[]) => void
}) {
  const [editing, setEditing] = useState<ConnectionDraft | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      nameInput.current?.focus()
    }
  }, [editing?.id, editing === null])

  const original = connections.find(item => item.id === editing?.id)

  function edit(item?: SavedConnection) {
    setEditing(
      item
        ? {
            id: item.id,
            name: item.name,
            baseUrl: item.baseUrl,
            model: item.model,
            apiKey: '',
            provider: item.provider === 'codex' ? 'chatgpt' : item.provider,
            protocol: item.protocol,
            accountId: item.accountId,
            effort: item.effort,
            maxConcurrentRequests: item.maxConcurrentRequests
          }
        : emptyConnection()
    )
    setModels([])
    setError('')
    setNotice('')
    setDeleting(null)
  }

  function field(key: keyof ConnectionDraft, value: string | boolean | number | undefined) {
    setEditing(current => {
      if (!current) {
        return null
      }

      if (key === 'provider') {
        return {
          ...emptyConnection(),
          id: current.id,
          provider: value as 'openai' | 'chatgpt',
          name: current.name || (value === 'chatgpt' ? 'ChatGPT' : ''),
          ...(value === 'chatgpt'
            ? { baseUrl: '', accountId: '', protocol: 'responses' as const, effort: '' }
            : {})
        }
      }

      return { ...current, [key]: value }
    })
    setError('')
    setNotice('')

    if (
      key === 'baseUrl' ||
      key === 'apiKey' ||
      key === 'provider' ||
      key === 'accountId' ||
      key === 'protocol'
    ) {
      setModels([])
    }
  }

  async function loadModels() {
    if (!editing) {
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    try {
      const result = await window.granite.models(editing)

      if (!result.ok) {
        setError(result.error)

        return
      }

      setModels(result.value)

      if (
        (!editing.model ||
          (editing.provider === 'chatgpt' && !result.value.includes(editing.model))) &&
        result.value[0]
      ) {
        field('model', result.value[0])
      }

      setNotice(
        result.value.length
          ? `Connected · ${result.value.length} model${result.value.length === 1 ? '' : 's'} available`
          : 'Connected · no models listed. Enter a model ID below.'
      )
    } catch {
      setError(bridgeError)
    } finally {
      setBusy(false)
    }
  }

  async function refreshModels(id: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await window.granite.connections.models(id, true)
      if (!result.ok) {
        setError(result.error)
        return
      }
      window.dispatchEvent(new CustomEvent('granite:models-refreshed', {
        detail: { connectionId: id, models: result.value }
      }))
      setNotice(`Reloaded · ${result.value.length} models available`)
    } catch {
      setError(bridgeError)
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()

    if (!editing) {
      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await window.granite.connections.save(editing)

      if (!result.ok) {
        setError(result.error)

        return
      }

      onChange([...connections.filter(item => item.id !== result.value.id), result.value])
      setEditing(null)
      setNotice('Connection saved.')
    } catch {
      setError(bridgeError)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    setError('')

    try {
      const result = await window.granite.connections.delete(id)

      if (!result.ok) {
        setError(result.error)

        return
      }

      onChange(connections.filter(item => item.id !== id))
      setDeleting(null)
      setNotice('Connection deleted.')
    } catch {
      setError(bridgeError)
    } finally {
      setBusy(false)
    }
  }

  function handleConnect(type: 'openai' | 'custom') {
    if (type === 'openai') {
      setEditing({
        name: 'OpenAI',
        baseUrl: '',
        apiKey: '',
        model: '',
        provider: 'chatgpt',
        protocol: 'responses'
      })
    } else {
      setEditing({
        name: 'OpenAI-compatible',
        baseUrl: 'http://127.0.0.1:1234/v1',
        apiKey: '',
        model: '',
        provider: 'openai',
        protocol: 'chat-completions'
      })
    }
    setModels([])
    setError('')
    setNotice('')
    setDeleting(null)
  }

  return (
    <main className="settings-main">
      <div className="settings-content">
        {editing ? (
          <>
            <button
              type="button"
              className="settings-back quiet-button"
              onClick={() => {
                setEditing(null)
                setError('')
                setNotice('')
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5m7 7-7-7 7-7" />
              </svg>
              <span>Back to providers</span>
            </button>

            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}

            {notice && (
              <div className="notice" role="status">
                {notice}
              </div>
            )}

            <ConnectionEditor
              connections={connections}
              editing={editing}
              original={original}
              models={models}
              busy={busy}
              nameInput={nameInput}
              field={field}
              onSave={save}
              onCancel={() => {
                setEditing(null)
                setError('')
                setNotice('')
              }}
              onLoadModels={loadModels}
            />
          </>
        ) : (
          <>
            <div className="settings-header">
              <h1 className="settings-category-title">
                Providers
              </h1>
            </div>

            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}

            {notice && (
              <div className="notice" role="status">
                {notice}
              </div>
            )}

            <ConnectionList
              connections={connections}
              deleting={deleting}
              busy={busy}
              onEdit={edit}
              onConnect={handleConnect}
              onRefresh={refreshModels}
              onDeleteRequest={setDeleting}
              onDelete={remove}
            />

            <p className="settings-footnote">
              Connections are saved on this device. Granite manages agent behavior. Inference runs with the provider you choose.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
