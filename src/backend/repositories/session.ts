import { constants } from 'node:fs'
import { open, chmod, lstat, mkdir, readFile, realpath, rename, unlink, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fingerprint, localGit, scanPaths, scanTree, type TreeState } from './changes.ts'
import { RepositoryPaths } from './paths.ts'
import { copyCommandWorkspace, gitManifest, mergeGitFile } from './command-workspace.ts'
import { runRepositoryProcess, type CommandResult } from './process.ts'
import type { RepositoryRecord, RepositoryStore } from './store.ts'

export class StaleRepositoryEdit extends Error {}

export class RepositorySession {
  readonly paths: RepositoryPaths
  private revisions = new Map<string, string | null>()
  readonly record: RepositoryRecord
  private store: RepositoryStore
  readonly signal: AbortSignal
  private changed: () => void
  constructor(record: RepositoryRecord, store: RepositoryStore, signal: AbortSignal, changed: () => void) {
    this.record = record
    this.store = store
    this.signal = signal
    this.changed = changed
    this.paths = new RepositoryPaths(record.root, store.privateRoot, record.internalRoot)
  }
  async read(path: string, offset = 0, limit = 200) {
    this.signal.throwIfAborted()
    const absolute = await this.paths.check(path)
    const info = await lstat(absolute)
    if (!info.isFile() || info.size > 1_000_000) throw new Error('Read a text file of at most 1 MB.')
    const data = await readFile(absolute)
    const revision = fingerprint(data)
    this.revisions.set(path, revision)
    if (data.includes(0) || Buffer.from(data.toString()).compare(data) !== 0) return { path, revision, binary: true, size: data.length }
    const lines = data.toString().split('\n')
    return { path, revision, totalLines: lines.length, offset, content: lines.slice(offset, offset + limit).join('\n'), truncated: offset + limit < lines.length }
  }
  async existsRevision(path: string) {
    const absolute = await this.paths.check(path)
    try { return (await lstat(absolute)).isDirectory() ? 'directory' : fingerprint(await readFile(absolute)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  private async guard(path: string, expected: string | null) {
    if (expected !== null && this.revisions.get(path) !== expected) throw new Error('Read this file before changing it; use its returned revision.')
    if (await this.existsRevision(path) !== expected) throw new StaleRepositoryEdit(`Stale edit rejected for ${path}. Read the current file and make one corrected attempt. No change was applied.`)
  }
  private async mutate(paths: string[], operation: () => Promise<void>) {
    this.signal.throwIfAborted()
    this.store.assertAvailable(this.record.projectId)
    const parentOperation = this.record.pending
    const uncaptured = paths.filter(path => !this.record.touched.includes(path) && !Object.hasOwn(this.record.baseline, path))
    Object.assign(this.record.baseline, await scanPaths(this.paths, uncaptured, this.signal))
    this.record.pending = { ...parentOperation, kind: 'file' }
    this.record.touched = [...new Set([...this.record.touched, ...paths])]
    this.store.save(this.record)
    try { await operation() }
    finally {
      await this.store.refresh(this.record)
      this.record.pending = parentOperation
      this.store.save(this.record)
      this.changed()
    }
  }
  async write(path: string, content: Buffer, revision: string | null, commandOutput = false) {
    if (content.length > (commandOutput ? 128_000_000 : 1_000_000)) throw new Error('Repository writes are limited to 1 MB per file.')
    const absolute = await this.paths.check(path)
    await this.guard(path, revision)
    await this.mutate([path], async () => {
      await mkdir(dirname(absolute), { recursive: true })
      await this.paths.check(path)
      if (revision === null) {
        const file = await open(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644)
        try { await file.writeFile(content) } finally { await file.close() }
      } else {
        const temporary = join(dirname(absolute), `.granite-${randomUUID()}.tmp`)
        const mode = (await lstat(absolute)).mode
        try {
          await writeFile(temporary, content, { flag: 'wx', mode })
          await this.paths.check(path); await this.guard(path, revision); this.signal.throwIfAborted()
          await rename(temporary, absolute)
        } finally { await rm(temporary, { force: true }) }
      }
    })
    this.revisions.set(path, fingerprint(content))
    return { path, revision: fingerprint(content) }
  }
  async edit(path: string, old: string, next: string, all: boolean, revision: string) {
    const current = await this.read(path, 0, 2_000_000)
    if (!('content' in current) || current.content === undefined) throw new Error('Use a text file for this operation.')
    if (current.revision !== revision) throw new StaleRepositoryEdit('Stale edit rejected. Read the file again before a corrected attempt.')
    if (!old || !current.content.includes(old) || !all && current.content.split(old).length !== 2) throw new Error('Exact edit text is missing or ambiguous; read the file and use a unique match.')
    return this.write(path, Buffer.from(all ? current.content.replaceAll(old, next) : current.content.replace(old, next)), revision)
  }
  async remove(path: string, revision: string) {
    const absolute = await this.paths.check(path); await this.guard(path, revision)
    await this.mutate([path], async () => { await this.guard(path, revision); await this.paths.check(path); await unlink(absolute) })
    this.revisions.delete(path)
    return { deleted: path }
  }
  async move(path: string, destination: string, revision: string) {
    const source = await this.paths.check(path), target = await this.paths.check(destination)
    await this.guard(path, revision); await this.guard(destination, null)
    // Link+unlink preserves the original if the destination appears concurrently.
    // Files are the only rename targets; no recursive directory mutation.
    const { link } = await import('node:fs/promises')
    await this.mutate([path, destination], async () => {
      await mkdir(dirname(target), { recursive: true }); await this.paths.check(destination); await this.guard(path, revision)
      await link(source, target)
      try {
        // The temporary second hard link is ours. Recheck its source revision
        // directly before unlinking; ordinary path checks reject hard links.
        await this.paths.check(path.split('/').slice(0, -1).join('/'))
        if ((await lstat(source)).isSymbolicLink() || fingerprint(await readFile(source)) !== revision) throw new StaleRepositoryEdit('Source changed during rename; nothing was removed.')
        this.signal.throwIfAborted(); await unlink(source)
      }
      catch (error) {
        const sourceState = await lstat(source).catch(() => null)
        const targetState = await lstat(target).catch(() => null)
        if (sourceState && targetState && !targetState.isSymbolicLink() && sourceState.ino === targetState.ino && fingerprint(await readFile(target)) === revision) await unlink(target)
        // A replacement or edit at the destination belongs to the external
        // writer; do not remove it while cleaning up a failed rename.
        throw error
      }
    })
    this.revisions.delete(path)
    this.revisions.set(destination, revision)
    return { renamed: path, to: destination, revision }
  }
  async patch(path: string, hunks: string, revision: string) {
    const current = await this.read(path, 0, 2_000_000)
    if (!('content' in current) || current.content === undefined) throw new Error('Use a text file for this operation.')
    if (current.revision !== revision) throw new StaleRepositoryEdit('Stale patch rejected. Read the current file first.')
    if (!hunks.startsWith('@@')) throw new Error('Provide unified diff hunks beginning with @@; the path is supplied separately.')
    const directory = await mkdtemp(join(tmpdir(), 'granite-patch-'))
    try {
      await writeFile(join(directory, 'file'), current.content)
      await localGit(['apply', '--no-index', '--include=file', '--whitespace=nowarn', '-'], directory, `--- a/file\n+++ b/file\n${hunks}\n`)
      if (!(await lstat(join(directory, 'file'))).isFile()) throw new Error('Patch must produce one regular text file.')
      return await this.write(path, await readFile(join(directory, 'file')), revision)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
  async command(executable: string, args: string[], cwd = '', gitWrite = false, network = false, writable = true) {
    await this.paths.check(cwd)
    if (writable) this.store.assertAvailable(this.record.projectId)
    const before = await scanTree(this.paths, this.signal)
    const staging = await realpath(await mkdtemp(join(tmpdir(), 'granite-repository-command-')))
    const stage = join(staging, 'repository')
    let outcome: CommandResult | undefined
    let importingGit = false
    this.record.pending = { kind: 'command', external: network, workspace: staging }
    this.store.save(this.record)
    try {
      const initialGit = await gitManifest(this.paths.root).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {} as TreeState
        throw error
      })
      const metadata = gitWrite ? initialGit : undefined
      await copyCommandWorkspace(this.paths.root, stage, true)
      if (metadata) {
        const copied = await gitManifest(stage).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {} as TreeState
          throw error
        })
        if (Object.keys(copied).length !== Object.keys(metadata).length || Object.keys(metadata).some(path => copied[path]?.hash !== metadata[path].hash)) throw new Error('Git state changed while preparing the command copy. Try again after reviewing current state.')
      }
      outcome = await runRepositoryProcess({ root: stage, privateRoot: this.paths.privateRoot, cwd: join(stage, cwd),
        executable, args, gitWrite, network, writable, signal: this.signal,
        onStart: process => { this.record.pending!.process = process; this.store.save(this.record) } })
      if (outcome.exitCode === null || outcome.timedOut) return { ...outcome, notice: 'Command copy was not applied because execution did not finish.' }
      this.signal.throwIfAborted()
      if (writable) {
        const stagedPaths = new RepositoryPaths(stage, this.paths.privateRoot)
        const after = await scanTree(stagedPaths, this.signal)
        const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter(path => before[path]?.hash !== after[path]?.hash || before[path]?.mode !== after[path]?.mode)
          .sort((a, b) => {
            const rank = (path: string) => after[path]?.directory ? 0 : before[path]?.directory && !after[path] ? 2 : 1
            return rank(a) - rank(b) || (rank(a) === 2 ? b.length - a.length : a.length - b.length) || a.localeCompare(b)
          })
        // Validate the entire live-file set before importing the first change.
        // Later per-file guards also catch edits arriving during reconciliation.
        for (const path of changed) {
          if (before[path] && after[path] && Boolean(before[path].directory) !== Boolean(after[path].directory)) throw new Error('Command file/directory replacement requires separate native operations.')
          if (after[path]?.hash && (await lstat(join(stage, path))).isSymbolicLink()) throw new Error('Command-created symbolic links are not imported.')
          await this.paths.check(path)
          if (await this.existsRevision(path) !== (before[path]?.hash ?? null) || before[path] && ((await lstat(await this.paths.check(path))).mode & 0o777) !== before[path].mode) throw new StaleRepositoryEdit(`Command changes conflict with a newer live file: ${path}. No command changes were imported.`)
        }
        // Persist all original targets before publication so recovery only needs
        // these paths, even when command import stops between two files.
        for (const path of changed) {
          if (!this.record.touched.includes(path) && !Object.hasOwn(this.record.baseline, path) && before[path]) this.record.baseline[path] = before[path]
        }
        this.record.touched = [...new Set([...this.record.touched, ...changed])]
        this.record.pending = { kind: 'file', external: network, workspace: staging }
        this.store.save(this.record)
        for (const path of changed) {
          this.signal.throwIfAborted()
          if (after[path]?.directory || before[path]?.directory) {
            const absolute = await this.paths.check(path)
            await this.mutate([path], async () => {
              if (after[path]?.directory) {
                await mkdir(absolute, { recursive: true, mode: after[path].mode })
                if (after[path].mode !== undefined) await chmod(await this.paths.check(path), after[path].mode!)
              } else await rmdir(absolute) // Never remove a concurrent writer’s nonempty directory.
            })
            continue
          }
          if (before[path]) this.revisions.set(path, before[path].hash)
          if (after[path]) {
            const data = await readFile(join(stage, path))
            if (fingerprint(data) !== after[path].hash) throw new Error('Command output is still changing; remaining command changes were not applied.')
            await this.write(path, data, before[path]?.hash ?? null, true)
            if (after[path].mode !== undefined) {
              await chmod(await this.paths.check(path), after[path].mode!)
              await this.store.refresh(this.record)
            }
          } else await this.remove(path, before[path].hash)
        }
        if (metadata) {
          const afterGit = await gitManifest(stage)
          this.store.assertAvailable(this.record.projectId)
          importingGit = true
          this.record.pending = { kind: 'file', external: true, workspace: staging }; this.store.save(this.record)
          // Copy objects before references/indexes which may point to them.
          const changedGit = [...new Set([...Object.keys(metadata), ...Object.keys(afterGit)])]
            .filter(path => metadata[path]?.hash !== afterGit[path]?.hash)
            .sort((a, b) => Number(!a.startsWith('.git/objects/')) - Number(!b.startsWith('.git/objects/')) || a.localeCompare(b))
          for (const path of changedGit) {
            this.signal.throwIfAborted()
            await mergeGitFile(this.paths.root, stage, path, metadata[path]?.hash, afterGit[path]?.hash)
          }
          // Empty object/ref directories are part of a newly initialized Git
          // repository even though they have no manifest file entries yet.
          await mkdir(join(this.paths.root, '.git', 'objects'), { recursive: true })
          await mkdir(join(this.paths.root, '.git', 'refs'), { recursive: true })
          this.record.report.gitChanged = changedGit.length > 0
          importingGit = false
        }
      }
      return outcome
    } finally {
      try {
        await this.store.refresh(this.record)
        if (importingGit || network && (!outcome || outcome.timedOut || outcome.exitCode === null || this.signal.aborted)) {
          this.record.report.state = 'attention'; this.record.report.error = 'An authorized external/Git action was interrupted. Review its outcome before further writes.'
          this.record.pending = { ...this.record.pending ?? { kind: 'command' }, external: true }
        } else delete this.record.pending
      } catch (error) {
        this.record.report.state = 'attention'; this.record.report.error = error instanceof Error ? error.message : 'Could not verify command changes.'
      }
      this.store.save(this.record)
      this.changed()
      // A detached process can only affect scratch storage. Never follow links
      // while cleaning it and never import anything after the run has stopped.
      await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }
}
