import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent, WorkspaceEntry } from '../../shared/agent.ts'
import { AgentFilesystem } from './filesystem.ts'

export async function createWorkspace(directory: string, agent: Agent, identity = '') {
  const root = join(directory, 'agents', agent.id)
  await mkdir(root, { recursive: true, mode: 0o700 })

  for (const name of ['notes', 'projects']) {
    await mkdir(join(root, name), { recursive: true })
  }

  for (const [name, content] of [
    ['identity.md', identity],
    ['memory.md', '# User memory\n\nNo preferences saved yet.\n']
  ]) {
    try {
      await writeFile(join(root, name), content, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }

  return new AgentFilesystem(root)
}

export async function workspaceEntries(
  backend: AgentFilesystem,
  path = '/'
): Promise<WorkspaceEntry[]> {
  const result = await backend.ls(path)

  if (result.error) {
    throw new Error(result.error)
  }

  return (result.files ?? [])
    .slice(0, 500)
    .map(file => ({ path: file.path, directory: file.is_dir ?? false }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path))
}

export async function workspaceText(backend: AgentFilesystem, path: string) {
  const result = await backend.readRaw(path)

  if (result.error || !result.data) {
    throw new Error(result.error ?? 'File not found.')
  }

  if (typeof result.data.content !== 'string') {
    throw new Error('The workspace viewer supports text files only.')
  }

  if (result.data.content.length > 100_000) {
    throw new Error('This file is too large for the workspace viewer.')
  }

  return result.data.content
}
