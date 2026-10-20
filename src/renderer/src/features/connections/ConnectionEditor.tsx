import type { FormEvent, RefObject } from 'react'
import type { ConnectionDraft, SavedConnection } from '../../../../shared/chat'
import ChatGPTConnectionEditor from './chatgpt/ChatGPTConnectionEditor'

type Props = {
  editing: ConnectionDraft
  original: SavedConnection | undefined
  models: string[]
  busy: boolean
  nameInput: RefObject<HTMLInputElement | null>
  field: (key: keyof ConnectionDraft, value: string | boolean) => void
  onSave: (event: FormEvent) => Promise<void>
  onCancel: () => void
  onLoadModels: () => Promise<void>
}

export default function ConnectionEditor({
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
        editing={editing}
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
          {editing.protocol === 'responses' ? 'RESPONSES API' : 'OPENAI COMPATIBLE'}
        </span>
      </div>

      <fieldset disabled={busy}>
        <label>
          Connection type

          <select value="openai" onChange={e => field('provider', e.target.value)}>
            <option value="openai">
              OpenAI-compatible API
            </option>

            <option value="chatgpt">
              ChatGPT account
            </option>
          </select>
        </label>

        <label>
          API protocol

          <select
            value={editing.protocol ?? 'chat-completions'}
            onChange={event => field('protocol', event.target.value)}
          >
            <option value="chat-completions">
              Chat Completions · local / compatible servers
            </option>

            <option value="responses">
              Responses · OpenAI reasoning models
            </option>
          </select>
        </label>

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

            <input
              required
              list="available-models"
              value={editing.model}
              onChange={e => field('model', e.target.value)}
              placeholder="Load models or enter an ID"
            />

            <datalist id="available-models">
              {models.map(model => (
                <option key={model} value={model} />
              ))}
            </datalist>
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

        {editing.protocol === 'responses' && (
          <label>
            Reasoning effort

            <select
              value={editing.effort ?? ''}
              onChange={event => field('effort', event.target.value)}
            >
              <option value="">
                Model default
              </option>

              {['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(effort => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
        )}
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
