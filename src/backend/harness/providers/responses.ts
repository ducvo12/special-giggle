import { parseContextUsage } from '../../models/usage.ts'
import type { ModelAdapter, ModelOptions, NativeItem, ToolCall } from '../types.ts'
import { HarnessError } from '../types.ts'
import { modelRequest } from './http.ts'
import { readModelEvents } from './stream.ts'

export function responsesAdapter(options: ModelOptions): ModelAdapter {
  return {
    user: text => ({ role: 'user', content: [{ type: 'input_text', text }] }),
    assistant: text => ({ role: 'assistant', content: [{ type: 'output_text', text }] }),
    toolResult: (call, output) => ({ type: 'function_call_output', call_id: call.id, output }),
    async step(input, instructions, tools) {
      let text = ''
      let output: NativeItem[] = []
      const body = {
        model: options.connection.model,
        instructions,
        input,
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content'],
        ...(options.connection.effort ? { reasoning: { effort: options.connection.effort } } : {}),
        tools: tools.length
          ? [
              {
                type: 'namespace',
                name: 'granite',
                description: 'Tools managed by Granite.',
                tools: tools.map(tool => ({
                  type: 'function',
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                  strict: false
                }))
              }
            ]
          : []
      }
      const response = await modelRequest(options, 'responses', body)
      const items = new Map<number, NativeItem>()
      await readModelEvents(response, event => {
        if (event.type === 'error' || event.type === 'response.failed') {
          throw new HarnessError(
            'The model could not finish. Check account limits, model access, and the connection.'
          )
        }

        if (event.type === 'response.incomplete') {
          throw new HarnessError(
            'The model reached its limit before finishing. Partial text and completed actions are kept.'
          )
        }

        const usage = parseContextUsage(event.response?.usage)
        if (usage) options.onUsage?.(usage)

        if (event.type === 'response.output_text.delta') {
          text += event.delta
          options.onText(event.delta)
        }

        if (
          event.type === 'response.reasoning_summary_text.delta' ||
          event.type === 'response.reasoning_text.delta'
        ) {
          options.onReasoning(typeof event.delta === 'string' ? event.delta.length : 0)
        }

        if (event.type === 'response.output_item.done') {
          items.set(event.output_index, event.item)
        }

        if (event.type !== 'response.completed') {
          return false
        }

        if (event.response?.status !== 'completed') {
          throw new HarnessError('The model response was not completed.')
        }

        output =
          event.response.output ??
          [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item)

        if (!Array.isArray(output)) {
          throw new HarnessError('The model returned an invalid response.')
        }

        return true
      })

      // Some providers emit a completed message without text deltas.
      if (!text) {
        text = output
          .filter(item => item.type === 'message')
          .flatMap(item => item.content ?? [])
          .filter(part => part.type === 'output_text')
          .map(part => part.text)
          .join('')

        if (text) {
          options.onText(text)
        }
      }

      const calls: ToolCall[] = output
        .filter(item => item.type === 'function_call')
        .map(item => ({
          id: item.call_id,
          name: item.name,
          namespace: item.namespace,
          arguments: item.arguments
        }))

      // Preserve every native item, including opaque reasoning, in its original
      // order. Flattening to display text loses reasoning continuity.
      return { output, calls, text }
    }
  }
}
