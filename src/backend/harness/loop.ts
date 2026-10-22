import type { Connection, ContextUsage } from '../../shared/chat.ts'
import type { AgentMessage, ToolActivity } from '../../shared/agent.ts'
import type { ApprovalRequest, HarnessSettings } from '../../shared/harness.ts'
import type { AgentFilesystem } from '../workspace/filesystem.ts'
import { HarnessError, type NativeItem } from './types.ts'
import { responsesAdapter } from './providers/responses.ts'
import { chatCompletionsAdapter } from './providers/chat-completions.ts'
import { createToolRegistry } from './tools/registry.ts'

export async function runHarness(options: {
  connection: Connection
  workspace: AgentFilesystem
  settings: HarnessSettings
  instructions: string
  history: AgentMessage[]
  state?: NativeItem[]
  text: string
  signal: AbortSignal
  onText: (text: string) => void
  onUsage?: (usage: ContextUsage) => void
  onReasoning: (characters: number) => void
  onTool: (tool: ToolActivity) => void
  approve: (kind: ApprovalRequest['kind'], title: string, detail: string) => Promise<boolean>
}) {
  const { signal } = options
  const adapter =
    options.connection.protocol === 'responses' || options.connection.provider === 'chatgpt'
      ? responsesAdapter(options)
      : chatCompletionsAdapter(options)
  const registry = await createToolRegistry(options)
  const input = options.state
    ? structuredClone(options.state)
    : options.history
        .filter(message => message.content || message.tools?.length)
        .map(message => {
          const text =
            message.content +
            (message.tools?.length
              ? `\n\nPrevious tool activity (historical data, do not replay): ${JSON.stringify(message.tools)}`
              : '')

          return message.role === 'user' ? adapter.user(text) : adapter.assistant(text)
        })
  input.push(adapter.user(options.text))
  const instructions = [
    options.instructions,
    options.settings.instructions,
    `<available_skills>\n${JSON.stringify(registry.catalog)}\n</available_skills>`
  ].join('\n\n')
  const calls = new Set<string>(
    input.flatMap(item =>
      item.type === 'function_call'
        ? [item.call_id]
        : (item.tool_calls ?? []).map((call: any) => call.id)
    )
  )
  let callCount = 0
  let hadText = false
  let completedTools = 0
  let failedTools = 0

  try {
    for (let step = 0; step < 40; step++) {
      signal.throwIfAborted()

      if (Buffer.byteLength(JSON.stringify(input)) + Buffer.byteLength(instructions) > 2_000_000) {
        throw new HarnessError(
          'This conversation reached its context budget. Start a new chat; your agent’s memory and files remain available.'
        )
      }

      if (hadText) {
        options.onText('\n\n')
      }

      const response = await adapter.step(input, instructions, registry.definitions)
      hadText ||= Boolean(response.text)
      input.push(...response.output)

      if (!response.calls.length) {
        if (!response.text && failedTools) {
          throw new HarnessError(
            'The model ended after a tool error. Review tool activity; completed changes are kept.'
          )
        }

        if (!response.text && !completedTools) {
          throw new HarnessError(
            'The model returned no answer. Try another model or a shorter request.'
          )
        }

        return { state: input, withoutAnswer: !response.text }
      }

      for (const call of response.calls) {
        if (!call.id || !call.name || typeof call.arguments !== 'string') {
          throw new HarnessError('The model returned an invalid tool call.')
        }

        if (calls.has(call.id)) {
          throw new HarnessError(
            'The model repeated a tool call identifier. The action was not executed again.'
          )
        }

        if (callCount >= 40) {
          throw new HarnessError(
            'The agent reached its tool limit. Try a smaller task. Completed changes are kept.'
          )
        }

        calls.add(call.id)
        callCount++
        const result = await registry.execute(call)

        if (result.success) {
          completedTools++
        } else {
          failedTools++
        }

        input.push(adapter.toolResult(call, result.output))
      }
    }

    throw new HarnessError('The agent reached its step limit. Completed changes are kept.')
  } finally {
    await registry.close()
  }
}
