import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '../shared/agent.ts'
import { AgentFilesystem, createWorkspace, workspaceText } from './agent-workspace.ts'

const validId = /^[a-z][a-z0-9-]{0,63}$/
function validateName(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f<>]/.test(value)) throw new Error('Choose an agent name between 1 and 80 characters without control characters or angle brackets.')
  return value.trim()
}

export class AgentRegistry {
  private directory: string
  private creating = false
  private constructor(directory: string) { this.directory = directory }
  static async open(directory: string) {
    const registry = new AgentRegistry(directory)
    await mkdir(join(directory, 'agents'), { recursive: true, mode: 0o700 })
    // The existing Atlas folder is adopted without replacing its identity or memory.
    const defaultAgent = { id: 'atlas', name: 'Atlas' }
    const root = join(directory, 'agents', defaultAgent.id)
    await mkdir(root, { recursive: true, mode: 0o700 })
    if ((await lstat(root)).isSymbolicLink()) throw new Error('Agent folders cannot be symbolic links.')
    await new AgentFilesystem(root).check('/agent.json')
    try { await writeFile(join(root, 'agent.json'), JSON.stringify(defaultAgent, null, 2) + '\n', { flag: 'wx', mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    await createWorkspace(directory, await registry.get('atlas'))
    return registry
  }
  async get(id: string): Promise<Agent> {
    if (typeof id !== 'string' || !validId.test(id)) throw new Error('Invalid agent ID.')
    const root = join(this.directory, 'agents', id)
    if ((await lstat(root)).isSymbolicLink()) throw new Error('Agent folders cannot be symbolic links.')
    const data = JSON.parse(await workspaceText(new AgentFilesystem(root), '/agent.json')) as Agent
    if (data.id !== id) throw new Error('Agent folder and configuration do not match.')
    return { id, name: validateName(data.name) }
  }
  async list(): Promise<Agent[]> {
    const entries = await readdir(join(this.directory, 'agents'), { withFileTypes: true })
    const agents: Agent[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !validId.test(entry.name)) continue
      try { agents.push(await this.get(entry.name)) } catch { /* Ignore incomplete or invalid folders. */ }
    }
    return agents.sort((a, b) => a.id === 'atlas' ? -1 : b.id === 'atlas' ? 1 : a.name.localeCompare(b.name))
  }
  async workspace(id: string) {
    await this.get(id)
    return new AgentFilesystem(join(this.directory, 'agents', id))
  }
  async create(value: string): Promise<Agent> {
    if (this.creating) throw new Error('An agent is already being created.')
    this.creating = true
    try {
      const name = validateName(value)
      if ((await this.list()).some(agent => agent.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('An agent with that name already exists.')
      const agent = { id: `agent-${randomUUID()}`, name }
      const workspace = await createWorkspace(this.directory, agent)
      // Publish metadata last so partially created folders are not selectable.
      await writeFile(join(workspace.root, 'agent.json'), JSON.stringify(agent, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      return agent
    } finally { this.creating = false }
  }
  async saveIdentity(id: string, identity: string, expected: string): Promise<string> {
    if (typeof identity !== 'string' || !identity.trim() || identity.length > 32_000 || identity.includes('\0') || typeof expected !== 'string') throw new Error('Identity must contain between 1 and 32,000 characters.')
    const workspace = await this.workspace(id)
    await workspace.check('/identity.md')
    if (await workspaceText(workspace, '/identity.md') !== expected) throw new Error('The identity file changed. Reload it before saving your edits.')
    const temporary = join(workspace.root, `.identity-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, identity, { flag: 'wx', mode: 0o600 })
      await rename(temporary, join(workspace.root, 'identity.md'))
    } finally { await rm(temporary, { force: true }) }
    return identity
  }
}
