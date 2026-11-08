import { cp, link, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TreeState } from './changes.ts'
import { copyVerifiedFile, inspectFile } from './files.ts'

// Command subprocesses never receive write access to the live repository. Even
// deliberately detached descendants can only change this disposable copy.
export async function copyCommandWorkspace(source: string, destination: string, signal?: AbortSignal) {
  await cp(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true,
    filter: () => { signal?.throwIfAborted(); return true } })
}

export async function gitManifest(root: string, signal?: AbortSignal): Promise<TreeState> {
  const result: TreeState = Object.create(null)
  async function visit(path: string) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      signal?.throwIfAborted()
      const file = `${path}/${entry.name}`, absolute = join(root, file)
      if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) throw new Error('Git metadata must use local regular files and directories.')
      if (entry.isDirectory()) await visit(file)
      else {
        result[file] = { hash: (await inspectFile(absolute, signal, false)).hash, binary: true }
      }
    }
  }
  const metadata = await lstat(join(root, '.git'))
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Git metadata must be a local .git directory.')
  await visit('.git')
  return result
}

export async function mergeGitFile(root: string, stage: string, path: string, before: string | undefined, after: string | undefined, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!path.startsWith('.git/') || path.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid metadata path.')
  const target = join(root, path)
  const currentRevision = async () => {
    try {
      // Recheck parents as well as the leaf before publishing metadata.
      const parts = path.split('/')
      for (let i = 1; i <= parts.length; i++) {
        try {
          if ((await lstat(join(root, ...parts.slice(0, i)))).isSymbolicLink()) throw new Error('Git metadata path became a symbolic link.')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      return (await inspectFile(target, signal, false)).hash
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return undefined
    }
  }
  const current = await currentRevision()
  if (current === after) return // Existing immutable objects can be shared safely.
  if (current !== before) throw new Error(`Git metadata changed concurrently: ${path}. Review the remaining Git outcome.`)
  if (!after) { signal.throwIfAborted(); await rm(target); return }
  await mkdir(dirname(target), { recursive: true })
  const temporary = join(dirname(target), `.granite-${randomUUID()}`)
  try {
    await copyVerifiedFile(join(stage, path), temporary, after, 0o644, signal)
    if (await currentRevision() !== before) throw new Error(`Git metadata changed concurrently: ${path}. Review the remaining Git outcome.`)
    signal.throwIfAborted()
    if (!before) await link(temporary, target)
    else await rename(temporary, target)
  } finally { await rm(temporary, { force: true }) }
}
