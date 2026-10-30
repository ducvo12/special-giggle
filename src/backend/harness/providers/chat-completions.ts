import { parseContextUsage } from '../../models/usage.ts'
import type { ModelAdapter, ModelOptions, NativeItem, ToolCall } from '../types.ts'
import { HarnessError, ModelConnectionError } from '../types.ts'
import { modelRequest } from './http.ts'
import { readModelEvents } from './stream.ts'

export function chatCompletionsAdapter(options: ModelOptions): ModelAdapter {
  return {
    user: content => ({ role: 'user', content }),
    assistant: content => ({ role: 'assistant', content }),
    toolResult: (call, content) => ({ role: 'tool', tool_call_id: call.id, content }),
    async step(input, instructions, tools) {
      let text = ''
      let finish = ''
      const calls = new Map<number, ToolCall>()
      const response = await modelRequest(options, 'chat/completions', {
        model: options.connection.model,
        messages: [{ role: 'system', content: instructions }, ...input],
        tools: tools.map(tool => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        })),
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: options.connection.maxOutputTokens ?? 4096,
        ...(options.connection.effort ? { reasoning_effort: options.connection.effort } : {})
      })
      await readModelEvents(response, event => {
        if (event.error) {
          if (['server_error', 'internal_error', 'timeout'].includes(event.error.code)) {
            throw new ModelConnectionError('The model server temporarily failed. Completed actions are kept.')
          }
          throw new HarnessError('The model server reported an error.')
        }

        if (event.type === 'done') {
          if (!finish) {
            throw new HarnessError('The model ended without a completion status.')
          }

          return true
        }

        const usage = parseContextUsage(event.usage)
        if (usage) options.onUsage?.(usage)

        const choice = event.choices?.[0]
        const delta = choice?.delta
        if (delta?.content !== undefined && delta.content !== null && typeof delta.content !== 'string' ||
            delta?.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) {
          throw new HarnessError('The model returned invalid reply data. No proposed actions ran.')
        }

        if (typeof delta?.content === 'string') {
          if (delta.content) options.onResponseData?.()
          text += delta.content
          options.onText(delta.content)
        }

        const reasoning = delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking

        if (typeof reasoning === 'string') {
          if (reasoning) options.onResponseData?.()
          options.onReasoning(reasoning.length)
        }

        for (const item of delta?.tool_calls ?? []) {
          options.onResponseData?.()
          if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index >= 40) {
            throw new HarnessError('The model returned too many tool calls.')
          }
          if (item.id !== undefined && typeof item.id !== 'string' ||
              item.function?.name !== undefined && typeof item.function.name !== 'string' ||
              item.function?.arguments !== undefined && typeof item.function.arguments !== 'string') {
            throw new HarnessError('The model returned invalid tool-call data. No proposed actions ran.')
          }

          const call = calls.get(item.index) ?? { id: '', name: '', arguments: '' }
          call.id += item.id ?? ''
          call.name += item.function?.name ?? ''
          call.arguments += item.function?.arguments ?? ''
          calls.set(item.index, call)
        }

        if (choice?.finish_reason) {
          finish = choice.finish_reason

          if (finish === 'length') {
            throw new HarnessError('The model reached its output limit. Try a smaller request.')
          }

          if (!['stop', 'tool_calls'].includes(finish)) {
            throw new HarnessError('The model stopped before completing the reply.')
          }

          // Usage is sent in a separate chunk after finish_reason.
          return false
        }

        return false
      }, () => Boolean(finish))
      const list = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
      if (finish === 'tool_calls' && !list.length || finish === 'stop' && list.length) {
        throw new HarnessError('The model returned inconsistent tool-call completion data. No proposed actions ran.')
      }
      const assistant: NativeItem = { role: 'assistant', content: text || null }

      if (list.length) {
        assistant.tool_calls = list.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments }
        }))
      }

      return { output: [assistant], calls: list, text }
    }
  }
}
