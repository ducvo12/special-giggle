import { z } from 'zod'
import type { AgentFilesystem } from '../../workspace/filesystem.ts'
import type { ToolDefinition } from '../types.ts'

export function fileTools(workspace: AgentFilesystem): ToolDefinition[] {
  const path = z.string().min(1).max(1024)
  const content = z.string().max(100_000)
  const define = (
    name: string,
    description: string,
    schema: z.ZodType,
    permission: 'read' | 'write',
    run: (input: any) => Promise<unknown>
  ): ToolDefinition => ({
    name,
    description,
    parameters: z.toJSONSchema(schema),
    permission,
    run: async args => run(schema.parse(args))
  })

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
      'Create a workspace text file. Identity, configuration, and skills are read-only.',
      z.object({ file_path: path, content }),
      'write',
      args => workspace.write(args.file_path, args.content)
    ),
    define(
      'edit_file',
      'Replace exact text in a workspace file. Identity, configuration, and skills are read-only.',
      z.object({
        file_path: path,
        old_string: content.min(1),
        new_string: content,
        replace_all: z.boolean().optional()
      }),
      'write',
      args => workspace.edit(args.file_path, args.old_string, args.new_string, args.replace_all)
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
            z.object({
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
