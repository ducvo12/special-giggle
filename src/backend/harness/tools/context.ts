import { z } from 'zod'
import type { ToolDefinition } from '../types.ts'
import type { ContextSession } from '../../context/session.ts'
import { defineTool } from './define.ts'

export function contextTools(session: ContextSession): ToolDefinition[] {
  const { service, agentId, chatId, signal } = session
  const filters = {
    section_id: z.string().optional(),
    project_id: z.string().optional(),
    kind: z.enum(['message', 'summary', 'note', 'memory']).optional(),
    cursor: z.string().max(2000).optional(),
    limit: z.number().int().min(1).max(50).optional()
  }
  const sources = z.array(z.string().min(1).max(512)).min(1).max(100)
  const version = z.string().length(64)
  const define = <Schema extends z.ZodObject>(
    name: string,
    description: string,
    schema: Schema,
    permission: 'read' | 'write',
    run: (args: z.output<Schema>) => unknown | Promise<unknown>
  ): ToolDefinition => defineTool(name, description, schema, permission, async args => {
    signal.throwIfAborted()
    await service.sync(agentId)
    return run(args)
  })

  const tools = [
    define(
      'list_context',
      'Browse eligible chats, notes, memory and current summaries. Optional section/project/kind filters narrow access; use next_cursor for more. Results are source metadata, not full content.',
      z.object(filters),
      'read',
      args => {
        const result = service.list(agentId, chatId, args)
        for (const source of result.sources) session.refs.set(source.id, source.revision)
        return result
      }
    ),
    define(
      'search_context',
      'Search permitted saved chat text, titles, notes and summaries with SQLite full-text lexical retrieval. Returns bounded excerpts with source IDs; does not search code repositories.',
      z.object({ ...filters, query: z.string().min(1).max(1000) }),
      'read',
      args => {
        const result = service.list(agentId, chatId, args, args.query)
        for (const source of result.sources) {
          session.refs.set(source.id, source.revision)
          session.onSource(source)
        }
        return result
      }
    ),
    define(
      'read_context',
      'Read an eligible original source by source_id, with zero-based line offset and bounded limit. Includes its revision, ownership and supporting memory item IDs.',
      z.object({
        source_id: z.string().max(512),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(400).optional()
      }),
      'read',
      args => session.read(args.source_id, args.offset, args.limit)
    )
  ]

  if (service.scope(agentId, chatId).chat.retention === 'temporary') return tools

  tools.push(
    define(
      'update_chat_summary',
      'Stage this chat’s continuity summary after meaningful completed outcomes; it publishes only if this run finishes successfully. Cover the latest processed user message; include supporting source IDs. expected_revision is null only on first creation. Never summarize another chat as your own.',
      z.object({
        summary: z.string().min(1).max(12000),
        through_message_id: z.string().max(128),
        expected_revision: version.nullable(),
        source_ids: sources
      }),
      'read',
      args => session.stageSummary(args)
    ),
    define(
      'save_note',
      'Create or replace a descriptive Markdown note in this section or, in Shared chats, agent-wide notes. Cite original source IDs. expected_revision is null for a new file; read existing notes before replacing.',
      z.object({
        scope: z.enum(['agent', 'section']),
        name: z.string().max(184),
        content: z.string().min(1).max(60000),
        expected_revision: version.nullable(),
        source_ids: sources
      }),
      'write',
      args => service.saveNote(agentId, chatId, args.scope, args.name, args.content, args.expected_revision, args.source_ids, signal)
    )
  )

  if (session.closed) return tools

  tools.push(
    define(
      'update_memory',
      'Apply typed changes to confirmed user facts in agent memory. Read current memory for expected_revision and existing item IDs. Upserts need direct user-message evidence; remove needs an existing item ID. Do not turn assistant echoes into independent evidence.',
      z.object({
        expected_revision: version,
        changes: z.array(z.discriminatedUnion('operation', [
          z.strictObject({ operation: z.literal('upsert'), id: z.string().optional(), text: z.string().min(1).max(2000), source_ids: sources }),
          z.strictObject({ operation: z.literal('remove'), id: z.string() })
        ])).min(1).max(20)
      }),
      'write',
      args => service.mutateMemory(agentId, chatId, args.expected_revision, args.changes, signal)
    ),
    {
      ...define(
        'propose_identity_change',
        'Propose an exact replacement of identity.md for explicit user approval. Read current identity from the run instructions; include its revision. Approval applies only to this exact content and revision; changes activate next run.',
        z.object({
          content: z.string().min(1).max(32000),
          expected_revision: version,
          reason: z.string().min(1).max(2000)
        }),
        'read',
        args => service.identity(agentId, chatId, args.content, args.expected_revision, signal)
      ),
      approval: async args => {
        const old = await session.identityPreview()
        if (old.revision !== args.expected_revision) throw new Error('Identity changed. Read the current revision before proposing again.')
        return {
          kind: 'write',
          title: 'Change this agent’s identity?',
          detail: `${args.reason}\n\nCurrent identity (revision ${old.revision}):\n${old.content}\n\nExact replacement:\n${args.content}\n\nTakes effect next run.`
        }
      }
    }
  )

  return tools
}
