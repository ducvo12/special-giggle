import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent, WorkspaceEntry } from '../../shared/agent.ts'
import { AgentFilesystem } from './filesystem.ts'
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import type { AgentOrganization } from '../../shared/organization.ts'

export async function createWorkspace(directory: string, agent: Agent, identity = '') {
  const root = join(directory, 'agents', agent.id)
  await mkdir(root, { recursive: true, mode: 0o700 })

  for (const name of ['notes', 'projects', 'sections', 'tools/skills']) {
    await new AgentFilesystem(root).check(`/${name}`)
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

// Internal IDs, not display names, determine disk paths. Check every existing
// component before creating directories, including on application reopen.
export function ensureOrganizationStorage(root: string, organization: AgentOrganization) {
  function directory(parts: string[]) {
    let current = root
    for (const part of parts) {
      if (!/^[a-zA-Z0-9_-]+$/.test(part)) throw new Error('Invalid organization storage path.')
      current = join(current, part)
      try {
        const info = lstatSync(current)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Organization storage must use real directories, not symbolic links.')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        mkdirSync(current, { mode: 0o700 })
      }
    }
    return current
  }
  directory(['notes'])
  directory(['tools', 'skills'])
  for (const section of organization.sections) {
    const parts = ['sections', section.id]
    const path = directory(parts)
    directory([...parts, 'notes'])
    directory([...parts, 'projects'])
    try {
      writeFileSync(join(path, 'summary.md'), '# Section context\n', { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (lstatSync(join(path, 'summary.md')).isSymbolicLink()) throw new Error('Section context cannot be a symbolic link.')
    }
  }
  for (const project of organization.projects) {
    directory(['sections', project.sectionId, 'projects', project.id])
  }
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
