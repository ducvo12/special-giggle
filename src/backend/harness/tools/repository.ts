import { z } from 'zod'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { searchRepository } from '../../repositories/search.ts'
import type { ToolDefinition } from '../types.ts'
import type { RepositoryTarget } from '../../repositories/access.ts'
import { setupCommand } from '../../repositories/authorization.ts'
import { userAuthorized } from '../../repositories/access.ts'
import type { RepositorySession } from '../../repositories/session.ts'
import { fingerprint } from '../../repositories/changes.ts'
import { AgentFilesystem } from '../../workspace/filesystem.ts'

export interface RepositoryTools {
  signal: AbortSignal
  access: () => RepositoryTarget[]
  owner?: RepositorySession
  userMessages: () => string[]
  authorization?: import('../../repositories/authorization.ts').SetupAuthorization
  previews?: import('../../repositories/previews.ts').PreviewManager
  requestEntry: (projectId: string) => void
}

export function repositoryTools(context: RepositoryTools): ToolDefinition[] {
  const project = z.string().min(1).max(100), path = z.string().max(1024)
  const revision = z.string().regex(/^[a-f0-9]{64}$/)
  const define = (name: string, description: string, schema: z.ZodType, run: (args: any) => Promise<unknown>): ToolDefinition => ({
    name, description, parameters: z.toJSONSchema(schema, { target: 'draft-7' }), permission: 'repository', run
  })
  const target = (id: string) => {
    const found = context.access().find(target => target.projectId === id)
    if (!found) throw new Error('Repository is unavailable in this chat.')
    return found
  }
  const own = () => {
    const session = context.owner
    if (!session || !target(session.record.projectId).writable) throw new Error('Move this permanent chat into the repository project before editing. Approval cannot override membership.')
    return session
  }
  const tools = [
    define('list_repositories', 'List this chat’s permitted repositories and whether this chat may edit them. Does not load repository files.', z.object({}), async () => context.access().map(({ paths, ...access }) => access)),
    define('repo_list', 'List one permitted repository directory (maximum 500 entries); symbolic links are marked inaccessible.', z.object({ project_id: project, path: path.default('') }), async args => {
      const paths = target(args.project_id).paths
      return (await readdir(await paths.check(args.path), { withFileTypes: true })).filter(entry => entry.name.toLowerCase() !== '.git').slice(0, 500)
        .map(entry => ({ name: entry.name, directory: entry.isDirectory(), inaccessible: entry.isSymbolicLink() }))
    }),
    define('repo_read', 'Read a bounded file range, returning the revision required for edits. Binary files return size/revision only. Paths are relative.', z.object({ project_id: project, path, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(2000).default(200) }), async args => {
      const repository = target(args.project_id)
      if (context.owner?.record.projectId === repository.projectId) return context.owner.read(args.path, args.offset, args.limit)
      const absolute = await repository.paths.check(args.path)
      if ((await lstat(absolute)).size > 1_000_000) throw new Error('File exceeds the 1 MB read limit.')
      const data = await readFile(absolute)
      if (data.includes(0)) return { path: args.path, binary: true, size: data.length, revision: fingerprint(data) }
      // Reuse the established ranged-reader underneath Granite's mount checks.
      return { ...(await new AgentFilesystem(repository.paths.root).read(args.path, args.offset, args.limit)), revision: fingerprint(data) }
    }),
    define('repo_search', 'Search a permitted repository using packaged ripgrep. Filename glob or literal/regex text, case controls, excerpts and cursor pagination. Respects ignore rules and skips Git metadata, links, dependencies and generated folders. Hidden/ignored opt-in requires an explicit subdirectory. No whole-repo context dump.', z.object({ project_id: project, path: path.default(''), glob: z.string().max(512).default('**/*'), text: z.string().max(500).optional(), regex: z.boolean().default(false), case_sensitive: z.boolean().default(true), include_ignored: z.boolean().default(false), hidden: z.boolean().default(false), cursor: z.string().max(2000).optional(), limit: z.number().int().min(1).max(100).default(50) }), async args => searchRepository(target(args.project_id).paths, args, context.signal)),
    define('request_repository_edit', 'When the user requests edits from outside a project, ask to move this chat permanently into that project between runs. This does not move or grant write access.', z.object({ project_id: project }), async args => {
      target(args.project_id)
      context.requestEntry(args.project_id)
      return { message: 'Ask the user to approve permanent project entry using Move chat. Finish this run before moving; no repository write has been authorized by this request.' }
    })
  ]
  // No mutation schemas are exposed to outside chats, even if they know names.
  if (context.owner) {
    const commandApproval = async (args: any) => {
      own()
      if (args.network && context.authorization?.denied(own().record.runId, args.command)) throw new Error('Network permission was denied or revoked for this task. Wait for a new explicit user request; do not ask repeatedly or use another tool to bypass it.')
      return args.network && !(context.authorization?.allowed(own().record.runId, args.command) ?? userAuthorized(context.userMessages(), 'command', args.command))
        ? { kind: 'terminal' as const, title: 'Allow network access for this command?', detail: `${args.command}\n\nRepository: ${own().record.report.name}\nWorking directory: ${args.cwd || '/'}\n${setupCommand(args.command) ? 'Covers this package setup and necessary dependency installation steps in this task. ' : 'This command only. '}Network access and dependency/remote effects are not undone by Stop.` } : null
    }
    const commandApproved = (args: any, allowed: boolean) => {
      const record = own().record
      context.authorization?.approve(record.runId, record.agentId, record.conversationId, record.projectId, 'command', args.command, allowed)
    }
    const sessionId = z.string().uuid()
    tools.push(
      define('repo_write', 'Create or replace a repository file. Existing files require the revision from repo_read; use null only for new files. Ordinary edits have standing project permission.', z.object({ path, content: z.string().max(1_000_000), revision: revision.nullable(), encoding: z.enum(['utf8','base64']).default('utf8') }), async args => {
        if (args.encoding === 'base64' && Buffer.from(args.content, 'base64').toString('base64') !== args.content) throw new Error('Provide canonical base64 data.')
        return own().write(args.path, Buffer.from(args.content, args.encoding), args.revision)
      }),
      define('repo_edit', 'Apply an exact text replacement after a fresh repo_read. A stale revision never overwrites the newer file.', z.object({ path, old_string: z.string().min(1).max(100_000), new_string: z.string().max(100_000), replace_all: z.boolean().default(false), revision }), async args => own().edit(args.path, args.old_string, args.new_string, args.replace_all, args.revision)),
      define('repo_patch', 'Apply unified diff hunks beginning with @@ to one freshly read text file. Git applies the patch in scratch storage before a guarded repository write.', z.object({ path, patch: z.string().max(100_000), revision }), async args => own().patch(args.path, args.patch, args.revision)),
      define('repo_rename', 'Rename one freshly read file to a new relative path. Existing destinations are never overwritten.', z.object({ path, destination: path, revision }), async args => own().move(args.path, args.destination, args.revision)),
      define('repo_delete', 'Delete one freshly read file, only if its revision is unchanged.', z.object({ path, revision }), async args => own().remove(args.path, args.revision)),
      { ...define('repo_command', 'Run a noninteractive command until completion or Stop. Use repo_command_start for commands that may prompt or need incremental output. Commands share this run’s isolated HOME/cache. Finished changes are imported with revision guards; unfinished changes are discarded. Network needs authorization. Requires terminal enabled.', z.object({ command: z.string().min(1), cwd: z.string().default(''), network: z.boolean().default(false) }), async args => own().command('/bin/sh', ['-c', args.command], args.cwd, false, args.network)), approval: commandApproval, approved: commandApproved },
      { ...define('repo_command_start', 'Start a supervised command session in an isolated repository copy. Returns a session ID, incremental output, status and inputRevision. Interactive sessions have a real terminal. Use repo_command_read/input/stop until finished; do not finalize while a session is running. Changes remain staged until completion, then are imported with revision guards. One active command per repository run; HOME/cache persist across its commands. Network needs authorization.', z.object({ command: z.string().min(1), cwd: z.string().default(''), network: z.boolean().default(false), interactive: z.boolean().default(true), columns: z.number().int().min(20).max(500).default(100), rows: z.number().int().min(2).max(200).default(30) }), async args => own().startCommand(args.command, args.cwd, args.network, args.interactive, args.columns, args.rows)), permission: 'terminal', approval: commandApproval, approved: commandApproved },
      { ...define('repo_command_read', 'Read this run’s command status and a bounded plain-text output page. offset/nextOffset are output positions. wait_ms waits for progress, not an execution timeout. Observe publication/status before reporting success. No sessions are exposed across runs.', z.object({ session_id: sessionId, offset: z.number().int().min(0).default(0), wait_ms: z.number().int().min(0).max(10_000).default(1000) }), async args => own().readCommand(args.session_id, args.offset, args.wait_ms)), permission: 'terminal', approval: async () => null },
      { ...define('repo_command_input', 'Send input to a running session using its current inputRevision. Include newline/return to submit an answer; control characters such as Ctrl-C are supported. Stale input is rejected. Optional columns/rows resize the terminal. Answer only choices already known from the task; use ask_user when a consequential choice is missing; keep the session open while waiting.', z.object({ session_id: sessionId, input_revision: z.number().int().min(0), data: z.string().max(16_000).default(''), columns: z.number().int().min(20).max(500).optional(), rows: z.number().int().min(2).max(200).optional() }).refine(args => (args.columns === undefined) === (args.rows === undefined), 'Supply columns and rows together.'), async args => own().inputCommand(args.session_id, args.input_revision, args.data, args.columns, args.rows)), permission: 'terminal', approval: async () => null },
      { ...define('repo_command_stop', 'Stop this run’s command session and discard unfinished staged changes. Completed prior edits remain. Review interrupted external outcomes; do not silently replay them.', z.object({ session_id: sessionId }), async args => own().stopCommand(args.session_id)), permission: 'terminal', approval: async () => null })
  }
  if (context.owner && context.previews) {
    const previewId = z.string().uuid()
    const ownedRecord = () => own().record
    tools.push(
      { ...define('repo_preview_start', 'Start or replace this chat’s managed local preview when useful for the task; no separate user request or approval is required. Respect explicit user instructions not to start one. Use a settled repository snapshot. Bind explicitly to $HOST (127.0.0.1) and $PORT, provided by Granite; e.g. npm run dev -- --host "$HOST" --port "$PORT" for Vite or --hostname "$HOST" --port "$PORT" for Next.js. Public networking is denied. Poll repo_preview_read until ready; only ready previews may survive the final answer. Starting a preview does not prove a production build succeeded.', z.object({ command: z.string().min(1), cwd: z.string().default(''), port: z.number().int().min(0).max(65535).default(0) }), async args => {
        const record = ownedRecord()
        if (own().hasActiveCommands()) throw new Error('Finish the active command checkpoint before starting a preview.')
        return context.previews!.start(record, args.command, args.cwd, args.port, context.signal)
      }), permission: 'terminal', approval: async () => null },
      { ...define('repo_preview_list', 'List only this chat’s managed previews, including stopped/interrupted outcomes and snapshot revision.', z.object({}), async () => { const record = ownedRecord(); return context.previews!.list(record.agentId, record.conversationId) }), permission: 'terminal', approval: async () => null },
      { ...define('repo_preview_read', 'Inspect a managed preview’s actual readiness, URL, output and whether its snapshot differs from current code. It has no model or project reservation while idle. Refresh by starting again after edits; never claim stale code is current.', z.object({ preview_id: previewId, wait_ms: z.number().int().min(0).max(10_000).default(1000) }), async args => { const record = ownedRecord(); return context.previews!.read(record.agentId, record.conversationId, args.preview_id, args.wait_ms) }), permission: 'terminal', approval: async () => null },
      { ...define('repo_preview_stop', 'Stop this chat’s managed preview and clean its isolated copy. No live repository files are removed.', z.object({ preview_id: previewId }), async args => { const record = ownedRecord(); return context.previews!.stop(record.agentId, record.conversationId, args.preview_id) }), permission: 'terminal', approval: async () => null }
    )
  }
  tools.push({
    ...define('repo_git', 'Inspect Git status/diff/history in permitted repositories. Mutations require project membership and explicit authorization. Git metadata paths and operations are controlled; hooks and external diff helpers are disabled.', z.object({
      project_id: project, operation: z.enum(context.owner ? ['status','diff','log','show','init','add','commit','branch','switch','restore','reset','clean','push'] : ['status','diff','log','show']),
      paths: z.array(path).max(100).default([]), staged: z.boolean().default(false), message: z.string().max(10_000).optional(),
      ref: z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_./~^@{}-]{0,199}$/).optional(),
      remote: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/).default('origin')
    }), async args => {
      const repository = target(args.project_id)
      const mutation = !['status','diff','log','show'].includes(args.operation)
      const session = mutation ? own() : context.owner
      if (mutation && repository.projectId !== session!.record.projectId) throw new Error('Git mutations are limited to this chat’s own repository.')
      if (args.operation !== 'init') {
        const metadata = await lstat(`${await repository.paths.check('')}/.git`)
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Git tools require local .git directory metadata; external worktree metadata is not supported yet.')
      }
      for (const path of args.paths) await repository.paths.check(path)
      const git = gitArguments(args)
      if (session && session.record.projectId === repository.projectId) {
        return session.command('/usr/bin/git', git, '', mutation, args.operation === 'push', mutation)
      }
      const { runRepositoryProcess } = await import('../../repositories/process.ts')
      return runRepositoryProcess({ root: repository.paths.root, privateRoot: repository.paths.privateRoot,
        cwd: repository.paths.root, executable: '/usr/bin/git', args: git, writable: false,
        signal: context.owner?.signal ?? context.signal, onStart: () => {} })
    }),
    approval: async args => {
      target(args.project_id)
      if (['status','diff','log','show'].includes(args.operation)) return null
      if (own().record.projectId !== args.project_id) throw new Error('Git mutations require membership in this repository project.')
      const exact = ['git', args.operation, ...(args.message ? ['-m', args.message] : []), ...(args.operation === 'push' ? [args.remote] : []), ...(args.ref ? [args.ref] : []), ...args.paths].join(' ')
      return userAuthorized(context.userMessages(), args.operation) || userAuthorized(context.userMessages(), args.operation, exact) ? null : {
        kind: 'terminal', title: `Allow Git ${args.operation}?`,
        detail: `${own().record.report.name}\n${JSON.stringify(args, null, 2)}\n\nThis changes Git state/history or a remote. Stop does not undo it.`
      }
    }
  })
  return tools
}

