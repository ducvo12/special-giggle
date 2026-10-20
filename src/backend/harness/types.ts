import type { Connection } from '../../shared/chat.ts'

export type NativeItem = Record<string, any>

export interface ToolCall {
  id: string
  name: string
  arguments: string
  namespace?: string
}

export interface ToolDefinition {
  name: string
  label?: string
  description: string
  parameters: Record<string, unknown>
  permission: 'read' | 'write' | 'terminal' | 'mcp'
  run: (args: any) => Promise<unknown>
}

export interface ModelStep {
  output: NativeItem[]
  calls: ToolCall[]
  text: string
}

export interface ModelAdapter {
  user: (text: string) => NativeItem
  assistant: (text: string) => NativeItem
  toolResult: (call: ToolCall, output: string) => NativeItem
  step: (input: NativeItem[], instructions: string, tools: ToolDefinition[]) => Promise<ModelStep>
}

export interface ModelOptions {
  connection: Connection
  signal: AbortSignal
  onText: (text: string) => void
  onReasoning: (characters: number) => void
}

export class HarnessError extends Error {}
