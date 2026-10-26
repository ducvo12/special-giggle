import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import type { StreamDelta } from '../src/shared/chat.ts'
import { defaultHarnessSettings, type ApprovalRequest } from '../src/shared/harness.ts'
import { responsesAdapter } from '../src/backend/harness/providers/responses.ts'

function streamedEvents(events: unknown[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

test('empty completion envelopes retain completed streamed repository calls and final messages', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-streamed-repository-'))
  const runtime = await AgentRuntime.open(directory)
  let requests = 0
  try {
    const agent = await runtime.createAgent('Stream check')
    const section = await runtime.createSection(agent.id, 'Code', 'shared')
    const project = await runtime.createProject(agent.id, section.id, 'Website')
    const repository = await runtime.createRepository(agent.id, project.id)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(repository.repositoryPath!, 'README.md'), '# Test repository\n')
    const chat = await runtime.createConversation(agent.id, { sectionId: section.id, projectId: project.id })
    const call = { type: 'function_call', id: 'item-call', call_id: 'stream-call', name: 'repo_list', namespace: 'granite',
      status: 'completed', arguments: JSON.stringify({ project_id: project.id, path: '' }) }
    const reasoning = { type: 'reasoning', id: 'reasoning', summary: [], encrypted_content: 'opaque-test-state' }
    context.mock.method(globalThis, 'fetch', async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      requests++
      if (requests === 1) return streamedEvents([
        { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '', status: 'in_progress' } },
        { type: 'response.function_call_arguments.delta', output_index: 1, delta: call.arguments },
        { type: 'response.output_item.done', output_index: 1, item: call },
        { type: 'response.output_item.done', output_index: 0, item: reasoning },
        { type: 'response.completed', response: { status: 'completed', output: [] } }
      ])
      assert.equal(requests, 2)
      assert.deepEqual(body.input.slice(-3, -1), [reasoning, call])
      const output = body.input.at(-1)
      assert.equal(output.type, 'function_call_output')
      assert.equal(output.call_id, call.call_id)
      assert.ok(JSON.parse(output.output).some((file: any) => file.name === 'README.md'))
      return streamedEvents([
        { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'answer', role: 'assistant',
          status: 'completed', content: [{ type: 'output_text', text: 'This folder contains README.md.' }] } },
        { type: 'response.completed', response: { status: 'completed', output: [] } }
      ])
    })
    const text: string[] = []
    await runtime.run('streamed-list', agent.id, chat.id, { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'fixture', protocol: 'responses' },
      'What is in this folder?', delta => { if (delta.text) text.push(delta.text) })
    assert.equal(requests, 2)
    const reply = runtime.store.get(agent.id, chat.id).messages.at(-1)!
    assert.equal(reply.status, 'complete')
    assert.equal(reply.content, 'This folder contains README.md.')
    assert.equal(reply.tools?.[0].name, 'repo_list')
    assert.equal(reply.tools?.[0].status, 'complete')
    assert.equal(text.join(''), reply.content)
  } finally { await runtime.stopAll(); runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('stream fallback does not promote unfinished calls or bypass response validation', async context => {
  const call = { type: 'function_call', call_id: 'fragment', name: 'repo_write', arguments: '{', status: 'in_progress' }
  let events: unknown[] = []
  context.mock.method(globalThis, 'fetch', async () => streamedEvents(events))
  const adapter = responsesAdapter({ connection: { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'fixture' },
    signal: new AbortController().signal, onText() {}, onReasoning() {} })
  events = [
    { type: 'response.output_item.added', output_index: 0, item: call },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{' },
    { type: 'response.completed', response: { status: 'completed', output: [] } }
  ]
  assert.deepEqual((await adapter.step([], '', [])).calls, [])
  events = [
    { type: 'response.output_item.done', output_index: 0, item: call },
    { type: 'response.completed', response: { status: 'completed', output: [] } }
  ]
  await assert.rejects(adapter.step([], '', []), /incomplete response item/)
  events = [{ type: 'response.output_item.done', output_index: 0, item: { ...call, status: 'completed', arguments: '{}' } }]
  await assert.rejects(adapter.step([], '', []), /connection ended/)
  events = [{ type: 'response.completed', response: { status: 'completed', output: {} } }]
  await assert.rejects(adapter.step([], '', []), /invalid response/)
})

async function fixture() {
  const requests: any[] = []
  let sequence = 0
  const server = createServer(async (req, res) => {
    let raw = ''

    for await (const chunk of req) {
      raw += chunk
    }

    const body = JSON.parse(raw)
    requests.push(body)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const event = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`)
    const user = body.input.filter((item: any) => item.role === 'user').at(-1)?.content[0].text
    const previous = body.input.at(-1)
    const done = (output: any[]) => {
      for (const [index, item] of output.entries()) {
        event({ type: 'response.output_item.done', output_index: index, item })
      }

      event({ type: 'response.completed', response: { status: 'completed', output } })
      res.end()
    }
    const answer = (text: string) => {
      event({ type: 'response.output_text.delta', delta: text.slice(0, 3) })
      event({ type: 'response.output_text.delta', delta: text.slice(3) })
      done([
        {
          type: 'message',
          id: 'message-' + ++sequence,
          role: 'assistant',
          content: [{ type: 'output_text', text }]
        }
      ])
    }
    const tool = (name: string, args: unknown) =>
      done([
        {
          type: 'reasoning',
          id: 'reason-' + ++sequence,
          summary: [],
          encrypted_content: 'opaque-reasoning-' + sequence
        },
        {
          type: 'function_call',
          id: 'item-' + sequence,
          call_id: 'call-' + sequence,
          name,
          namespace: 'granite',
          arguments: JSON.stringify(args)
        }
      ])

    if (user === 'Long task') {
      const completed = body.input.filter((item: any) => item.type === 'function_call_output').length
      if (completed < 45) {
        return tool('read_file', { file_path: '/memory.md' })
      }
      answer('Completed all 45 tool steps.')
      return
    }

    if (user === 'Fail') {
      event({ type: 'response.failed', response: { error: { message: 'secret-provider-token' } } })
      res.end()

      return
    }

    if (user === 'Disconnect') {
      event({ type: 'response.output_text.delta', delta: 'Partial disconnect' })
      res.end()

      return
    }

    if (user === 'Slow') {
      event({ type: 'response.output_text.delta', delta: 'Partial slow reply' })
      const timer = setInterval(() => res.write(': keepalive\n\n'), 50)
      res.on('close', () => clearInterval(timer))

      return
    }

    if (previous?.type === 'function_call_output') {
      assert.ok(
        body.input.some(
          (item: any) => item.type === 'reasoning' && item.encrypted_content?.startsWith('opaque-')
        )
      )
      answer(previous.output)

      return
    }

    if (['Save note', 'Denied write', 'Pending write'].includes(user)) {
      return tool('write_file', {
        file_path: `/notes/${user === 'Save note' ? 'saved' : 'denied'}.md`,
        content: 'A real note from the Granite harness.'
      })
    }

    if (user === 'Change settings') {
      return tool('write_file', { file_path: '/harness.json', content: '{}' })
    }

    if (user === 'Skill') {
      return tool('load_skill', { name: 'research' })
    }

    if (user === 'Terminal') {
      return tool('terminal', {
        command: "printf 'terminal works' > notes/terminal.txt; cat notes/terminal.txt"
      })
    }

    if (user === 'Recall') {
      assert.ok(
        body.input.some(
          (item: any) => item.type === 'function_call_output' && item.output.includes('saved.md')
        )
      )
      assert.match(body.instructions, /extra-instruction/)
    }

    answer('Direct Responses reply.')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  return {
    requests,
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
}

test(
  'Granite owns Responses tool execution, native reasoning continuity, approvals, recovery, and deletion',
  { timeout: 30_000 },
  async () => {
    const mock = await fixture()
    const directory = await mkdtemp(join(tmpdir(), 'granite-harness-'))
    let runtime = await AgentRuntime.open(directory)
    const events: StreamDelta[] = []
    let pendingApproval: ApprovalRequest | null = null
    let approvalReady: (() => void) | undefined
    const emit = (delta: StreamDelta) => {
      events.push(delta)

      if (delta.approval) {
        pendingApproval = delta.approval
        approvalReady?.()
      }
    }

    try {
      const agent = await runtime.createAgent('Nova')
      await runtime.saveIdentity(agent.id, 'Use a calm, clear style.', '')
      await runtime.saveSettings(agent.id, {
        ...defaultHarnessSettings,
        instructions: 'extra-instruction',
        approveWrites: true
      })
      await runtime.saveSkill(
        agent.id,
        'research',
        '# Research\nUse original sources and record evidence.'
      )
      const conversation = await runtime.createConversation(agent.id)
      const connection = {
        baseUrl: mock.baseUrl,
        apiKey: 'secret-provider-token',
        model: 'mock-reasoning',
        protocol: 'responses' as const,
        effort: 'high'
      }
      const run = (text: string) =>
        runtime.run(text, agent.id, conversation.id, connection, text, emit)
      const approve = async (text: string, allow: boolean) => {
        const ready = new Promise<void>(resolve => {
          approvalReady = resolve
        })
        const running = run(text)
        await ready
        const request = pendingApproval!
        runtime.approvals.answer(request.requestId, request.id, allow)
        await running
        assert.throws(
          () => runtime.approvals.answer(request.requestId, request.id, true),
          /no longer pending/
        )
      }
      await approve('Save note', true)
      assert.match(await runtime.read(agent.id, '/notes/saved.md'), /real note/)
      assert.equal(mock.requests[0].store, false)
      assert.equal(mock.requests[0].stream, true)
      assert.equal(mock.requests[0].reasoning.effort, 'high')
      assert.deepEqual(mock.requests[0].include, ['reasoning.encrypted_content'])
      assert.equal(mock.requests[0].tools[0].type, 'namespace')
      assert.ok(!('previous_response_id' in mock.requests[0]))
      assert.match(mock.requests[0].instructions, /calm, clear/)
      assert.doesNotMatch(
        JSON.stringify(runtime.store.get(agent.id, conversation.id)),
        /opaque-reasoning/
      )
      await approve('Denied write', false)
      await assert.rejects(readFile(join(directory, 'agents', agent.id, 'notes/denied.md')), {
        code: 'ENOENT'
      })
      assert.ok(
        events.some(
          event =>
            event.tool?.status === 'error' && event.tool.output?.includes('Permission denied')
        )
      )
      await approve('Change settings', true)
      assert.equal((await runtime.settings(agent.id)).instructions, 'extra-instruction')
      await run('Skill')
      assert.match(
        runtime.store.get(agent.id, conversation.id).messages.at(-1)!.content,
        /original sources/
      )
      runtime.close()
      runtime = await AgentRuntime.open(directory)
      await run('Recall')

      const switchIndex = mock.requests.length
      await assert.rejects(
        runtime.run(
          'Switch model',
          agent.id,
          conversation.id,
          { ...connection, model: 'another-account-model' },
          'Continue with another model',
          emit
        ),
        /model is fixed for this conversation/
      )
      assert.equal(mock.requests.length, switchIndex)
      await runtime.run(
        'Change reasoning',
        agent.id,
        conversation.id,
        { ...connection, effort: 'low' },
        'Continue with less reasoning',
        emit
      )
      assert.equal(mock.requests[switchIndex].reasoning.effort, 'low')
      assert.equal(runtime.store.get(agent.id, conversation.id).messages.at(-1)!.model, connection.model)

      const before = mock.requests.length
      const ready = new Promise<void>(resolve => {
        approvalReady = resolve
      })
      const stopped = run('Pending write')
      await ready
      runtime.stop('Pending write')
      assert.deepEqual(await stopped, { stopped: true })
      assert.equal(
        mock.requests.length,
        before + 1,
        'no model continuation after Stop during approval'
      )
      assert.throws(
        () => runtime.approvals.answer('Pending write', pendingApproval!.id, true),
        /no longer pending/
      )
      await assert.rejects(run('Disconnect'), /before the model finished/)
      assert.match(
        runtime.store.get(agent.id, conversation.id).messages.at(-1)!.content,
        /Partial disconnect/
      )
      await assert.rejects(run('Fail'), error => !String(error).includes('secret-provider-token'))
      const recoveryIndex = mock.requests.length
      await run('Hello')
      assert.ok(
        !mock.requests[recoveryIndex].input.some((item: any) => item.type === 'function_call'),
        'interrupted tool calls are not replayed'
      )
      assert.doesNotMatch(
        JSON.stringify(runtime.store.get(agent.id, conversation.id)),
        /secret-provider-token/
      )
      await runtime.deleteAgent(agent.id)

      for (const table of ['conversations', 'messages', 'conversation_threads', 'harness_state']) {
        assert.equal(
          (runtime.store.saver.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n,
          0
        )
      }

      await assert.rejects(readFile(join(directory, 'agents', agent.id, 'harness.json')), {
        code: 'ENOENT'
      })
    } finally {
      await runtime.stopAll()
      runtime.close()
      await mock.close()
      await rm(directory, { recursive: true, force: true })
    }
  }
)


test('long tasks complete beyond 40 model steps and tool calls', { timeout: 30_000 }, async () => {
  const mock = await fixture()
  const directory = await mkdtemp(join(tmpdir(), 'granite-long-task-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Nova')
    const conversation = await runtime.createConversation(agent.id)
    await runtime.run('long-task', agent.id, conversation.id, {
      baseUrl: mock.baseUrl,
      apiKey: 'mock',
      model: 'mock-reasoning',
      protocol: 'responses'
    }, 'Long task', () => {})
    assert.equal(mock.requests.length, 46)
    const message = runtime.store.get(agent.id, conversation.id).messages.at(-1)!
    assert.equal(message.content, 'Completed all 45 tool steps.')
    assert.equal(message.error, undefined)
  } finally {
    runtime.close()
    await mock.close()
    await rm(directory, { recursive: true, force: true })
  }
})
