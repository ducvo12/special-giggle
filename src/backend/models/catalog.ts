import type { ModelOption } from '../../shared/chat.ts'

// Preserve capabilities advertised by the provider; absent metadata stays absent.
export function reasoningMetadata(model: any): Pick<ModelOption, 'reasoningLevels' | 'defaultReasoningLevel'> {
  const metadata: Pick<ModelOption, 'reasoningLevels' | 'defaultReasoningLevel'> = {}
  if (Array.isArray(model.supported_reasoning_levels)) {
    metadata.reasoningLevels = model.supported_reasoning_levels.flatMap((level: any) => {
      const effort = typeof level === 'string' ? level : level?.effort
      if (typeof effort !== 'string' || !effort.trim()) return []
      return [{ effort, ...(typeof level?.description === 'string' ? { description: level.description } : {}) }]
    })
  }
  if (typeof model.default_reasoning_level === 'string' && model.default_reasoning_level.trim()) {
    metadata.defaultReasoningLevel = model.default_reasoning_level
  }
  return metadata
}

export function contextMetadata(model: any): Pick<ModelOption, 'contextWindow' | 'maxOutputTokens'> {
  const positive = (values: unknown[]) => values.find(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0) as number | undefined
  const contextWindow = positive([model.effective_context_window, model.context_window, model.context_length, model.max_context_length, model.top_provider?.context_length])
  const maxOutputTokens = positive([model.max_output_tokens, model.max_output_length, model.top_provider?.max_completion_tokens])
  return { ...(contextWindow ? { contextWindow } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}) }
}
