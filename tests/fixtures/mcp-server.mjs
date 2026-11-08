import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { appendFile } from 'node:fs/promises'

const server = new Server(
  { name: 'granite-test-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

const mode = process.argv[3]
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  ...(mode === 'pagination' ? { nextCursor: 'repeat' } : {}),
  tools: Array.from({ length: mode === 'too-many' ? 81 : 1 }, () => (
    {
      name: 'echo',
      description: 'Return the supplied message.',
      inputSchema: {
        type: 'object',
        properties: { message: { type: mode === 'invalid-schema' ? 'unsupported' : 'string', ...(mode === 'defaults' ? { default: 'Fallback' } : {}) } },
        required: mode === 'defaults' ? [] : ['message'],
        additionalProperties: false
      }
    }
  ))
}))

server.setRequestHandler(CallToolRequestSchema, async request => {
  await appendFile(process.argv[2], JSON.stringify(request.params) + '\n')

  return { content: [{ type: 'text', text: 'MCP says: ' + request.params.arguments.message }] }
})

await server.connect(new StdioServerTransport())
