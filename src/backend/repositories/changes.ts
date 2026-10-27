import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readlink, rm, writeFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RepositoryChange } from '../../shared/repository.ts'
import type { RepositoryPaths } from './paths.ts'
import { inspectFile } from './files.ts'
import { validateRepositoryLink } from './links.ts'

export type FileState = { hash: string; text?: string; binary: boolean; large?: boolean; mode?: number; directory?: boolean; linkTarget?: string; generated?: boolean }
export type TreeState = Record<string, FileState>
export const fingerprint = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
export const linkState = (target: string, mode = 0o777): FileState => ({ hash: fingerprint(Buffer.from('symlink:' + target)), binary: false, mode, linkTarget: target })
const generatedPath = (path: string) => path.split('/').some(part => ['node_modules', '.next', '.nuxt', '.svelte-kit'].includes(part))
export const gitEnvironment = () => ({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' })

// Native edits only need snapshots of their exact targets. Installed dependencies
// and unrelated files must not prevent a chat or an ordinary source-file edit.
export async function scanPaths(paths: RepositoryPaths, selected: string[], signal?: AbortSignal): Promise<TreeState> {
  const result: TreeState = Object.create(null)
  for (const path of new Set(selected)) {
    signal?.throwIfAborted()
    const absolute = await paths.check(path, { leafLink: true })
    try {
      const info = await lstat(absolute)
      if (info.isSymbolicLink()) { result[path] = { ...linkState(await readlink(absolute), info.mode & 0o777), ...(generatedPath(path) ? { generated: true } : {}) }; continue }
      if (info.isDirectory()) {
        result[path] = { hash: 'directory', binary: false, directory: true, mode: info.mode & 0o777, ...(generatedPath(path) ? { generated: true } : {}) }
        continue
      }
      result[path] = { ...await inspectFile(absolute, signal, !generatedPath(path)), ...(generatedPath(path) ? { generated: true } : {}) }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return result
}

export function localGit(args: string[], cwd: string, input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile('/usr/bin/git', ['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
      { cwd, env: gitEnvironment(), timeout: 15_000, maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
        if (error && !(args.includes('--no-index') && error.code === 1)) reject(new Error(`Git operation failed: ${String(stderr).slice(0, 2000)}`))
        else resolve(stdout)
      })
    child.stdin?.end(input)
  })
}

// Complete manifests make command-created/deleted/untracked files visible.
// Content hashing streams; only small text files are retained for inline diffs.
export async function scanTree(paths: RepositoryPaths, signal?: AbortSignal, includeText = true, internalHardlinks = false): Promise<TreeState> {
  const result: TreeState = Object.create(null)
  const hardlinks = new Map<string, { expected: number; count: number }>()
  async function visit(directory: string) {
    signal?.throwIfAborted()
    for (const entry of await readdir(await paths.check(directory), { withFileTypes: true })) {
      signal?.throwIfAborted()
      if (entry.name.toLowerCase() === '.git') continue
      const path = directory ? `${directory}/${entry.name}` : entry.name
      // Record links themselves; do not recurse through linked directories.
      if (entry.isSymbolicLink()) {
        const value = await readlink(join(paths.root, path))
        await validateRepositoryLink(paths, path, value)
        result[path] = { ...linkState(value, (await lstat(join(paths.root, path))).mode & 0o777), ...(generatedPath(path) ? { generated: true } : {}) }
        continue
      }
      const absolute = await paths.check(path, { hardlinks: internalHardlinks })
      if (entry.isDirectory()) {
        result[path] = { hash: 'directory', binary: false, directory: true, mode: (await lstat(absolute)).mode & 0o777, ...(generatedPath(path) ? { generated: true } : {}) }
        await visit(path)
      }
      else if (entry.isFile()) {
        const info = await lstat(absolute)
        if (info.nlink > 1) {
          if (!internalHardlinks) throw new Error('Hard-linked repository files are not supported for tracked command execution.')
          const key = `${info.dev}:${info.ino}`, entry = hardlinks.get(key) ?? { expected: info.nlink, count: 0 }
          entry.count++; hardlinks.set(key, entry)
        }
        result[path] = { ...await inspectFile(absolute, signal, includeText && !generatedPath(path)), ...(generatedPath(path) ? { generated: true } : {}) }
      }
    }
  }
  await visit('')
  if ([...hardlinks.values()].some(entry => entry.count !== entry.expected)) throw new Error('A command-created hard link has a target outside the tracked repository.')
  return result
}

export async function compareTrees(before: TreeState, after: TreeState): Promise<RepositoryChange[]> {
  const changes: RepositoryChange[] = []
  const directory = await mkdtemp(join(tmpdir(), 'granite-diff-'))
  try {
    for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const a = before[path], b = after[path]
      if (a?.hash === b?.hash && a?.mode === b?.mode) continue
      if (a?.linkTarget !== undefined || b?.linkTarget !== undefined) {
        changes.push({ path, kind: !a ? 'added' : !b ? 'deleted' : 'modified', binary: false, added: 0, removed: 0,
          symbolicLink: true, ...(a?.generated || b?.generated ? { generated: true } : {}), diff: `${a?.linkTarget !== undefined ? `- link → ${a.linkTarget}\n` : ''}${b?.linkTarget !== undefined ? `+ link → ${b.linkTarget}\n` : ''}` })
        continue
      }
      if (a?.directory || b?.directory) {
        changes.push({ path, directory: true, kind: !a ? 'added' : !b ? 'deleted' : 'modified', binary: false, added: 0, removed: 0, diff: '', modeChanged: Boolean(a && b && a.mode !== b.mode), ...(a?.generated || b?.generated ? { generated: true } : {}) })
        continue
      }
      const binary = Boolean(a?.binary || b?.binary)
      const large = Boolean(a?.large || b?.large)
      const generated = Boolean(a?.generated || b?.generated)
      let diff = '', added = 0, removed = 0
      if (!binary && !large && !generated) {
        await writeFile(join(directory, 'before'), a?.text ?? '')
        await writeFile(join(directory, 'after'), b?.text ?? '')
        diff = await localGit(['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--', 'before', 'after'], directory)
        diff = diff.replaceAll('a/before', `a/${path}`).replaceAll('b/after', `b/${path}`)
        let hunk = false
        for (const line of diff.split('\n')) {
          if (line.startsWith('@@')) { hunk = true; continue }
          if (hunk && line.startsWith('+')) added++
          if (hunk && line.startsWith('-')) removed++
        }
      }
      if (a && b && a.mode !== b.mode) diff = `old mode ${(0o100000 | (a.mode ?? 0o644)).toString(8)}\nnew mode ${(0o100000 | (b.mode ?? 0o644)).toString(8)}\n` + diff
      changes.push({ path, kind: !a ? 'added' : !b ? 'deleted' : 'modified', binary, large, ...(generated ? { generated: true } : {}), ...(a && b && a.mode !== b.mode ? { modeChanged: true } : {}), added, removed,
        diff: diff.slice(0, 64_000), ...(diff.length > 64_000 ? { truncated: true } : {}) })
    }
    // Only classify exact-content renames; changed-content pairs remain explicit
    // additions/deletions instead of guessing a relationship.
    const deleted = new Map<string, RepositoryChange[]>()
    for (const change of changes) if (change.kind === 'deleted' && !change.directory) {
      const key = `${before[change.path].hash}:${before[change.path].mode}`
      const candidates = deleted.get(key) ?? []; candidates.push(change); deleted.set(key, candidates)
    }
    const renamed = new Set<RepositoryChange>()
    for (const addition of changes.filter(change => change.kind === 'added' && !change.directory)) {
      const deletion = deleted.get(`${after[addition.path].hash}:${after[addition.path].mode}`)?.shift()
      if (deletion) {
        addition.kind = 'renamed'; addition.previousPath = deletion.path
        addition.added = 0; addition.removed = 0; addition.diff = ''
        renamed.add(deletion)
      }
    }
    return changes.filter(change => !renamed.has(change))
  } finally { await rm(directory, { recursive: true, force: true }) }
}
