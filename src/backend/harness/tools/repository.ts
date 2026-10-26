import { z } from 'zod'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { matchesGlob } from 'node:path'
import type { ToolDefinition } from '../types.ts'
import type { RepositoryTarget } from '../../repositories/access.ts'
import { userAuthorized } from '../../repositories/access.ts'
import type { RepositorySession } from '../../repositories/session.ts'
import { fingerprint } from '../../repositories/changes.ts'
import { AgentFilesystem } from '../../workspace/filesystem.ts'

export interface RepositoryTools {
  signal: AbortSignal
  access: () => RepositoryTarget[]
  owner?: RepositorySession
  userMessages: () => string[]
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
    define('repo_search', 'Find filenames by simple glob, or literal text with bounded excerpts. Skips links and Git metadata. Does not load the whole repository into context.', z.object({ project_id: project, path: path.default(''), glob: z.string().max(512).default('**/*'), text: z.string().max(500).optional(), limit: z.number().int().min(1).max(100).default(50) }), async args => {
      if (/[{}]/.test(args.glob)) throw new Error('Use a simple glob without brace expansion.')
      const repository = target(args.project_id), results: { path: string; line?: number; text?: string }[] = []
      let visited = 0, truncated = false
      async function visit(dir: string) {
        for (const entry of await readdir(await repository.paths.check(dir), { withFileTypes: true })) {
          context.owner?.signal.throwIfAborted()
          if (++visited > 25_000 || results.length >= args.limit) { truncated = true; return }
          if (entry.name.toLowerCase() === '.git' || entry.isSymbolicLink()) continue
          const file = dir ? `${dir}/${entry.name}` : entry.name
          const absolute = await repository.paths.check(file)
          if (entry.isDirectory()) await visit(file)
          else if (entry.isFile() && matchesGlob(file, args.glob)) {
            if (args.text === undefined) results.push({ path: file })
            else if ((await lstat(absolute)).size <= 1_000_000) {
              const data = await readFile(absolute)
              if (!data.includes(0)) for (const [index, text] of data.toString().split('\n').entries()) {
                if (text.includes(args.text)) results.push({ path: file, line: index + 1, text: text.slice(0, 500) })
                if (results.length >= args.limit) break
              }
            }
          }
        }
      }
      await visit(args.path)
      return { results, truncated }
    }),
    define('request_repository_edit', 'When the user requests edits from outside a project, ask to move this chat permanently into that project between runs. This does not move or grant write access.', z.object({ project_id: project }), async args => {
      target(args.project_id)
      context.requestEntry(args.project_id)
      return { message: 'Ask the user to approve permanent project entry using Move chat. Finish this run before moving; no repository write has been authorized by this request.' }
    })
  ]
  // No mutation schemas are exposed to outside chats, even if they know names.
  if (context.owner) {
    tools.push(
      define('repo_write', 'Create or replace a repository file. Existing files require the revision from repo_read; use null only for new files. Ordinary edits have standing project permission.', z.object({ path, content: z.string().max(1_000_000), revision: revision.nullable(), encoding: z.enum(['utf8','base64']).default('utf8') }), async args => {
        if (args.encoding === 'base64' && Buffer.from(args.content, 'base64').toString('base64') !== args.content) throw new Error('Provide canonical base64 data.')
        return own().write(args.path, Buffer.from(args.content, args.encoding), args.revision)
      }),
      define('repo_edit', 'Apply an exact text replacement after a fresh repo_read. A stale revision never overwrites the newer file.', z.object({ path, old_string: z.string().min(1).max(100_000), new_string: z.string().max(100_000), replace_all: z.boolean().default(false), revision }), async args => own().edit(args.path, args.old_string, args.new_string, args.replace_all, args.revision)),
      define('repo_patch', 'Apply unified diff hunks beginning with @@ to one freshly read text file. Git applies the patch in scratch storage before a guarded repository write.', z.object({ path, patch: z.string().max(100_000), revision }), async args => own().patch(args.path, args.patch, args.revision)),
      define('repo_rename', 'Rename one freshly read file to a new relative path. Existing destinations are never overwritten.', z.object({ path, destination: path, revision }), async args => own().move(args.path, args.destination, args.revision)),
      define('repo_delete', 'Delete one freshly read file, only if its revision is unchanged.', z.object({ path, revision }), async args => own().remove(args.path, args.revision)),
      { ...define('repo_command', 'Run a shell command in this project until completion or Stop, with no elapsed-time or repository-size limit. Git metadata is read-only; network is denied unless explicitly granted. Runs in a temporary repository copy; finished changes are imported with revision guards. Stop discards unfinished command-copy changes. Output previews are bounded to protect application memory. Requires terminal enabled.', z.object({ command: z.string().min(1), cwd: z.string().default(''), network: z.boolean().default(false) }), async args => own().command('/bin/sh', ['-c', args.command], args.cwd, false, args.network)),
        approval: async args => {
          own()
          return args.network && !userAuthorized(context.userMessages(), 'command', args.command)
            ? { kind: 'terminal', title: 'Allow network access for this command?', detail: `${args.command}\n\nRepository: ${own().record.report.name}\nWorking directory: ${args.cwd || '/'}\nNetwork access and dependency/remote effects are not undone by Stop.` } : null
        }
      })
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
