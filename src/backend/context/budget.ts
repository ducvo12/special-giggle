import { Tiktoken } from 'js-tiktoken/lite'
import ranks from 'js-tiktoken/ranks/o200k_base'
import type { Connection } from '../../shared/chat.ts'
import type { HarnessSettings } from '../../shared/harness.ts'
import type { NativeItem, ToolDefinition } from '../harness/types.ts'
let encoder: Tiktoken | undefined

export function contextBudget(connection: Connection, settings: HarnessSettings, input: NativeItem[], instructions: string, tools: ToolDefinition[]) {
  const window = settings.contextWindow ?? connection.contextWindow ?? 32768
  const output = Math.min(settings.maxOutputTokens ?? connection.maxOutputTokens ?? 4096, Math.floor(window / 4))
  const inputBudget = window - Math.max(Math.ceil(window * .25), output)
  const text = JSON.stringify({ instructions, input, tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) })
  const compatible = /^(gpt-4o|gpt-4\.1|gpt-5|o[134])/.test(connection.model)
  const inputTokens = compatible ? (encoder ??= new Tiktoken(ranks)).encode(text, [], []).length + 256 : Math.ceil(Buffer.byteLength(text) / 3) + 256
  return { window, output, inputTokens, inputBudget, counting: `${compatible ? 'o200k tokenizer + protocol allowance' : 'conservative UTF-8 estimate'}; ${settings.contextWindow ? 'configured window' : connection.contextWindow ? 'provider window' : '32,768 fallback window'}`, compactions: 0 }
}

// A cut can never split a native tool-call batch from any of its results.
export function compactionCut(input: NativeItem[], keep = 8) {
  let outstanding = new Set<string>(), cut = 0
  for (let index = 0; index < input.length - keep; index++) {
    const item = input[index]
    if (item.type === 'function_call') outstanding.add(item.call_id)
    for (const call of item.tool_calls ?? []) outstanding.add(call.id)
    if (item.type === 'function_call_output') outstanding.delete(item.call_id)
    if (item.role === 'tool') outstanding.delete(item.tool_call_id)
    if (!outstanding.size && item.type !== 'reasoning') cut = index + 1
  }
  return cut
}

// Prefer recent pairs that fit a 60% target, allowing room for the new summary.
// If required schemas dominate that target, retain the smallest valid suffix.
export function budgetedCut(connection: Connection, settings: HarnessSettings, input: NativeItem[], instructions: string, tools: ToolDefinition[], pinned: NativeItem[]) {
  const budget = contextBudget(connection, settings, input, instructions, tools)
  let fallback = 0
  for (const keep of [8, 6, 4, 2, 0]) {
    const cut = compactionCut(input, keep)
    if (!cut) continue
    fallback = cut
    const retained = contextBudget(connection, settings, [...pinned, ...input.slice(cut)], instructions, tools)
    if (retained.inputTokens + Math.min(2048, budget.output) <= budget.inputBudget * .6) return cut
  }
  return fallback
}
