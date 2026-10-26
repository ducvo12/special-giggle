import type { Connection, ContextUsage } from '../../shared/chat.ts'

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
  permission: 'read' | 'write' | 'terminal' | 'mcp' | 'repository'
  approval?: (args: any) => Promise<{ kind: import('../../shared/harness.ts').ApprovalRequest['kind']; title: string; detail: string } | null>
  serverId?: string
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
  onUsage?: (usage: ContextUsage) => void
  onReasoning: (characters: number) => void
  onResponseData?: () => void
}

export class HarnessError extends Error {}
export class ModelConnectionError extends HarnessError {}
export class HostCapacityError extends HarnessError {
  delayMs: number
  constructor(delayMs: number) {
    super('Waiting for host capacity — position unavailable')
    this.delayMs = delayMs
  }
}
export class SteeringInterrupt extends Error {}
