import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { z } from 'zod'
import { AgentFilesystem } from '../src/backend/workspace/filesystem.ts'
import { createToolRegistry } from '../src/backend/harness/tools/registry.ts'
import { runHarness } from '../src/backend/harness/loop.ts'
import { defaultHarnessSettings } from '../src/shared/harness.ts'

test('authoritative validation runs before approval and passes normalized defaults to approval and execution', async context => {
  const root = await mkdtemp(join(tmpdir(), 'granite-tool-parse-'))
  await mkdir(join(root, 'notes'))
  const previews: string[] = []
  const registry = await createToolRegistry({ workspace: new AgentFilesystem(root), signal: new AbortController().signal,
    settings: { ...defaultHarnessSettings, skills: false, approveWrites: true }, onTool() {},
    approve: async (_kind, _title, detail) => { previews.push(detail); return true } })
  try {
    const tool = registry.definitions.find(tool => tool.name === 'write_file')!
    const schema = z.strictObject({ file_path: z.string(), content: z.string().default('Normalized') }).refine(args => args.content !== 'Invalid')
    context.mock.method(tool, 'parse', (raw: unknown) => schema.parse(raw))
    const invalid = await registry.execute({ id: 'invalid', name: tool.name, arguments: JSON.stringify({ file_path: '/notes/a.md', content: 'Invalid' }) })
    assert.equal(invalid.validationError, true)
    assert.equal(previews.length, 0)
    const saved = await registry.execute({ id: 'valid', name: tool.name, arguments: JSON.stringify({ file_path: '/notes/a.md' }) })
    assert.equal(saved.success, true, saved.output)
    assert.match(previews[0], /Normalized/)
    assert.equal(await readFile(join(root, 'notes/a.md'), 'utf8'), 'Normalized')
  } finally { await registry.close(); await rm(root, { recursive: true, force: true }) }
})

for (const protocol of ['responses', 'chat-completions'] as const) {
  test(`${protocol} preserves completed actions, holds later proposals and rejects a second invalid correction`, async context => {
    const root = await mkdtemp(join(tmpdir(), 'granite-tool-batch-'))
    await mkdir(join(root, 'notes'))
    let requests = 0
    context.mock.method(globalThis, 'fetch', async () => {
      const sequence = ++requests
      const proposals = sequence === 1
        ? [{ name: 'write_file', args: { file_path: '/notes/kept.md', content: 'Kept' } }, { name: 'write_file', args: { file_path: '/notes/invalid.md' } }, { name: 'write_file', args: { file_path: '/notes/held.md', content: 'Must not run' } }]
        : [{ name: 'write_file', args: { file_path: '/notes/invalid-again.md' } }]
      const calls = proposals.map((tool, index) => ({ id: `${sequence}-${index}`, name: tool.name, arguments: JSON.stringify(tool.args) }))
      const event = protocol === 'responses'
        ? { type: 'response.completed', response: { status: 'completed', output: calls.map(call => ({ type: 'function_call', id: call.id, call_id: call.id, namespace: 'granite', name: call.name, arguments: call.arguments })) } }
        : { choices: [{ delta: { tool_calls: calls.map((call, index) => ({ index, id: call.id, function: { name: call.name, arguments: call.arguments } })) }, finish_reason: 'tool_calls' }] }
      return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    try {
      await assert.rejects(runHarness({ connection: { protocol, baseUrl: 'http://localhost/v1', model: 'test', apiKey: '' },
        workspace: new AgentFilesystem(root), settings: { ...defaultHarnessSettings, skills: false }, instructions: '', history: [], text: 'Work',
        signal: new AbortController().signal, onText() {}, onReasoning() {}, onTool() {}, approve: async () => true }), /another invalid tool proposal/)
      assert.equal(requests, 2)
      assert.equal(await readFile(join(root, 'notes/kept.md'), 'utf8'), 'Kept')
      await assert.rejects(readFile(join(root, 'notes/held.md')), { code: 'ENOENT' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}
