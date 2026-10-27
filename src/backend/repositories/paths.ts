import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export function within(root: string, path: string) {
  const rel = relative(root, path)
  return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

// All repository operations share these checks. Never follow a symlink, special
// file, Git metadata path, or a mount back into the application's private data.
export class RepositoryPaths {
  readonly root: string
  readonly privateRoot: string
  readonly internalRoot?: string
  constructor(root: string, privateRoot: string, internalRoot?: string) {
    this.root = root; this.privateRoot = privateRoot; this.internalRoot = internalRoot
  }

  async check(path = '', options: { leafLink?: boolean; hardlinks?: boolean } = {}) {
    if (typeof path !== 'string' || path.includes('\0') || path.includes('\\') || isAbsolute(path) ||
        path.split('/').some(part => part === '..' || part === '.' || part.toLowerCase() === '.git')) {
      throw new Error('Use a relative repository path without traversal or Git metadata.')
    }
    const canonical = await realpath(this.root).catch(() => { throw new Error('The linked repository folder cannot be found.') })
    if (canonical !== this.root) throw new Error('The repository path changed. Relink it before using tools.')
    if (within(this.privateRoot, canonical) && canonical !== this.internalRoot) {
      throw new Error('Application storage is not a repository tool target.')
    }
    let target = canonical
    const parts = path.split('/').filter(Boolean)
    for (const [index, part] of parts.entries()) {
      target = join(target, part)
      if (within(this.privateRoot, target) && !within(this.internalRoot ?? canonical + '/.unavailable', target)) {
        throw new Error('Application storage is not available through repository tools.')
      }
      try {
        const info = await lstat(target)
        // Link-aware tracking/publication may inspect the leaf itself, never a
        // linked parent. Ordinary file tools retain their no-follow boundary.
        if (info.isSymbolicLink() && options.leafLink && index === parts.length - 1) continue
        if (info.isSymbolicLink() || info.isFile() && info.nlink > 1 && !options.hardlinks || !info.isDirectory() && !info.isFile()) throw new Error('Symbolic links and special files are not available to repository tools.')
        if (!within(canonical, await realpath(target))) throw new Error('Path is outside the repository.')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return resolve(canonical, path)
  }
}
