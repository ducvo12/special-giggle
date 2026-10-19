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
  onChange,
  onBack
}: {
  connections: SavedConnection[]
  onChange: (next: SavedConnection[]) => void
  onBack: () => void
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
        ? { id: item.id, name: item.name, baseUrl: item.baseUrl, model: item.model, apiKey: '' }
        : emptyConnection()
    )
    setModels([])
    setError('')
    setNotice('')
    setDeleting(null)
  }

  function field(key: keyof ConnectionDraft, value: string | boolean) {
    setEditing(current => (current ? { ...current, [key]: value } : null))
    setError('')
    setNotice('')

    if (key === 'baseUrl' || key === 'apiKey') {
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

      if (!editing.model && result.value[0]) {
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

  return (
    <main className="settings-main">
      <header>
        <span>
          Settings
        </span>

        <button className="quiet-button" onClick={onBack}>
          Back to chat
        </button>
      </header>

      <div className="settings-content">
        <div className="settings-title">
          <div>
            <div className="eyebrow">
              PREFERENCES
            </div>

            <h1>
              Settings
            </h1>
          </div>
        </div>

        <div className="settings-tabs">
          <button aria-current="page">
            Connections
          </button>
        </div>

        <div className="section-heading">
          <div>
            <h2>
              Model connections
            </h2>

            <p>
              Bring a local server or an OpenAI-compatible API.
            </p>
          </div>

          {!editing && (
            <button onClick={() => edit()}>
              + Add connection
            </button>
          )}
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

        {editing ? (
          <ConnectionEditor
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
        ) : (
          <ConnectionList
            connections={connections}
            deleting={deleting}
            busy={busy}
            onEdit={edit}
            onDeleteRequest={setDeleting}
            onDelete={remove}
          />
        )}

        <p className="settings-footnote">
          Connections are saved on this device. Model inference runs at the endpoint you choose.
        </p>
      </div>
    </main>
  )
}
