import { useEffect, useState, type FormEvent } from 'react'
import type { Agent } from '../../../../shared/agent'

type Props = {
  agent: Agent
  creating: boolean
  busy: boolean
  onDirty: (dirty: boolean) => void
  onCreated: (agent: Agent) => Promise<void>
  onBack: () => void
}

export default function AgentSettings({
  agent,
  creating,
  busy,
  onDirty,
  onCreated,
  onBack
}: Props) {
  const [name, setName] = useState('')
  const [identity, setIdentity] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(!creating)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const dirty = !creating && identity !== original

  useEffect(() => {
    onDirty(dirty)

    return () => onDirty(false)
  }, [dirty, onDirty])

  useEffect(() => {
    if (creating) {
      return
    }

    let mounted = true
    void window.granite.workspace
      .read(agent.id, '/identity.md')
      .then(result => {
        if (!mounted) {
          return
        }

        if (result.ok) {
          setIdentity(result.value)
          setOriginal(result.value)
        } else {
          setError(result.error)
        }

        setLoading(false)
      })
      .catch(() => {
        if (mounted) {
          setError('Could not load this identity.')
          setLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [agent.id, creating])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')

    try {
      if (creating) {
        const result = await window.granite.agents.create(name)

        if (!result.ok) {
          setError(result.error)

          return
        }

        await onCreated(result.value)
      } else {
        const result = await window.granite.agents.saveIdentity(agent.id, identity, original)

        if (!result.ok) {
          setError(result.error)

          return
        }

        setOriginal(result.value)
        setNotice('Identity saved. Your agent will use it on the next message.')
      }
    } catch {
      setError('Could not save the agent. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="settings-main">
      <header>
        <span>
          {creating ? 'New agent' : `${agent.name} / Identity`}
        </span>

        <button className="quiet-button" disabled={dirty || saving} onClick={onBack}>
          Back to chat
        </button>
      </header>

      <div className="settings-content">
        <div className="eyebrow">
          YOUR AGENTS
        </div>

        <h1>
          {creating ? 'Someone new.' : agent.name}
        </h1>

        <p className="agent-description">
          {creating
            ? 'Give your agent a name. It will have its own identity, memory, notes, and conversations.'
            : 'Shape how this agent speaks and behaves. The model reads this identity file before every turn.'}
        </p>

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

        <form className="connection-editor" onSubmit={submit}>
          {creating ? (
            <label>
              Agent name

              <input
                aria-label="Agent name"
                autoFocus
                required
                maxLength={80}
                value={name}
                disabled={saving}
                onChange={event => setName(event.target.value)}
                placeholder="e.g. Nova"
              />
            </label>
          ) : (
            <label>
              identity.md

              <textarea
                className="identity-editor"
                aria-label="Agent identity"
                rows={12}
                maxLength={32_000}
                disabled={loading || saving || busy}
                value={identity}
                onChange={event => {
                  setIdentity(event.target.value)
                  setNotice('')
                }}
              />

              <small>
                You can edit this file. The agent cannot change its own identity. Save or discard changes before switching views.
              </small>
            </label>
          )}

          <div className="editor-footer">
            <div>
              {dirty && (
                <button
                  type="button"
                  className="quiet-button"
                  disabled={saving}
                  onClick={() => {
                    setIdentity(original)
                    setError('')
                  }}
                >
                  Discard changes
                </button>
              )}

              <button
                type="submit"
                disabled={
                  saving ||
                  busy ||
                  loading ||
                  (creating ? !name.trim() : !dirty || !identity.trim())
                }
              >
                {saving ? 'Saving…' : creating ? 'Create agent' : 'Save identity'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </main>
  )
}
