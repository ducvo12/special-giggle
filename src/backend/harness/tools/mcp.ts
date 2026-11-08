import { createHash } from 'node:crypto'
import Ajv from 'ajv'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServerConfig } from '../../../shared/harness.ts'
import type { ToolDefinition } from '../types.ts'

export async function connectMcp(
  servers: McpServerConfig[],
  root: string,
  signal: AbortSignal,
  approve: (title: string, detail: string) => Promise<boolean>
) {
  const clients: Client[] = []
  const tools: ToolDefinition[] = []
  const validator = new Ajv({ strict: false, validateFormats: false, addUsedSchema: false, useDefaults: true })
  const close = async () => {
    await Promise.allSettled(clients.map(client => client.close()))
  }
  const abort = () => {
    void close()
  }
  signal.addEventListener('abort', abort, { once: true })

  try {
    for (const server of servers.filter(item => item.enabled)) {
      signal.throwIfAborted()
      const detail =
        server.transport === 'stdio'
          ? `${server.command}\nArguments: ${JSON.stringify(server.args)}\n\nThis starts a user-configured program with your computer’s permissions. It is not restricted by the terminal sandbox.`
          : server.url

      if (!(await approve(`Connect to ${server.name}?`, detail))) {
        continue
      }

      signal.throwIfAborted()
      const client = new Client({ name: 'granite', version: '0.1.0' }, { capabilities: {} })
      clients.push(client)
      const transport =
        server.transport === 'stdio'
          ? new StdioClientTransport({
              command: server.command,
              args: server.args,
              cwd: root,
              stderr: 'ignore',
              env: {
                PATH: process.env.PATH ?? '/usr/bin:/bin',
                ...(process.platform === 'win32' && process.env.SystemRoot
                  ? { SystemRoot: process.env.SystemRoot }
                  : {})
              },
              maxBufferSize: 1_000_000
            })
          : new StreamableHTTPClientTransport(new URL(server.url), {
              requestInit: { redirect: 'error' }
            })

      try {
        await client.connect(transport, { signal, timeout: 30_000 })
      } catch {
        signal.throwIfAborted()
        throw new Error(`Could not connect to MCP server ${server.name}. Check its command, address or authentication.`)
      }
      let cursor: string | undefined
      const cursors = new Set<string>()
      do {
        let page
        try {
          page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 30_000 })
        } catch {
          signal.throwIfAborted()
          throw new Error(`Could not discover tools on MCP server ${server.name}.`)
        }

        for (const tool of page.tools) {
          if (tools.length >= 80) throw new Error('Too many MCP tools. Enable fewer servers.')

          const hash = createHash('sha256').update(`${server.id}:${tool.name}`).digest('hex').slice(0, 20)
          let validate
          try {
            validate = validator.compile<Record<string, unknown>>(tool.inputSchema)
          } catch {
            throw new Error(`Invalid tool schema on MCP server ${server.name}.`)
          }
          const parse = (args: unknown) => {
            if (!validate(args)) throw new Error('Invalid arguments for this MCP tool.')
            return args
          }
          tools.push({
            name: `mcp_${hash}`,
            label: `${server.name} · ${tool.name}`,
            description: `${server.name}: ${tool.name}. ${(tool.description ?? '').slice(0, 2000)}`,
            parameters: tool.inputSchema,
            parse,
            permission: 'mcp',
            serverId: server.id,
            run: async raw => {
              const args = parse(raw)
              try {
                return await client.callTool({ name: tool.name, arguments: args }, undefined, { signal, timeout: 30_000 })
              } catch {
                signal.throwIfAborted()
                throw new Error(`The MCP tool on ${server.name} failed. Check the server and its authentication.`)
              }
            }
          })
        }

        cursor = page.nextCursor
        if (cursor && cursors.has(cursor)) throw new Error('Invalid MCP tool pagination.')
        if (cursor) cursors.add(cursor)
      } while (cursor)
    }

    return {
      tools,
      close: async () => {
        signal.removeEventListener('abort', abort)
        await close()
      }
    }
  } catch (error) {
    signal.removeEventListener('abort', abort)
    await close()
    throw error
  }
}
