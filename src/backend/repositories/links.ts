import { lstat, readlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { RepositoryPaths, within } from './paths.ts'

// Resolve each component, including .. AFTER a link, without ever following a
// path outside this repository. Dangling contained targets are safe to record.
export async function validateRepositoryLink(paths: RepositoryPaths, path: string, target: string) {
  await paths.check(path, { leafLink: true, hardlinks: true })
  const pending = target.split('/'), seen = new Set<string>([path])
  let current = dirname(join(paths.root, path))
  const validate = (value: string) => {
    if (!value || isAbsolute(value) || value.includes('\0') || value.includes('\\')) throw new Error(`Unsafe symbolic link: ${path}. Use a repository-contained relative target.`)
  }
  validate(target)
  while (pending.length) {
    const part = pending.shift()!
    if (!part || part === '.') continue
    if (part.toLowerCase() === '.git') throw new Error(`Symbolic link targets cannot access Git metadata: ${path}.`)
    const next = part === '..' ? dirname(current) : join(current, part)
    if (!within(paths.root, next) || within(paths.privateRoot, next) && !within(paths.internalRoot ?? paths.root + '/.unavailable', next)) throw new Error(`Symbolic link escapes permitted repository storage: ${path}.`)
    current = next
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) {
        const key = relative(paths.root, current)
        if (seen.has(key) || seen.size >= 40) throw new Error(`Cyclic symbolic link: ${path}.`)
        seen.add(key)
        const value = await readlink(current); validate(value)
        current = dirname(current)
        pending.unshift(...value.split('/'))
      } else if (!info.isFile() && !info.isDirectory()) throw new Error(`Symbolic link targets a special file: ${path}.`)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return current
}
