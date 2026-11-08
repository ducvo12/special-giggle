import { z } from 'zod'
import type { ToolDefinition } from '../types.ts'

export function defineTool<Schema extends z.ZodObject>(
  name: string,
  description: string,
  schema: Schema,
  permission: ToolDefinition['permission'],
  run: (args: z.output<Schema>) => unknown | Promise<unknown>
): ToolDefinition {
  const strict = schema.strict()
  const parse = (args: unknown) => strict.parse(args) as z.output<Schema>
  return {
    name,
    description,
    parameters: z.toJSONSchema(strict, { target: 'draft-7' }),
    permission,
    parse,
    run: async args => run(parse(args))
  }
}
