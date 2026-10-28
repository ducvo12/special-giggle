import Select, { SelectOption } from '../../../components/Select'
import { useEffect, useState, type FormEvent, type RefObject } from 'react'
import type { ConnectionDraft, SavedConnection } from '../../../../../shared/chat'
import type { ChatGPTAccount } from '../../../../../shared/harness'

type Props = {
  connections: SavedConnection[]
  editing: ConnectionDraft
  original?: SavedConnection
  busy: boolean
  models: string[]
  nameInput: RefObject<HTMLInputElement | null>
  field: (key: keyof ConnectionDraft, value: string | boolean | number | undefined) => void
  onSave: (event: FormEvent) => Promise<void>
  onCancel: () => void
  onLoadModels: () => Promise<void>
}

export default function ChatGPTConnectionEditor({
  connections,
  editing,
  original,
  busy,
  models,
  nameInput,
  field,
  onSave,
  onCancel,
  onLoadModels
}: Props) {
  const [accounts, setAccounts] = useState<ChatGPTAccount[]>([])
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [authMethod, setAuthMethod] = useState<'oauth' | 'apiKey'>(() => {
    if (editing.apiKey || (original?.hasKey && !editing.accountId)) {
      return 'apiKey'
    }
    return 'oauth'
  })
  const account = accounts.find(item => item.id === editing.accountId)

  useEffect(() => {
    let mounted = true
    void window.granite.chatgpt
      .accounts()
      .then(result => {
        if (!mounted) {
          return
        }

        if (result.ok) {
          setAccounts(result.value)
        } else {
          setError(result.error)
        }
      })
      .catch(() => {
        if (mounted) {
          setError('Could not load saved accounts.')
        }
      })

    return () => {
      mounted = false
      void window.granite.chatgpt.cancelLogin()
    }
  }, [])

  async function login() {
    setSigningIn(true)
    setError('')

    try {
      const result = await window.granite.chatgpt.login(account?.id)

      if (!result.ok) {
        setError(result.error)

        return
      }

      setAccounts(current => [...current.filter(item => item.id !== result.value.id), result.value])
      const duplicate = connections.find(item =>
        item.id !== editing.id && item.accountId === result.value.id &&
        (item.provider === 'chatgpt' || item.provider === 'codex')
      )
      if (duplicate) {
        setError(`This account is already connected as “${duplicate.name}”. Sign in with a different account.`)
        return
      }
      field('accountId', result.value.id)
      field('model', '')

      if (!result.value.planEnabled) {
        setError(
          'Signed in, but ChatGPT plan use was not granted. Continue with ChatGPT to authorize plan access.'
        )
      }
    } catch {
      setError('Could not complete sign-in. Try again.')
    } finally {
      setSigningIn(false)
    }
  }

  async function signOut() {
    if (!account) {
      return
    }

    setSigningIn(true)

    try {
      const result = await window.granite.chatgpt.signOut(account.id)

      if (!result.ok) {
        setError(result.error)

        return
      }

      setAccounts(current =>
        current.map(item =>
          item.id === account.id ? { ...item, signedIn: false, planEnabled: false } : item
        )
      )
      setNotice(
        result.value.revoked
          ? 'Signed out of Granite.'
          : 'Signed out locally. Remote revocation was not confirmed; you can disconnect Granite in ChatGPT Settings.'
      )
    } catch {
      setError('Could not sign out. Try again.')
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <form
      className="connection-editor"
      onSubmit={event => {
        if (authMethod === 'oauth') {
          if (signingIn || !account?.signedIn || !account.planEnabled || !editing.name.trim()) {
            event.preventDefault()
            return
          }
        } else {
          if (!editing.name.trim() || (!editing.apiKey.trim() && !original?.hasKey)) {
            event.preventDefault()
            return
          }
        }
        void onSave(event)
      }}
    >
      <div className="editor-heading">
        <h2>
          {editing.id ? 'Edit connection' : 'New connection'}
        </h2>

        <span className="badge">
          CHATGPT
        </span>
      </div>

      <fieldset disabled={busy || (authMethod === 'oauth' && signingIn)}>
        <label>
          Connection name

          <input
            ref={nameInput}
            required
            maxLength={100}
            value={editing.name}
            onChange={event => field('name', event.target.value)}
          />
        </label>

        <div className="auth-method-field">
          <span className="field-label">Authentication method</span>
          <div className="auth-choice-group" role="radiogroup" aria-label="Authentication method">
            <label className={`auth-choice-option ${authMethod === 'oauth' ? 'active' : ''}`}>
              <input
                type="radio"
                name="authMethod"
                value="oauth"
                checked={authMethod === 'oauth'}
                onChange={() => setAuthMethod('oauth')}
              />
              <span className="auth-choice-label">ChatGPT account (OAuth)</span>
            </label>

            <label className={`auth-choice-option ${authMethod === 'apiKey' ? 'active' : ''}`}>
              <input
                type="radio"
                name="authMethod"
                value="apiKey"
                checked={authMethod === 'apiKey'}
                onChange={() => setAuthMethod('apiKey')}
              />
              <span className="auth-choice-label">API key</span>
            </label>
          </div>
        </div>

        {authMethod === 'oauth' ? (
          <div className="chatgpt-account">
            <span className="field-hint">ChatGPT account</span>
            <span>{account?.email ?? 'No account connected'}</span>
            <div className="connect-actions">
              {(!account?.signedIn || !account.planEnabled) && (
                <button type="button" onClick={() => void login()}>
                  {account ? 'Sign in again' : 'Connect ChatGPT account'}
                </button>
              )}

              {account?.signedIn && (
                <button type="button" className="quiet-button" onClick={() => void signOut()}>
                  Sign out of Granite
                </button>
              )}
            </div>
          </div>
        ) : (
          <label>
            API key
            <input
              type="password"
              autoComplete="new-password"
              required={!original?.hasKey}
              placeholder={original?.hasKey ? 'Saved key (enter new key to replace)' : 'sk-...'}
              value={editing.apiKey}
              onChange={event => field('apiKey', event.target.value)}
            />
          </label>
        )}

        <div className="model-field">
          <label>
            Default model

            <Select
              editable
              value={editing.model}
              onChange={event => field('model', event.target.value)}
              disabled={authMethod === 'oauth' && !account?.planEnabled}
              placeholder="Automatic · first available model"
            >
              <SelectOption value="">
                Automatic · first available model
              </SelectOption>

              {editing.model && !models.includes(editing.model) && (
                <SelectOption value={editing.model}>
                  {editing.model}
                </SelectOption>
              )}

              {models.map(model => (
                <SelectOption key={model} value={model}>
                  {model}
                </SelectOption>
              ))}
            </Select>
          </label>

          <button
            type="button"
            className="quiet-button"
            disabled={authMethod === 'oauth' ? !account?.planEnabled : !editing.apiKey.trim() && !original?.hasKey}
            onClick={() => void onLoadModels()}
          >
            Load models
          </button>
        </div>

        <label>
          Concurrent model requests
          <input type="number" min={1} max={32} value={editing.maxConcurrentRequests ?? ''} placeholder="Automatic: 2"
            onChange={event => field('maxConcurrentRequests', event.target.value ? Number(event.target.value) : undefined)} />
          <small>Other chats wait in line when this account is at capacity.</small>
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

      {authMethod === 'oauth' && signingIn && (
        <div className="connect-actions" role="status">
          <span>
            Complete the account action in your browser.
          </span>

          <button
            type="button"
            className="quiet-button"
            onClick={() => void window.granite.chatgpt.cancelLogin()}
          >
            Cancel sign-in
          </button>
        </div>
      )}

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

      <div className="editor-footer">
        <div>
          <button type="button" className="quiet-button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>

          <button
            type="submit"
            disabled={
              busy ||
              (authMethod === 'oauth'
                ? signingIn || !account?.signedIn || !account.planEnabled || !editing.name.trim()
                : !editing.name.trim() || (!editing.apiKey.trim() && !original?.hasKey))
            }
          >
            Save connection
          </button>
        </div>
      </div>
    </form>
  )
}
