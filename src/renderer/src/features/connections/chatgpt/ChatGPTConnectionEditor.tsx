import { useEffect, useState, type FormEvent, type RefObject } from 'react'
import type { ConnectionDraft } from '../../../../../shared/chat'
import type { ChatGPTAccount } from '../../../../../shared/harness'

type Props = {
  editing: ConnectionDraft
  busy: boolean
  models: string[]
  nameInput: RefObject<HTMLInputElement | null>
  field: (key: keyof ConnectionDraft, value: string | boolean) => void
  onSave: (event: FormEvent) => Promise<void>
  onCancel: () => void
  onLoadModels: () => Promise<void>
}

export default function ChatGPTConnectionEditor({
  editing,
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
        if (signingIn || !account?.signedIn || !account.planEnabled) {
          event.preventDefault()
        } else {
          void onSave(event)
        }
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

      <fieldset disabled={busy || signingIn}>
        <label>
          Connection type

          <select value="chatgpt" onChange={event => field('provider', event.target.value)}>
            <option value="openai">
              API connection
            </option>

            <option value="chatgpt">
              ChatGPT account
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
            onChange={event => field('name', event.target.value)}
          />
        </label>

        <p className="connection-intro">
          Use your eligible ChatGPT plan with Granite’s own agent runtime. Codex is not required.
        </p>

        <label>
          ChatGPT account

          <select
            value={editing.accountId ?? ''}
            onChange={event => {
              field('accountId', event.target.value)
              field('model', '')
            }}
          >
            <option value="">
              Connect a new account
            </option>

            {accounts.map(item => (
              <option key={item.id} value={item.id}>
                {item.email}{item.signedIn ? '' : ' · signed out'}
              </option>
            ))}
          </select>
        </label>

        <div className="connect-actions">
          <button type="button" onClick={() => void login()}>
            Continue with ChatGPT
          </button>

          {account?.signedIn && (
            <button type="button" className="quiet-button" onClick={() => void signOut()}>
              Sign out of Granite
            </button>
          )}
        </div>

        <div className="model-field">
          <label>
            Default model

            <select
              value={editing.model}
              onChange={event => field('model', event.target.value)}
              disabled={!account?.planEnabled}
            >
              <option value="">
                Automatic · first available model
              </option>

              {editing.model && !models.includes(editing.model) && (
                <option value={editing.model}>
                  {editing.model}
                </option>
              )}

              {models.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="quiet-button"
            disabled={!account?.planEnabled}
            onClick={() => void onLoadModels()}
          >
            Load models
          </button>
        </div>

        <p className="connection-intro">
          This connection includes all models available to this account in Granite. Choose a model beside Send; you do not need separate connections.
        </p>

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

          <small>
            Supported effort levels depend on the selected model. Higher effort can use more time and account allowance.
          </small>
        </label>
      </fieldset>

      {signingIn && (
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
        <p>
          Granite manages this sign-in independently of Codex. Credentials are encrypted on this device. Model access and usage follow your ChatGPT account’s permissions and limits.
        </p>

        <div>
          <button type="button" className="quiet-button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>

          <button
            type="submit"
            disabled={
              busy || signingIn || !account?.signedIn || !account.planEnabled
            }
          >
            Save connection
          </button>
        </div>
      </div>
    </form>
  )
}
