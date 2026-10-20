import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { appendFile } from 'node:fs/promises'

const server = new Server(
  { name: 'granite-test-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Return the supplied message.',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async request => {
  await appendFile(process.argv[2], JSON.stringify(request.params) + '\n')

  return { content: [{ type: 'text', text: 'MCP says: ' + request.params.arguments.message }] }
})

await server.connect(new StdioServerTransport())