function gitArguments(args: any) {
  const prefix = ['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'core.pager=cat']
  switch (args.operation) {
    case 'status': return [...prefix, 'status', '--short', '--untracked-files=all']
    case 'diff': return [...prefix, 'diff', '--no-ext-diff', '--no-textconv', ...(args.staged ? ['--cached'] : []), '--', ...args.paths]
    case 'log': return [...prefix, 'log', '-20', '--oneline', '--no-decorate']
    case 'show': return [...prefix, 'show', '--no-ext-diff', '--no-textconv', '--stat', args.ref ?? 'HEAD', '--', ...args.paths]
    case 'init': return [...prefix, 'init']
    case 'add': if (!args.paths.length) throw new Error('Specify the files to stage.'); return [...prefix, 'add', '--', ...args.paths]
    case 'commit': if (!args.message) throw new Error('Provide a commit message.'); return [...prefix, 'commit', '--no-gpg-sign', '-m', args.message]
    case 'branch': if (!args.ref) throw new Error('Provide a branch name.'); return [...prefix, 'branch', '--', args.ref]
    case 'switch': if (!args.ref) throw new Error('Provide a branch name.'); return [...prefix, 'switch', '--no-guess', args.ref]
    case 'restore': if (!args.paths.length) throw new Error('Specify the files to restore.'); return [...prefix, 'restore', '--', ...args.paths]
    case 'reset': return [...prefix, 'reset', '--mixed', args.ref ?? 'HEAD', '--', ...args.paths]
    case 'clean': if (!args.paths.length) throw new Error('Specify the untracked paths to remove.'); return [...prefix, 'clean', '-f', '--', ...args.paths]
    case 'push': if (!args.ref) throw new Error('Specify the destination branch.'); return [...prefix, 'push', '--', args.remote, args.ref]
    default: throw new Error('Unsupported Git operation.')
  }
}
