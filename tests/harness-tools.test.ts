import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { terminalTool } from '../src/backend/harness/tools/terminal.ts'
import { createToolRegistry } from '../src/backend/harness/tools/registry.ts'
import { defaultHarnessSettings } from '../src/shared/harness.ts'
import { createServer } from 'node:http'

test(
  'MCP subprocess discovery and invocation require separate Granite approvals; denial prevents execution',
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'granite-mcp-'))
    const runtime = await AgentRuntime.open(directory)
    const log = join(directory, 'calls.jsonl')

    try {
      const agent = await runtime.createAgent('MCP test')
      const workspace = await runtime.registry.workspace(agent.id)
      const settings = {
        ...defaultHarnessSettings,
        mcpServers: [
          {
            id: 'echo',
            name: 'Test server',
            transport: 'stdio' as const,
            command: 'node',
            args: [resolve('tests/fixtures/mcp-server.mjs'), log],
            url: '',
            enabled: true
          }
        ]
      }
      let approvals: string[] = [],
        allowCalls = false
      const registry = await createToolRegistry({
        workspace,
        settings,
        signal: new AbortController().signal,
        onTool: () => {},
        approve: async (kind, title) => {
          approvals.push(title)

          return title.startsWith('Connect') || allowCalls
        }
      })

      try {
        const tool = registry.definitions.find(tool => tool.name.startsWith('mcp_'))!
        assert.ok(tool)
        assert.equal(approvals.length, 1, 'connection approved before discovery')
        const denied = await registry.execute({
          id: 'denied',
          name: tool.name,
          arguments: '{"message":"hello"}'
        })
        assert.match(denied.output, /Permission denied/)
        await assert.rejects(readFile(log), { code: 'ENOENT' })
        allowCalls = true
        const output = await registry.execute({
          id: 'allowed',
          name: tool.name,
          arguments: '{"message":"hello"}'
        })
        assert.match(output.output, /MCP says: hello/)
        assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1)
        assert.equal(approvals.length, 3)
      } finally {
        await registry.close()
      }

      const deniedConnection = await createToolRegistry({
        workspace,
        settings,
        signal: new AbortController().signal,
        onTool: () => {},
        approve: async () => false
      })
      assert.ok(!deniedConnection.definitions.some(tool => tool.name.startsWith('mcp_')))
      await deniedConnection.close()
      await runtime.saveSkill(
        agent.id,
        'safe-skill',
        '# Skill\nRead the current notes before proposing changes.'
      )
      await assert.rejects(workspace.write('/skills/safe-skill/SKILL.md', 'override'))
      await assert.rejects(workspace.write('/harness.json', '{}'))
      await symlink(directory, join(workspace.root, 'skills', 'escape'))
      assert.ok(!(await runtime.skills(agent.id)).some(skill => skill.name === 'escape'))
    } finally {
      runtime.close()
      await rm(directory, { recursive: true, force: true })
    }
  }
)

test(
  'terminal executes in a real workspace sandbox, denies protected/outside files and networking, and stops process groups',
  { timeout: 15_000, skip: process.platform !== 'darwin' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'granite-terminal-'))
    const runtime = await AgentRuntime.open(directory)
    const server = createServer((_req, res) => {
      hits++
      res.end('secret')
    })
    let hits = 0
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

    try {
      const agent = await runtime.createAgent('Terminal test')
      const workspace = await runtime.registry.workspace(agent.id)
      await runtime.saveIdentity(agent.id, 'Protected identity', '')
      const outside = join(directory, 'outside.txt')
      await writeFile(outside, 'private outside content')
      const tool = terminalTool(workspace, new AbortController().signal)
      const result = (await tool.run({
        command: "printf 'terminal works' > notes/test.txt; cat notes/test.txt"
      })) as any
      assert.equal(result.exitCode, 0, JSON.stringify(result))
      assert.equal(await runtime.read(agent.id, '/notes/test.txt'), 'terminal works')

      for (const command of [
        'printf hacked > identity.md',
        'mv identity.md notes/moved.md',
        'ln identity.md notes/alias.md && printf hacked > notes/alias.md',
        `cat ${JSON.stringify(outside)}`,
        `printf hacked > ${JSON.stringify(outside)}`,
        `/usr/bin/curl --max-time 2 -s http://127.0.0.1:${(server.address() as any).port}`
      ]) {
        const denied = (await tool.run({ command })) as any
        assert.notEqual(denied.exitCode, 0, command + '\n' + JSON.stringify(denied))
      }

      assert.equal(await runtime.read(agent.id, '/identity.md'), 'Protected identity')
      assert.equal(await readFile(outside, 'utf8'), 'private outside content')
      assert.equal(hits, 0)
      const controller = new AbortController()
      const pending = terminalTool(workspace, controller.signal).run({ command: 'sleep 20 & wait' })
      setTimeout(() => controller.abort(), 100)
      await assert.rejects(pending)
    } finally {
      runtime.close()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }
)
