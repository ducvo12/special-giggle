import { mkdir, writeFile, realpath, lstat } from 'node:fs/promises'
import { join, resolve, relative, sep } from 'node:path'
import { FilesystemBackend } from 'deepagents'
import type { WorkspaceEntry } from '../shared/agent.ts'

const identity = `# Atlas
You are Atlas, the user's practical, thoughtful personal assistant.
Be clear, honest, curious, and concise. Respect the user's decisions and privacy.
Never claim to have saved or changed anything unless a tool succeeded.
Your identity is independent of the model selected by the user.
`

// Reject symbolic links, including links into the workspace. This also prevents
// aliases from bypassing protection of identity.md. The OS filesystem is not a
// sandbox against other local processes changing paths concurrently.
export class AtlasFilesystem extends FilesystemBackend {
  root: string
  constructor(root: string) { super({ rootDir: root, virtualMode: true, maxFileSizeMb: 1 }); this.root = root }
  async check(path: string, writing = false) {
    if (typeof path !== 'string' || path.includes('\\') || path.split('/').some(p => p === '..' || p === '.' || p === '.git') || path.includes('\0')) throw new Error('Use a path inside the Atlas workspace.')
    const parts = path.split('/').filter(Boolean)
    if (writing && parts[0]?.toLowerCase() === 'identity.md') throw new Error('Atlas identity is read-only to the agent.')
    for (let i = 1; i <= parts.length; i++) {
      const target = join(this.root, ...parts.slice(0, i))
      try {
        if ((await lstat(target)).isSymbolicLink()) throw new Error('Symbolic links are not available to Atlas.')
        const actual = await realpath(target)
        const realRoot = await realpath(this.root)
        const rel = relative(realRoot, actual)
        if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(realRoot, rel) !== actual) throw new Error('Path is outside the Atlas workspace.')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; break }
    }
  }
  override async readRaw(path: string) { await this.check(path); return super.readRaw(path) }
  override async read(path: string, offset?: number, limit?: number) { await this.check(path); return super.read(path, offset, limit) }
  override async write(path: string, content: string) { await this.check(path, true); return super.write(path, content) }
  override async edit(path: string, old: string, next: string, all = false) { await this.check(path, true); return super.edit(path, old, next, all) }
  override async delete(path: string) { await this.check(path, true); return super.delete(path) }
  override async uploadFiles(files: [string, Uint8Array][]) { for (const [path] of files) await this.check(path, true); return super.uploadFiles(files) }
  override async downloadFiles(paths: string[]) { for (const path of paths) await this.check(path); return super.downloadFiles(paths) }
  override async ls(path: string) {
    await this.check(path)
    const result = await super.ls(path)
    const files = []
    for (const file of result.files ?? []) { try { await this.check(file.path); files.push(file) } catch { /* hide inaccessible entries */ } }
    return { ...result, files }
  }
  override async glob(pattern: string, path = '/') {
    if (pattern.length > 512 || /[{}]/.test(pattern)) throw new Error('Use a simple glob without brace expansion.')
    await this.check(pattern); await this.check(path)
    const result = await super.glob(pattern, path)
    const files = []
    for (const file of result.files ?? []) { try { await this.check(file.path); files.push(file) } catch { /* omit links */ } }
    return { ...result, files }
  }
  override async grep(pattern: string, path = '/', glob: string | null = null, maxCount: number | null = null) {
    if (glob && (glob.length > 512 || /[{}]/.test(glob))) throw new Error('Use a simple glob without brace expansion.')
    await this.check(path); return super.grep(pattern, path, glob, maxCount)
  }
}

export async function createWorkspace(directory: string) {
  const root = join(directory, 'agents', 'atlas')
  await mkdir(root, { recursive: true, mode: 0o700 })
  for (const name of ['notes', 'projects']) await mkdir(join(root, name), { recursive: true })
  for (const [name, content] of [['identity.md', identity], ['memory.md', '# User memory\n\nNo preferences saved yet.\n']]) {
    try { await writeFile(join(root, name), content, { flag: 'wx', mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  return new AtlasFilesystem(root)
}

export async function workspaceEntries(backend: AtlasFilesystem, path = '/'): Promise<WorkspaceEntry[]> {
  const result = await backend.ls(path)
  if (result.error) throw new Error(result.error)
  return (result.files ?? []).slice(0, 500).map(file => ({ path: file.path, directory: file.is_dir ?? false })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path))
}

export async function workspaceText(backend: AtlasFilesystem, path: string) {
  const result = await backend.readRaw(path)
  if (result.error || !result.data) throw new Error(result.error ?? 'File not found.')
  if (typeof result.data.content !== 'string') throw new Error('The workspace viewer supports text files only.')
  if (result.data.content.length > 100_000) throw new Error('This file is too large for the workspace viewer.')
  return result.data.content
}
