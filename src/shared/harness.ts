export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command: string
  args: string[]
  url: string
  enabled: boolean
}

export interface HarnessSettings {
  contextWindow?: number
  maxOutputTokens?: number
  instructions: string
  terminal: boolean
  approveWrites: boolean
  skills: boolean
  mcpServers: McpServerConfig[]
}

export const defaultHarnessSettings: HarnessSettings = {
  instructions: '',
  terminal: false,
  approveWrites: false,
  skills: true,
  mcpServers: []
}

export interface ApprovalRequest {
  id: string
  requestId: string
  agentId: string
  kind: 'write' | 'terminal' | 'mcp'
  title: string
  detail: string
}

export interface ChatGPTAccount {
  id: string
  email: string
  planEnabled: boolean
  signedIn: boolean
}
