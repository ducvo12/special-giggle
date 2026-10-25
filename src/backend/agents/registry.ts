import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defaultIdentity, type Agent } from '../../shared/agent.ts'
import { AgentFilesystem } from '../workspace/filesystem.ts'
import { createWorkspace, workspaceText } from '../workspace/workspace.ts'

const validId = /^[a-z][a-z0-9-]{0,63}$/

function validateName(value: string) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 80 ||
    /[\u0000-\u001f\u007f<>]/.test(value)
  ) {
    throw new Error(
      'Choose an agent name between 1 and 80 characters without control characters or angle brackets.'
    )
  }

  return value.trim()
}

export class AgentRegistry {
  private directory: string
  private creating = false

  private constructor(directory: string) {
    this.directory = directory
  }

  static async open(directory: string) {
    const registry = new AgentRegistry(directory)
    await mkdir(join(directory, 'agents'), { recursive: true, mode: 0o700 })
    // Adopt legacy Atlas files only when that folder already exists. An empty
    // installation, or one whose last agent was deleted, must stay empty.
    const defaultAgent = { id: 'atlas', name: 'Atlas' }
    const root = join(directory, 'agents', defaultAgent.id)

    try {
      await lstat(root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return registry
      }

      throw error
    }

    if ((await lstat(root)).isSymbolicLink()) {
      throw new Error('Agent folders cannot be symbolic links.')
    }

    await new AgentFilesystem(root).check('/agent.json')

    try {
      await writeFile(join(root, 'agent.json'), JSON.stringify(defaultAgent, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }

    await createWorkspace(directory, await registry.get('atlas'), defaultIdentity('Atlas'))

    return registry
  }

  async get(id: string): Promise<Agent> {
    if (typeof id !== 'string' || !validId.test(id)) {
      throw new Error('Invalid agent ID.')
    }

    const root = join(this.directory, 'agents', id)

    if ((await lstat(root)).isSymbolicLink()) {
      throw new Error('Agent folders cannot be symbolic links.')
    }

    const data = JSON.parse(await workspaceText(new AgentFilesystem(root), '/agent.json')) as Agent

    if (data.id !== id) {
      throw new Error('Agent folder and configuration do not match.')
    }

    return { id, name: validateName(data.name) }
  }

  async list(): Promise<Agent[]> {
    const entries = await readdir(join(this.directory, 'agents'), { withFileTypes: true })
    const agents: Agent[] = []

    for (const entry of entries) {
      if (!entry.isDirectory() || !validId.test(entry.name)) {
        continue
      }

      try {
        agents.push(await this.get(entry.name))
      } catch {
        /* Ignore incomplete or invalid folders. */
      }
    }

    return agents.sort((a, b) =>
      a.id === 'atlas' ? -1 : b.id === 'atlas' ? 1 : a.name.localeCompare(b.name)
    )
  }

  async workspace(id: string) {
    await this.get(id)

    return new AgentFilesystem(join(this.directory, 'agents', id))
  }

  async create(value: string): Promise<Agent> {
    if (this.creating) {
      throw new Error('An agent is already being created.')
    }

    this.creating = true

    try {
      const name = validateName(value)

      if (
        (await this.list()).some(
          agent => agent.name.toLocaleLowerCase() === name.toLocaleLowerCase()
        )
      ) {
        throw new Error('An agent with that name already exists.')
      }

      const agent = { id: `agent-${randomUUID()}`, name }
      const workspace = await createWorkspace(this.directory, agent)
      // Publish metadata last so partially created folders are not selectable.
      await writeFile(join(workspace.root, 'agent.json'), JSON.stringify(agent, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600
      })

      return agent
    } finally {
      this.creating = false
    }
  }

  async saveIdentity(id: string, identity: string, expected: string): Promise<string> {
    if (
      typeof identity !== 'string' ||
      !identity.trim() ||
      identity.length > 32_000 ||
      identity.includes('\0') ||
      typeof expected !== 'string'
    ) {
      throw new Error('Identity must contain between 1 and 32,000 characters.')
    }

    const workspace = await this.workspace(id)
    await workspace.check('/identity.md')

    if ((await workspaceText(workspace, '/identity.md')) !== expected) {
      throw new Error('The identity file changed. Reload it before saving your edits.')
    }

    const temporary = join(workspace.root, `.identity-${randomUUID()}.tmp`)

    try {
      await writeFile(temporary, identity, { flag: 'wx', mode: 0o600 })
      await rename(temporary, join(workspace.root, 'identity.md'))
    } finally {
      await rm(temporary, { force: true })
    }

    return identity
  }

  async saveMarkdown(id: string, path: string, content: string, expected: string | null) {
    if (path === '/identity.md' && typeof expected === 'string') return this.saveIdentity(id, content, expected)
    if (typeof path !== 'string' || !/^\/(memory\.md|notes\/.+\.md)$/.test(path) ||
        typeof content !== 'string' || content.length > 100_000 || content.includes('\0') ||
        !(expected === null || typeof expected === 'string')) {
      throw new Error('Choose a Markdown file in memory or notes (up to 100,000 characters).')
    }
    const workspace = await this.workspace(id)
    await workspace.check(path)
    const destination = join(workspace.root, path.slice(1))
    if (expected === null) {
      if (!path.startsWith('/notes/')) throw new Error('New files belong in notes.')
      // Exclusive creation cannot replace an existing note, even if another
      // local process created it after the user opened the dialog.
      await writeFile(destination, content, { flag: 'wx', mode: 0o600 })
    } else {
      if (await workspaceText(workspace, path) !== expected) {
        throw new Error('This file changed. Reload it before saving your edits.')
      }
      const temporary = join(dirname(destination), `.edit-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
        await rename(temporary, destination)
      } finally { await rm(temporary, { force: true }) }
    }
    return content
  }

  async renameNote(id: string, path: string, value: string) {
    if (typeof path !== 'string' || !path.startsWith('/notes/') || !path.endsWith('.md') ||
        typeof value !== 'string' || !value.trim() || value.trim().length > 120 || /[\\/\u0000-\u001f\u007f]/.test(value)) {
      throw new Error('Choose a note name without slashes or control characters.')
    }
    const filename = value.trim().endsWith('.md') ? value.trim() : `${value.trim()}.md`
    if (filename === '.md' || filename === '..md') throw new Error('Choose a descriptive note name.')
    const next = path.slice(0, path.lastIndexOf('/') + 1) + filename
    const workspace = await this.workspace(id)
    await workspace.check(path)
    await workspace.check(next)
    const source = join(workspace.root, path.slice(1))
    const destination = join(workspace.root, next.slice(1))
    const info = await lstat(source)
    if (!info.isFile()) throw new Error('Choose a note file, not a folder.')
    if (path === next) return next
    try {
      // Unlike rename(), link() cannot replace an existing destination. Keep
      // the original bytes/inode, then remove the old directory entry.
      await link(source, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const target = await lstat(destination)
      const entries = await readdir(dirname(source))
      if (info.ino === target.ino && info.dev === target.dev && !entries.includes(filename)) {
        // Case-only name change on a case-insensitive filesystem.
        await rename(source, destination)
        return next
      }
      throw new Error('A note with that name already exists. Choose another name.')
    }
    try { await unlink(source) }
    catch (error) {
      await unlink(destination)
      throw error
    }
    return next
  }
}
