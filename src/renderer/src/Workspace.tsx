import { useEffect, useRef, useState } from 'react'
import type { Agent, WorkspaceEntry } from '../../shared/agent'

export default function Workspace({ busy, agent }: { busy: boolean; agent: Agent }) {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [file, setFile] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const request = useRef(0)
  async function list(next = path) {
    const result = await window.granite.workspace.entries(agent.id, next)
    if (result.ok) { setPath(next); setEntries(result.value); setError('') } else setError(result.error)
  }
  async function read(next: string) {
    const token = ++request.current
    const result = await window.granite.workspace.read(agent.id, next)
    if (token !== request.current) return
    if (result.ok) { setFile(next); setText(result.value); setError('') } else setError(result.error)
  }
  useEffect(() => { void list(); void read('/identity.md') }, [])
  return <main className="settings-main"><header><span>{agent.name} / Workspace</span><button className="quiet-button" onClick={() => { void list(); if (file) void read(file) }}>Refresh</button></header><div className="workspace-intro"><p>{agent.name} can read and edit files here. Identity is read-only to the agent. {busy ? `${agent.name} is working; refresh to see its latest changes.` : `Ask ${agent.name} to save a note or remember a preference.`}</p></div><div className="workspace-browser"><nav aria-label="Workspace files"><div className="workspace-path">{path}</div>{path !== '/' && <button onClick={() => void list(path.replace(/[^/]+\/$/, '') || '/')}>↑ Parent folder</button>}{entries.map(entry => <button key={entry.path} className={file === entry.path ? 'selected' : ''} onClick={() => entry.directory ? void list(entry.path) : void read(entry.path)}>{entry.directory ? '▸' : '·'} {entry.path.split('/').filter(Boolean).at(-1)}</button>)}</nav><section className="file-preview">{error && <div className="error" role="alert">{error}</div>}<h2>{file}</h2><pre>{text}</pre></section></div></main>
}
