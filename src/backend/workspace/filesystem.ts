import { realpath, lstat } from 'node:fs/promises'
import { join, resolve, relative, sep } from 'node:path'
import { FilesystemBackend, type GrepResult } from 'deepagents'

// Reject symbolic links, including links into the workspace. This also prevents
// aliases from bypassing protection of identity.md. The OS filesystem is not a
// sandbox against other local processes changing paths concurrently.
export class AgentFilesystem extends FilesystemBackend {
  root: string
  readonly excludeOrganization: boolean

  constructor(root: string, options: { excludeOrganization?: boolean } = {}) {
    super({ rootDir: root, virtualMode: true, maxFileSizeMb: 1 })
    this.root = root
    this.excludeOrganization = options.excludeOrganization ?? false
  }

  async check(path: string, writing = false) {
    if (
      typeof path !== 'string' ||
      path.includes('\\') ||
      path.split('/').some(p => p === '..' || p === '.' || p === '.git') ||
      path.includes('\0')
    ) {
      throw new Error('Use a path inside this agent’s workspace.')
    }

    const parts = path.split('/').filter(Boolean)

    if (this.excludeOrganization && ['sections', 'projects'].includes(parts[0]?.toLowerCase())) {
      throw new Error('Section files are not available through the current agent-wide tools.')
    }

    if (
      writing &&
      ['identity.md', 'agent.json', 'harness.json', 'skills', 'tools', 'sections'].includes(parts[0]?.toLowerCase())
    ) {
      throw new Error('Identity and agent configuration are read-only to the agent.')
    }

    for (let i = 1; i <= parts.length; i++) {
      const target = join(this.root, ...parts.slice(0, i))

      try {
        if ((await lstat(target)).isSymbolicLink()) {
          throw new Error('Symbolic links are not available to agents.')
        }

        const actual = await realpath(target)
        const realRoot = await realpath(this.root)
        const rel = relative(realRoot, actual)

        if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(realRoot, rel) !== actual) {
          throw new Error('Path is outside this agent’s workspace.')
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }

        break
      }
    }
  }

  override async readRaw(path: string) {
    await this.check(path)

    return super.readRaw(path)
  }

  override async read(path: string, offset?: number, limit?: number) {
    await this.check(path)

    return super.read(path, offset, limit)
  }

  override async write(path: string, content: string) {
    await this.check(path, true)

    return super.write(path, content)
  }

  override async edit(path: string, old: string, next: string, all = false) {
    await this.check(path, true)

    return super.edit(path, old, next, all)
  }

  override async delete(path: string) {
    await this.check(path, true)

    return super.delete(path)
  }

  override async uploadFiles(files: [string, Uint8Array][]) {
    for (const [path] of files) {
      await this.check(path, true)
    }

    return super.uploadFiles(files)
  }

  override async downloadFiles(paths: string[]) {
    for (const path of paths) {
      await this.check(path)
    }

    return super.downloadFiles(paths)
  }

  override async ls(path: string) {
    await this.check(path)
    const result = await super.ls(path)
    const files = []

    for (const file of result.files ?? []) {
      try {
        await this.check(file.path)
        files.push(file)
      } catch {
        /* hide inaccessible entries */
      }
    }

    return { ...result, files }
  }

  override async glob(pattern: string, path = '/') {
    if (pattern.length > 512 || /[{}]/.test(pattern)) {
      throw new Error('Use a simple glob without brace expansion.')
    }

    await this.check(pattern)
    await this.check(path)
    const result = await super.glob(pattern, path)
    const files = []

    for (const file of result.files ?? []) {
      try {
        await this.check(file.path)
        files.push(file)
      } catch {
        /* omit links */
      }
    }

    return { ...result, files }
  }

  override async grep(
    pattern: string,
    path = '/',
    glob: string | null = null,
    maxCount: number | null = null
  ) {
    if (glob && (glob.length > 512 || /[{}]/.test(glob))) {
      throw new Error('Use a simple glob without brace expansion.')
    }

    await this.check(path)

    if (this.excludeOrganization && path.replaceAll('/', '') === '') {
      // Do not search protected section contents and filter afterward: their
      // text must never enter an agent-wide grep result or its match budget.
      const matches: NonNullable<GrepResult['matches']> = []
      let truncated = false
      for (const entry of (await this.ls('/')).files ?? []) {
        const remaining = maxCount === null ? null : Math.max(0, maxCount - matches.length)
        if (remaining === 0) { truncated = true; break }
        const result = await super.grep(pattern, entry.path, glob, remaining)
        matches.push(...(result.matches ?? []))
        truncated ||= result.truncated ?? false
      }
      return { matches, truncated }
    }
    return super.grep(pattern, path, glob, maxCount)
  }
}
