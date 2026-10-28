import Select, { SelectOption } from '../../components/Select'
import type { FormEvent, RefObject } from 'react'
import type { ConnectionDraft, SavedConnection } from '../../../../shared/chat'
import ChatGPTConnectionEditor from './chatgpt/ChatGPTConnectionEditor'

type Props = {
  connections: SavedConnection[]
  editing: ConnectionDraft
  original: SavedConnection | undefined
  models: string[]
  busy: boolean
  nameInput: RefObject<HTMLInputElement | null>
  field: (key: keyof ConnectionDraft, value: string | boolean | number | undefined) => void
  onSave: (event: FormEvent) => Promise<void>
  onCancel: () => void
  onLoadModels: () => Promise<void>
}

export default function ConnectionEditor({
  connections,
  editing,
  original,
  models,
  busy,
  nameInput,
  field,
  onSave,
  onCancel,
  onLoadModels
}: Props) {
  const changedEndpoint =
    original && original.baseUrl !== editing.baseUrl.trim().replace(/\/+$/, '')

  if (editing.provider === 'chatgpt') {
    return (
      <ChatGPTConnectionEditor
        connections={connections}
        editing={editing}
        original={original}
        busy={busy}
        models={models}
        onLoadModels={onLoadModels}
        field={field}
        onSave={onSave}
        onCancel={onCancel}
        nameInput={nameInput}
      />
    )
  }

  return (
    <form className="connection-editor" onSubmit={onSave}>
      <div className="editor-heading">
        <h2>
          {editing.id ? 'Edit connection' : 'New connection'}
        </h2>

        <span className="badge">
          OPENAI COMPATIBLE
        </span>
      </div>

      <fieldset disabled={busy}>
        <label>
          Connection name

          <input
            ref={nameInput}
            required
            maxLength={100}
            value={editing.name}
            onChange={e => field('name', e.target.value)}
            placeholder="Home desktop"
          />
        </label>

        <label>
          API base URL

          <input
            required
            type="url"
            value={editing.baseUrl}
            onChange={e => field('baseUrl', e.target.value)}
            placeholder="http://100.x.x.x:1234/v1"
          />

          <small>
            Include the API prefix, usually /v1. Use your desktop’s IP for remote LM Studio.
          </small>
        </label>

        <label>
          API key{' '}

          <span className="optional">
            Optional
          </span>

          <input
            type="password"
            autoComplete="new-password"
            disabled={editing.removeKey}
            value={editing.apiKey}
            onChange={e => field('apiKey', e.target.value)}
            placeholder={
              original?.hasKey
                ? 'Saved securely · leave blank to keep'
                : 'Only if the server requires one'
            }
          />
        </label>

        {original?.hasKey && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={Boolean(editing.removeKey)}
              onChange={e => {
                field('removeKey', e.target.checked)

                if (e.target.checked) {
                  field('apiKey', '')
                }
              }}
            />

            {' '}Remove saved API key
          </label>
        )}

        {changedEndpoint && original.hasKey && (
          <p className="field-hint">
            The URL changed. Re-enter the key or remove the saved key before saving.
          </p>
        )}

        <div className="model-field">
          <label>
            Model ID

            <Select editable required aria-label="Model ID" value={editing.model}
              onChange={event => field('model', event.target.value)}
              placeholder="Load models or enter an ID">
              {models.map(model => <SelectOption key={model} value={model}>{model}</SelectOption>)}
            </Select>
          </label>

          <button
            type="button"
            className="quiet-button"
            onClick={() => void onLoadModels()}
            disabled={!editing.baseUrl.trim()}
          >
            {busy ? 'Checking…' : 'Load models'}
          </button>
        </div>

        <label>
          Concurrent model requests
          <input
            type="number"
            min={1}
            max={32}
            value={editing.maxConcurrentRequests ?? ''}
            placeholder="Automatic: local 1, remote 2"
            onChange={event => field('maxConcurrentRequests', event.target.value ? Number(event.target.value) : undefined)}
          />
          <small>Lower this if your model host handles only one request at a time. Other chats wait in line.</small>
        </label>

        <label>
          Default reasoning effort

          <Select
            value={editing.effort ?? ''}
            onChange={event => field('effort', event.target.value)}
          >
            <SelectOption value="">
              Model default
            </SelectOption>

            {['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(effort => (
              <SelectOption key={effort} value={effort}>
                {effort}
              </SelectOption>
            ))}
          </Select>
        </label>
      </fieldset>

      <div className="editor-footer">
        <p>
          Keys are encrypted with your system’s credential protection.
        </p>

        <div>
          <button type="button" className="quiet-button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>

          <button disabled={busy} type="submit">
            {busy ? 'Working…' : 'Save connection'}
          </button>
        </div>
      </div>
    </form>
  )
}
