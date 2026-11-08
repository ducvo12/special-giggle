import type { ContextSession } from '../../context/session.ts'
import { locked, textFile } from '../../context/files.ts'
import { revision } from '../../context/store.ts'
import { z } from 'zod'
import type { AgentFilesystem } from '../../workspace/filesystem.ts'
import type { ToolDefinition } from '../types.ts'
import { defineTool } from './define.ts'

export function fileTools(workspace: AgentFilesystem, context?: ContextSession): ToolDefinition[] {
  const path = z.string().min(1).max(1024)
  const content = z.string().max(100_000)
  const define = <Schema extends z.ZodObject>(
    name: string,
    description: string,
    schema: Schema,
    permission: 'read' | 'write',
    run: (input: z.output<Schema>) => Promise<unknown>
  ): ToolDefinition => defineTool(name, description, schema, permission, async args => {
    if (permission === 'read') return run(args)

    // Serialize read/modify/write operations across runs sharing this root.
    return locked(`workspace:${workspace.root}`, () => run(args))
  })

  const readWriteTarget = async (path: string) => {
    await workspace.check(path)
    if (path !== '/memory.md' && !path.startsWith('/notes/')) {
      throw new Error('Only memory and Markdown notes are writable. Use propose_identity_change for identity.')
    }
    return textFile(workspace.root, path)
  }

  const saveNote = async (session: ContextSession, path: string, content: string, before: string | null) => {
    const { service, agentId, chatId, signal } = session
    const current = service.scope(agentId, chatId).chat.messages
      .filter(message => message.role === 'user' && message.delivery !== 'pending' && message.delivery !== 'cancelled')
      .at(-1)
    if (!current) throw new Error('A source user message is required.')
    if (path === '/memory.md') throw new Error('Use update_memory for typed, revision-guarded fact changes. edit_file does not edit user memory.')

    const sourceIds = [`message:${current.id}`, ...session.refs.keys()]
      .filter(id => id !== `file:${agentId}:/memory.md`)
    const evidence = service.supports(agentId, chatId, sourceIds)
      .filter(source => source.id !== `file:${agentId}:${path}`)
      .map(source => source.id)
    const expected = before === null ? null : revision(before)
    const saved = await service.saveNote(agentId, chatId, 'agent', path.slice('/notes/'.length), content, expected, evidence, signal)
    session.refs.set(saved.source_id, saved.revision)
    return saved
  }

  return [
    define(
      'ls',
      'List files in this agent’s workspace. Paths are virtual and rooted at /.',
      z.object({ path: path.default('/') }),
      'read',
      args => workspace.ls(args.path)
    ),
    define(
      'read_file',
      'Read a workspace text file before editing it.',
      z.object({
        file_path: path,
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(2000).optional()
      }),
      'read',
      args => workspace.read(args.file_path, args.offset, args.limit)
    ),
    define(
      'write_file',
      'Create a Markdown knowledge note under /notes. Use save_note to supply precise source references. Identity, configuration, skills and memory cannot be created by this tool.',
      z.object({ file_path: path, content }),
      'write',
      async args => {
        if (!context) return workspace.write(args.file_path, args.content)

        const before = await readWriteTarget(args.file_path)
        if (before !== null) throw new Error('File exists; read it before editing.')
        return saveNote(context, args.file_path, args.content, before)
      }
    ),
    define(
      'edit_file',
      'Replace exact text in a knowledge note. Use update_memory for user facts and propose_identity_change for identity; configuration and skills are read-only.',
      z.object({
        file_path: path,
        old_string: content.min(1),
        new_string: content,
        replace_all: z.boolean().optional()
      }),
      'write',
      async args => {
        if (!context) return workspace.edit(args.file_path, args.old_string, args.new_string, args.replace_all)

        const before = await readWriteTarget(args.file_path)
        if (before === null || !before.includes(args.old_string)) {
          throw new Error('Exact text was not found; read the current file.')
        }
        if (!args.replace_all && before.indexOf(args.old_string) !== before.lastIndexOf(args.old_string)) {
          throw new Error('Text is ambiguous; use a unique replacement.')
        }
        const content = args.replace_all
          ? before.split(args.old_string).join(args.new_string)
          : before.replace(args.old_string, args.new_string)
        return saveNote(context, args.file_path, content, before)
      }
    ),
    define(
      'glob',
      'Find filenames using a simple glob without brace expansion.',
      z.object({ pattern: z.string().max(512), path: path.default('/') }),
      'read',
      args => workspace.glob(args.pattern, args.path)
    ),
    define(
      'grep',
      'Find text in workspace files.',
      z.object({ pattern: z.string().max(512), path: path.default('/') }),
      'read',
      args => workspace.grep(args.pattern, args.path, null, 100)
    ),
    define(
      'write_todos',
      'Record a short task list for the current request. Do not plan simple questions.',
      z.object({
        todos: z
          .array(
            z.strictObject({
              content: z.string().max(1000),
              status: z.enum(['pending', 'in_progress', 'completed'])
            })
          )
          .max(30)
      }),
      'read',
      async args => ({ todos: args.todos })
    )
  ]
}
