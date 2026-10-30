import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { lstat, realpath } from 'node:fs/promises'
import { minimatch } from 'minimatch'
import type { RepositoryPaths } from './paths.ts'
import { within } from './paths.ts'
import { revision } from '../context/store.ts'

const require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)
const binary = () => (require('@vscode/ripgrep') as { rgPath: string }).rgPath.replace('app.asar/', 'app.asar.unpacked/')
type Search = { path: string; glob: string; text?: string; regex?: boolean; case_sensitive?: boolean; include_ignored?: boolean; hidden?: boolean; limit: number; cursor?: string }

async function execute(paths: RepositoryPaths, args: string[], signal: AbortSignal) {
  signal.throwIfAborted()
  const executable = await realpath(binary())
  const quote = JSON.stringify
  // Read-only direct search: no staging copy, shell, user configuration or
  // network. OS confinement also blocks traversal into private app data.
  // dyld opens the root directory to locate its cache. A literal directory
  // read does not grant reads of its children; repository/private rules remain.
  const policy = `(version 1)(deny default)(allow process-exec sysctl-read mach-lookup file-read-metadata file-map-executable)
    (allow file-read* (subpath ${quote(paths.root)}) (literal ${quote(executable)}) (subpath "/System") (subpath "/usr/lib") (literal "/") (subpath "/private/var/db/dyld") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
    (allow file-write* (literal "/dev/null"))
    (deny file-read* (regex #"(^|/)\\.[gG][iI][tT](/|$)"))
    ${within(paths.root, paths.privateRoot) && paths.root !== paths.privateRoot ? `(deny file-read* (subpath ${quote(paths.privateRoot)}))` : ''}`
  if (process.platform !== 'darwin') throw new Error('Scoped repository search currently requires the macOS sandbox.')
  return new Promise<string>((resolve, reject) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, executable, ...args], { cwd: paths.root,
      env: { PATH: '/usr/bin:/bin', HOME: '/var/empty', LANG: 'en_US.UTF-8', RIPGREP_CONFIG_PATH: '' }, stdio: ['ignore','pipe','pipe'] })
    const chunks: Buffer[] = []
    let error = '', size = 0, exceeded = false
    const abort = () => child.kill('SIGKILL')
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', data => { size += data.length; if (size > 8_000_000) { exceeded = true; abort() } else chunks.push(data) })
    child.stderr.on('data', data => { if (error.length < 2000) error += data.toString() })
    child.on('error', reject)
    child.on('close', (code, termination) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason)
      else if (exceeded) reject(new Error('Search output exceeded 8 MB. Narrow the directory, glob or expression.'))
      else if (code !== 0 && code !== 1) reject(new Error(`Repository search failed (${code ?? termination}): ${error.slice(0, 1000)}`))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

export async function searchRepository(paths: RepositoryPaths, args: Search, signal: AbortSignal) {
  const absolute = await paths.check(args.path)
  if (!(await lstat(absolute)).isDirectory()) throw new Error('Search path must be a directory.')
  const explicitScope = Boolean(args.path) || args.glob !== '**/*' && !/^[*?[]/.test(args.glob)
  if ((args.hidden || args.include_ignored) && !explicitScope) throw new Error('Searching hidden or ignored files requires an explicit subdirectory or scoped filename glob.')
  const common = ['--no-config', '--no-require-git', '--no-ignore-parent', '--no-ignore-global', '--no-follow',
    '--glob', '!.git', '--glob', '!**/.git/**']
  if (!args.include_ignored) common.push('--glob', '!node_modules', '--glob', '!vendor', '--glob', '!dist', '--glob', '!build', '--glob', '!coverage', '--glob', '!.next')
  if (args.hidden) common.push('--hidden')
  if (args.include_ignored) common.push('--no-ignore')
  // Enumerate from the repository root so --no-ignore-parent excludes only
  // external rules; a narrowed path still honors root/intermediate ignore files.
  // Filter names before validating or searching content.
  // Enumerate names first and validate every file before content search. This
  // excludes hardlinks and private paths before ripgrep can read their bytes.
  const names = (await execute(paths, [...common, '--files', '--null', '--', '.'], signal)).split('\0').filter(Boolean).sort()
  const prefix = args.path.split('/').filter(Boolean).join('/')
  const files: string[] = []
  for (const name of names) {
    signal.throwIfAborted()
    const path = name.replace(/^\.\//, '')
    if (prefix && !path.startsWith(prefix + '/')) continue
    if (!minimatch(path, args.glob, { dot: Boolean(args.hidden), nocomment: true, nonegate: true })) continue
    if (files.length >= 50000) throw new Error('Search has over 50,000 candidate files; narrow its directory or glob.')
    try { await paths.check(path); files.push(path) } catch { /* never read inaccessible candidates */ }
  }
  const epoch = revision(JSON.stringify(await Promise.all(files.map(async path => { const info = await lstat(await paths.check(path)); return [path, info.size, info.mtimeMs, info.ino] }))))
  const key = revision(JSON.stringify([paths.root, { ...args, cursor: undefined, limit: undefined }, epoch]))
  let offset = 0
  if (args.cursor) {
    let cursor: any
    try { cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString()) } catch {}
    if (cursor?.key !== key || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error('Search cursor is stale or invalid. Start a fresh search.')
    offset = cursor.offset
  }
  const found: { path: string; line?: number; text?: string }[] = []
  if (args.text === undefined) found.push(...files.map(path => ({ path })))
  else for (let index = 0; index < files.length; index += 100) {
    signal.throwIfAborted()
    const output = await execute(paths, ['--no-config', '--no-follow', '--json', '--max-filesize', '1M', '--max-columns', '2000',
      ...(args.regex ? [] : ['--fixed-strings']), `--regexp=${args.text}`,
      args.case_sensitive === false ? '--ignore-case' : '--case-sensitive', '--', ...files.slice(index, index + 100)], signal)
    for (const line of output.split('\n').filter(Boolean)) {
      const record = JSON.parse(line)
      if (record.type !== 'match') continue
      const path = record.data.path.text
      if (!path) continue
      await paths.check(path)
      found.push({ path, line: record.data.line_number, text: (record.data.lines.text ?? '').trimEnd().slice(0, 1500) })
    }
    if (found.length > offset + args.limit) break
  }
  const more = found.length > offset + args.limit
  return { results: found.slice(offset, offset + args.limit), truncated: more,
    next_cursor: more ? Buffer.from(JSON.stringify({ key, offset: offset + args.limit })).toString('base64url') : null }
}
