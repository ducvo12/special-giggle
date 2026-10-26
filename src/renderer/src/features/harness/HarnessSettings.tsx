import Select, { SelectOption } from '../../components/Select'
import { useEffect, useState } from 'react'
import type { Agent } from '../../../../shared/agent'
import {
  defaultHarnessSettings,
  type HarnessSettings as Settings
} from '../../../../shared/harness'
import SkillsEditor from './SkillsEditor'

export default function HarnessSettings({
  agent,
  busy,
  onBack,
  onDirty
}: {
  agent: Agent
  busy: boolean
  onBack: () => void
  onDirty: (dirty: boolean) => void
}) {
  const [settings, setSettings] = useState<Settings>(structuredClone(defaultHarnessSettings))
  const [saved, setSaved] = useState('')
  const [skillDirty, setSkillDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const settingsDirty = Boolean(saved) && JSON.stringify(settings) !== saved
  const dirty = settingsDirty || skillDirty
  const disabled = busy || working || loading

  useEffect(() => {
    let mounted = true
    void window.granite.harness
      .get(agent.id)
      .then(config => {
        if (!mounted) {
          return
        }

        if (!config.ok) {
          setError(config.error)

          return
        }

        setSettings(config.value)
        setSaved(JSON.stringify(config.value))
      })
      .catch(() => {
        if (mounted) {
          setError('Could not load agent tools.')
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [agent.id])

  useEffect(() => {
    onDirty(dirty)

    return () => onDirty(false)
  }, [dirty, onDirty])

  async function saveSettings() {
    setWorking(true)
    setError('')

    try {
      const result = await window.granite.harness.save(agent.id, settings)

      if (!result.ok) {
        setError(result.error)

        return
      }

      setSettings(result.value)
      setSaved(JSON.stringify(result.value))
      setNotice('Agent tools saved. Changes apply to the next model request or tool action.')
    } catch {
      setError('Could not save agent tools.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <main className="settings-main">
      <header>
        <span>
          {agent.name} · Tools & skills
        </span>

        <button className="quiet-button" disabled={working} onClick={onBack}>
          {dirty ? 'Discard changes and back' : 'Back to chat'}
        </button>
      </header>

      <div className="settings-content harness-settings">
        <div className="settings-title">
          <div className="eyebrow">
            AGENT BEHAVIOR
          </div>

          <h1>
            Tools & skills
          </h1>

          <p className="agent-description">
            These settings belong to {agent.name} and apply with every model connection.
          </p>
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

        <fieldset disabled={disabled || !saved}>
          <label>
            Additional instructions

            <textarea
              className="identity-editor"
              value={settings.instructions}
              maxLength={32_000}
              onChange={event => setSettings({ ...settings, instructions: event.target.value })}
              placeholder="How should this agent approach its work?"
            />
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.approveWrites}
              onChange={event => setSettings({ ...settings, approveWrites: event.target.checked })}
            />

            Ask before each workspace file change
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.skills}
              onChange={event => setSettings({ ...settings, skills: event.target.checked })}
            />

            Offer skills to this agent
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.terminal}
              disabled={window.granite.platform !== 'darwin'}
              onChange={event => setSettings({ ...settings, terminal: event.target.checked })}
            />

            Enable terminal commands · always ask first
          </label>

          <small>
            {window.granite.platform === 'darwin'
              ? 'Commands run in a workspace sandbox until completion or Stop, with network access blocked. Identity, settings, and skills stay protected.'
              : 'The terminal sandbox currently supports macOS. File tools, skills, and MCP are available on other platforms.'}
          </small>

          <div className="section-heading">
            <div>
              <h2>
                MCP servers
              </h2>

              <p>
                Granite asks before connecting to an enabled server and before each tool call.
              </p>
            </div>

            <button
              type="button"
              className="quiet-button"
              disabled={settings.mcpServers.length >= 12}
              onClick={() =>
                setSettings({
                  ...settings,
                  mcpServers: [
                    ...settings.mcpServers,
                    {
                      id: crypto.randomUUID(),
                      name: 'New server',
                      transport: 'stdio',
                      command: '',
                      args: [],
                      url: '',
                      enabled: false
                    }
                  ]
                })
              }
            >
              + Add server
            </button>
          </div>

          {settings.mcpServers.map((server, index) => {
            const update = (patch: Partial<typeof server>) =>
              setSettings({
                ...settings,
                mcpServers: settings.mcpServers.map((item, i) =>
                  i === index ? { ...item, ...patch } : item
                )
              })

            return (
              <section className="connection-editor" key={server.id}>
                <div className="editor-heading">
                  <h3>
                    {server.name}
                  </h3>

                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() =>
                      setSettings({
                        ...settings,
                        mcpServers: settings.mcpServers.filter(item => item.id !== server.id)
                      })
                    }
                  >
                    Remove server
                  </button>
                </div>

                <label>
                  Server name

                  <input
                    value={server.name}
                    maxLength={80}
                    onChange={event => update({ name: event.target.value })}
                  />
                </label>

                <label>
                  Connection

                  <Select
                    value={server.transport}
                    onChange={event =>
                      update({ transport: event.target.value as 'stdio' | 'http' })
                    }
                  >
                    <SelectOption value="stdio">
                      Local program
                    </SelectOption>

                    <SelectOption value="http">
                      HTTP server
                    </SelectOption>
                  </Select>
                </label>

                {server.transport === 'stdio' ? (
                  <>
                    <label>
                      Executable

                      <input
                        value={server.command}
                        onChange={event => update({ command: event.target.value })}
                        placeholder="Full path or installed command"
                      />
                    </label>

                    <label>
                      Arguments · one per line

                      <textarea
                        value={server.args.join('\n')}
                        onChange={event =>
                          update({ args: event.target.value ? event.target.value.split('\n') : [] })
                        }
                        rows={3}
                      />
                    </label>

                    <small>
                      Local MCP programs run with your computer’s permissions after approval. Use a program you trust. Do not place credentials in arguments.
                    </small>
                  </>
                ) : (
                  <label>
                    Server address

                    <input
                      type="url"
                      value={server.url}
                      onChange={event => update({ url: event.target.value })}
                      placeholder="https://example.com/mcp"
                    />

                    <small>
                      Supports public Streamable HTTP servers. MCP account sign-in is not implemented yet.
                    </small>
                  </label>
                )}

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={event => update({ enabled: event.target.checked })}
                  />

                  Enable this server
                </label>
              </section>
            )
          })}

          <div>
            <button type="button" disabled={!settingsDirty} onClick={() => void saveSettings()}>
              Save agent tools
            </button>
          </div>
        </fieldset>

        <SkillsEditor agentId={agent.id} busy={busy || working} onDirty={setSkillDirty} />
      </div>
    </main>
  )
}
