import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fingerprint, type TreeState } from './changes.ts'

// Command subprocesses never receive write access to the live repository. Even
// deliberately detached descendants can only change this disposable copy.
export async function copyCommandWorkspace(source: string, destination: string, git: boolean) {
  await cp(source, destination, { recursive: true, dereference: false, preserveTimestamps: true,
    filter: path => git || !path.slice(source.length).split('/').some(part => part.toLowerCase() === '.git') })
}

export async function gitManifest(root: string): Promise<TreeState> {
  const result: TreeState = Object.create(null)
  let bytes = 0, count = 0
  async function visit(path: string) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const file = `${path}/${entry.name}`, absolute = join(root, file)
      if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) throw new Error('Git metadata must use local regular files and directories.')
      if (entry.isDirectory()) await visit(file)
      else {
        const info = await lstat(absolute)
        if (++count > 25_000 || (bytes += info.size) > 128_000_000) throw new Error('Git metadata exceeds the initial command-copy limit.')
        result[file] = { hash: fingerprint(await readFile(absolute)), binary: true }
      }
    }
  }
  const metadata = await lstat(join(root, '.git'))
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Git metadata must be a local .git directory.')
  await visit('.git')
  return result
}

export async function mergeGitFile(root: string, stage: string, path: string, before?: string, after?: string) {
  if (!path.startsWith('.git/') || path.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid metadata path.')
  const target = join(root, path)
  let current: string | undefined
  try {
    // Check every parent again. Worktree metadata aliases and symlinks cannot
    // redirect an authorized Git write into another repository/application.
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      try { if ((await lstat(join(root, ...parts.slice(0, i)))).isSymbolicLink()) throw new Error('Git metadata path became a symbolic link.') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    current = fingerprint(await readFile(target))
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (current === after) return // Existing immutable objects can be shared safely.
  if (current !== before) throw new Error(`Git metadata changed concurrently: ${path}. Review the remaining Git outcome.`)
  if (!after) { await rm(target); return }
  await mkdir(dirname(target), { recursive: true })
  const data = await readFile(join(stage, path))
  if (fingerprint(data) !== after) throw new Error('The command copy changed during Git reconciliation.')
  if (!before) await writeFile(target, data, { flag: 'wx' })
  else {
    const temporary = join(dirname(target), `.granite-${randomUUID()}`)
    try { await writeFile(temporary, data, { flag: 'wx' }); await rename(temporary, target) }
    finally { await rm(temporary, { force: true }) }
  }
}
