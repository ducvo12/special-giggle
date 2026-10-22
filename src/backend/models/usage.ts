import type { ContextUsage } from '../../shared/chat.ts'

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function parseContextUsage(usage: any): ContextUsage | undefined {
  if (!usage || typeof usage !== 'object') return
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens
  const outputTokens = usage.output_tokens ?? usage.completion_tokens
  if (!count(inputTokens) || !count(outputTokens) || !Number.isSafeInteger(inputTokens + outputTokens)) return
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
    ...(count(cachedTokens) && cachedTokens <= inputTokens ? { cachedTokens } : {}),
    ...(count(reasoningTokens) && reasoningTokens <= outputTokens ? { reasoningTokens } : {})
  }
}
