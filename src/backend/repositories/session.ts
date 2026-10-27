import { constants } from 'node:fs'
import { open, chmod, link, lstat, mkdir, readFile, realpath, rename, unlink, symlink, readlink, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fingerprint, linkState, localGit, scanPaths, scanTree, type FileState, type TreeState } from './changes.ts'
import { RepositoryPaths } from './paths.ts'
import { copyCommandWorkspace, gitManifest, mergeGitFile } from './command-workspace.ts'
import { startRepositoryProcess, type CommandResult } from './process.ts'
import { copyVerifiedFile, inspectFile } from './files.ts'
import { validateRepositoryLink } from './links.ts'
import type { RepositoryCommandSnapshot } from '../../shared/repository.ts'
import { setTimeout as delay } from 'node:timers/promises'
import type { RepositoryRecord, RepositoryStore } from './store.ts'

type ProcessHandle = Awaited<ReturnType<typeof startRepositoryProcess>>
interface CommandSession {
  snapshot: RepositoryCommandSnapshot
  handle?: ProcessHandle
  controller: AbortController
  task?: Promise<CommandResult>
  ready: Promise<void>
  readyResolve: () => void
  lastPublish: number
  columns: number
  rows: number
}

export class StaleRepositoryEdit extends Error {}

export class RepositorySession {
  readonly paths: RepositoryPaths
  private sessions = new Map<string, CommandSession>()
  private busy = false
  private publishing = false
  private publicationSignal?: AbortSignal
  private publicationSession?: CommandSession
  private closed = false
  private environment?: Promise<string>
  private revisions = new Map<string, string | null>()
  readonly record: RepositoryRecord
  private store: RepositoryStore
  readonly signal: AbortSignal
  private changed: () => void
  constructor(record: RepositoryRecord, store: RepositoryStore, signal: AbortSignal, changed: () => void) {
    this.record = record
    this.record.baseline = Object.assign(Object.create(null), record.baseline)
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
    const absolute = await this.paths.check(path, { leafLink: true })
    try { if ((await lstat(absolute)).isSymbolicLink()) return linkState(await readlink(absolute)).hash; return (await lstat(absolute)).isDirectory() ? 'directory' : (await inspectFile(absolute, this.signal, false)).hash }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  private async guard(path: string, expected: string | null) {
    if (expected !== null && this.revisions.get(path) !== expected) throw new Error('Read this file before changing it; use its returned revision.')
    if (await this.existsRevision(path) !== expected) throw new StaleRepositoryEdit(`Stale edit rejected for ${path}. Read the current file and make one corrected attempt. No change was applied.`)
  }
  private async mutate(paths: string[], operation: () => Promise<void>) {
    this.signal.throwIfAborted()
    if (this.busy && !this.publishing) throw new Error('Finish or stop the active command before native repository edits.')
    if (this.publishing) { this.publicationSignal?.throwIfAborted(); await operation(); return }
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
  async write(path: string, content: Buffer, revision: string | null) {
    if (content.length > 1_000_000) throw new Error('Repository writes are limited to 1 MB per file.')
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
  private async importCommandFile(path: string, sourcePaths: RepositoryPaths, hash: string, revision: string | null, mode: number) {
    const absolute = await this.paths.check(path)
    await this.guard(path, revision)
    await this.mutate([path], async () => {
      await mkdir(dirname(absolute), { recursive: true })
      await this.paths.check(path)
      const temporary = join(dirname(absolute), `.granite-${randomUUID()}.tmp`)
      try {
        const source = await sourcePaths.check(path, { hardlinks: true })
        await copyVerifiedFile(source, temporary, hash, mode, this.publicationSignal ?? this.signal)
        await this.paths.check(path); await this.guard(path, revision); this.signal.throwIfAborted()
        // Exclusive creation for new paths; atomic replacement for known files.
        if (revision === null) await link(temporary, absolute)
        else await rename(temporary, absolute)
        this.markPublished()
      } finally { await rm(temporary, { force: true }) }
    })
    this.revisions.set(path, hash)
  }
  private async importCommandLink(path: string, stage: string, stagedPaths: RepositoryPaths, before?: FileState, after?: FileState) {
    const destination = await this.paths.check(path, { leafLink: true })
    const revision = before?.hash ?? null
    await this.guard(path, revision)
    await this.mutate([path], async () => {
      await mkdir(dirname(destination), { recursive: true })
      await this.paths.check(path, { leafLink: true })
      const temporary = join(dirname(destination), `.granite-${randomUUID()}.tmp`)
      try {
        if (after?.linkTarget !== undefined) {
          await validateRepositoryLink(stagedPaths, path, after.linkTarget)
          if (await readlink(await stagedPaths.check(path, { leafLink: true })) !== after.linkTarget) throw new Error('Command symbolic link changed during publication.')
          await validateRepositoryLink(this.paths, path, after.linkTarget)
          await symlink(after.linkTarget, temporary)
        } else if (after) {
          await stagedPaths.check(path, { hardlinks: true })
          await copyVerifiedFile(join(stage, path), temporary, after.hash, after.mode ?? 0o644, this.publicationSignal ?? this.signal)
        }
        await this.paths.check(path, { leafLink: true }); await this.guard(path, revision); this.signal.throwIfAborted()
        if (!after) await unlink(destination)
        // macOS link(2) can follow a symlink source. Create new symlinks with
        // symlink(2)'s exclusive destination semantics instead of hard-linking.
        else if (!before && after.linkTarget !== undefined) await symlink(after.linkTarget, destination)
        else if (!before) await link(temporary, destination)
        else await rename(temporary, destination)
        this.markPublished()
      } finally { await rm(temporary, { force: true }) }
    })
    if (after) this.revisions.set(path, after.hash)
    else this.revisions.delete(path)
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
    await this.mutate([path], async () => { await this.guard(path, revision); await this.paths.check(path); await unlink(absolute); this.markPublished() })
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
  private publishCommand(session: CommandSession, force = false) {
    if (!force && Date.now() - session.lastPublish < 100) return
    session.lastPublish = Date.now()
    session.snapshot.output = session.handle?.output.tail() ?? ''
    this.record.report.commands = [...this.sessions.values()].map(value => ({ ...value.snapshot }))
    this.record.report.commandVersion = (this.record.report.commandVersion ?? 0) + 1
    this.store.save(this.record); this.changed()
  }
  private markPublished() { if (this.publicationSession) this.publicationSession.snapshot.publication = 'partial' }
  private async commandHome() {
    return this.environment ??= (async () => {
      const home = await realpath(await mkdtemp(join(tmpdir(), 'granite-repository-environment-')))
      this.record.environment = home; this.store.save(this.record)
      return home
    })()
  }
  hasActiveCommands() { return this.busy }
  private start(executable: string, args: string[], cwd: string, gitWrite: boolean, network: boolean, writable: boolean, interactive: boolean, columns = 100, rows = 30) {
    this.signal.throwIfAborted()
    if (this.closed) throw new Error('This repository command owner has closed.')
    if (this.busy) throw new Error('Finish or stop the active command before starting another repository command.')
    this.busy = true
    let readyResolve!: () => void
    const ready = new Promise<void>(resolve => { readyResolve = resolve })
    const session: CommandSession = { snapshot: { id: randomUUID(), command: executable === '/bin/sh' && args[0] === '-c' ? args[1] : [executable, ...args].join(' '), cwd, interactive,
      status: 'starting', publication: 'staged', inputRevision: 0, output: '' }, controller: new AbortController(), ready, readyResolve, lastPublish: 0, columns, rows }
    this.sessions.set(session.snapshot.id, session); this.publishCommand(session, true)
    session.task = this.executeCommand(executable, args, cwd, gitWrite, network, writable, session).then(result => {
      session.snapshot.exitCode = result.exitCode
      session.snapshot.status = result.stopped ? 'stopped' : result.exitCode === 0 ? 'complete' : 'failed'
      if (session.snapshot.publication === 'staged') session.snapshot.publication = 'discarded'
      return result
    }, error => {
      session.snapshot.status = this.signal.aborted || session.controller.signal.aborted ? 'stopped' : 'failed'
      session.snapshot.error = session.snapshot.status === 'stopped' ? 'Command stopped. Unfinished staged changes were discarded.' : error instanceof Error ? error.message : 'Command failed.'
      if (session.snapshot.publication === 'staged') session.snapshot.publication = 'discarded'
      throw error
    }).finally(() => { this.busy = false; readyResolve(); this.publishCommand(session, true) })
    void session.task.catch(() => {})
    return session
  }
  async command(executable: string, args: string[], cwd = '', gitWrite = false, network = false, writable = true) {
    return this.start(executable, args, cwd, gitWrite, network, writable, false).task!
  }
  async startCommand(command: string, cwd = '', network = false, interactive = true, columns = 100, rows = 30) {
    const session = this.start('/bin/sh', ['-c', command], cwd, false, network, true, interactive, columns, rows)
    await session.ready
    return this.readCommand(session.snapshot.id, 0, 100)
  }
  private session(id: string) {
    this.signal.throwIfAborted()
    const session = this.sessions.get(id)
    if (!session || this.closed) throw new Error('Command session is unavailable in this run/repository.')
    return session
  }
  async readCommand(id: string, offset = 0, waitMs = 1000) {
    const session = this.session(id)
    if (this.busy && ['starting','running','publishing'].includes(session.snapshot.status) && waitMs) {
      await Promise.race([session.task!.catch(() => {}), delay(waitMs, undefined, { signal: this.signal })])
    }
    return { ...session.snapshot, ...(session.handle?.output.read(offset) ?? { output: '', offset: 0, nextOffset: 0, available: 0, truncated: false }) }
  }
  async inputCommand(id: string, revision: number, data: string, columns?: number, rows?: number) {
    if ((columns === undefined) !== (rows === undefined)) throw new Error('Supply terminal columns and rows together.')
    const session = this.session(id)
    await session.ready
    if (session.snapshot.status !== 'running' || !session.handle) throw new Error('Command session is not accepting input.')
    if (revision !== session.snapshot.inputRevision) throw new Error('Stale command input rejected. Read the session and use its current inputRevision.')
    session.snapshot.inputRevision++
    if (columns !== undefined && rows !== undefined) session.handle.resize(columns, rows)
    if (data) session.handle.write(data)
    this.publishCommand(session, true)
    return this.readCommand(id, 0, 100)
  }
  async stopCommand(id: string) {
    const session = this.session(id)
    if (['starting','running','publishing'].includes(session.snapshot.status)) {
      session.controller.abort(new Error('Command stopped by user/agent.'))
      session.handle?.stop()
      await session.task!.catch(() => {})
    }
    return this.readCommand(id, 0, 0)
  }
  async close() {
    if (this.closed) return
    for (const session of this.sessions.values()) {
      if (['starting','running','publishing'].includes(session.snapshot.status)) {
        session.controller.abort(new Error('The owning run ended.'))
        session.handle?.stop()
      }
      await session.task?.catch(() => {})
    }
    if (this.environment) await rm(await this.environment, { recursive: true, force: true })
    delete this.record.environment
    this.closed = true; this.store.save(this.record)
  }
  private async executeCommand(executable: string, args: string[], cwd: string, gitWrite: boolean, network: boolean, writable: boolean, session: CommandSession) {
    const commandSignal = AbortSignal.any([this.signal, session.controller.signal])
    commandSignal.throwIfAborted()
    await this.paths.check(cwd)
    if (writable) this.store.assertAvailable(this.record.projectId)
    const before = await scanTree(this.paths, commandSignal, false)
    const staging = await realpath(await mkdtemp(join(tmpdir(), 'granite-repository-command-')))
    const stage = join(staging, 'repository')
    let outcome: CommandResult | undefined
    let importingGit = false
    this.record.pending = { kind: 'command', external: network, workspace: staging }
    this.store.save(this.record)
    try {
      const initialGit = await gitManifest(this.paths.root, commandSignal).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {} as TreeState
        throw error
      })
      const metadata = gitWrite ? initialGit : undefined
      await copyCommandWorkspace(this.paths.root, stage, true, commandSignal)
      if (metadata) {
        const copied = await gitManifest(stage, this.signal).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {} as TreeState
          throw error
        })
        if (Object.keys(copied).length !== Object.keys(metadata).length || Object.keys(metadata).some(path => copied[path]?.hash !== metadata[path].hash)) throw new Error('Git state changed while preparing the command copy. Try again after reviewing current state.')
      }
      session.controller.signal.throwIfAborted()
      const handle = await startRepositoryProcess({ root: stage, container: staging, privateRoot: this.paths.privateRoot, cwd: join(stage, cwd),
        executable, args, gitWrite, network, writable, home: await this.commandHome(), interactive: session.snapshot.interactive, columns: session.columns, rows: session.rows,
        signal: commandSignal,
        onOutput: () => this.publishCommand(session),
        onStart: process => { this.record.pending!.process = { ...process }; this.store.save(this.record) } })
      session.handle = handle
      await handle.ready
      session.snapshot.status = 'running'; session.readyResolve(); this.publishCommand(session, true)
      outcome = await handle.done
      if (outcome.exitCode === null || outcome.timedOut || outcome.stopped) return { ...outcome, notice: 'Command copy was not applied because execution did not finish.' }
      this.signal.throwIfAborted(); session.controller.signal.throwIfAborted()
      session.snapshot.status = 'publishing'; this.publishCommand(session, true)
      if (writable) {
        const stagedPaths = new RepositoryPaths(stage, this.paths.privateRoot)
        const after = await scanTree(stagedPaths, commandSignal, false, true)
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
          if (after[path]?.linkTarget !== undefined) await validateRepositoryLink(stagedPaths, path, after[path].linkTarget!)
          await this.paths.check(path, { leafLink: true })
          if (await this.existsRevision(path) !== (before[path]?.hash ?? null) || before[path] && ((await lstat(await this.paths.check(path, { leafLink: true }))).mode & 0o777) !== before[path].mode) throw new StaleRepositoryEdit(`Command changes conflict with a newer live file: ${path}. No command changes were imported.`)
        }
        // Persist all original targets before publication so recovery only needs
        // these paths, even when command import stops between two files.
        const uncaptured = changed.filter(path => !this.record.touched.includes(path) && !Object.hasOwn(this.record.baseline, path))
        const originals = await scanPaths(this.paths, uncaptured, commandSignal)
        for (const path of uncaptured) {
          if (originals[path]?.hash !== before[path]?.hash || originals[path]?.mode !== before[path]?.mode) throw new StaleRepositoryEdit(`Command changes conflict with a newer live file: ${path}. No command changes were imported.`)
        }
        Object.assign(this.record.baseline, originals)
        this.record.touched = [...new Set([...this.record.touched, ...changed])]
        this.record.pending = { kind: 'file', external: network, workspace: staging }
        this.store.assertAvailable(this.record.projectId)
        this.store.save(this.record)
        this.publishing = true
        this.publicationSignal = commandSignal
        this.publicationSession = session
        for (const path of changed) {
          this.signal.throwIfAborted(); session.controller.signal.throwIfAborted()
          if (after[path]?.directory || before[path]?.directory) {
            const absolute = await this.paths.check(path)
            if (before[path]) this.revisions.set(path, before[path].hash)
            await this.mutate([path], async () => {
              await this.guard(path, before[path]?.hash ?? null)
              if (after[path]?.directory) {
                if (!before[path]) await mkdir(absolute, { mode: after[path].mode })
                if (!before[path]) this.markPublished()
                if (after[path].mode !== undefined) await chmod(await this.paths.check(path), after[path].mode!)
              } else await rmdir(absolute) // Never remove a concurrent writer’s nonempty directory.
              this.markPublished()
            })
            session.snapshot.publication = 'partial'
            continue
          }
          if (before[path]) this.revisions.set(path, before[path].hash)
          if (before[path]?.linkTarget !== undefined || after[path]?.linkTarget !== undefined) {
            await this.importCommandLink(path, stage, stagedPaths, before[path], after[path]); session.snapshot.publication = 'partial'; continue
          }
          if (after[path]) {
            await this.importCommandFile(path, stagedPaths, after[path].hash, before[path]?.hash ?? null, after[path].mode ?? 0o644)
            if (after[path].mode !== undefined) {
              await chmod(await this.paths.check(path), after[path].mode!)
            }
          } else await this.remove(path, before[path].hash)
          session.snapshot.publication = 'partial'
        }
        if (metadata) {
          const afterGit = await gitManifest(stage, this.signal)
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
      session.snapshot.publication = writable ? 'applied' : 'discarded'
      return outcome
    } finally {
      this.publishing = false
      this.publicationSignal = undefined
      this.publicationSession = undefined
      let reconciliationError: unknown
      try {
        await this.store.refresh(this.record)
        if (session.handle?.settlementError()) {
          this.record.report.state = 'attention'; this.record.report.error = session.handle.settlementError()
          // Retain the durable process identity for a later verified recheck.
        } else if (importingGit || network && (!outcome || outcome.timedOut || outcome.stopped || outcome.exitCode === null || this.signal.aborted || session.controller.signal.aborted)) {
          this.record.report.state = 'attention'; this.record.report.error = 'An authorized external/Git action was interrupted. Review its outcome before further writes.'
          this.record.pending = { ...this.record.pending ?? { kind: 'command' }, external: true }
        } else delete this.record.pending
      } catch (error) {
        this.record.report.state = 'attention'; this.record.report.error = error instanceof Error ? error.message : 'Could not verify command changes.'
        reconciliationError = error
      }
      this.store.save(this.record)
      this.changed()
      // A detached process can only affect scratch storage. Never follow links
      // while cleaning it and never import anything after the run has stopped.
      await rm(staging, { recursive: true, force: true }).catch(() => {})
      if (reconciliationError) throw new Error(this.record.report.error)
    }
  }
}
