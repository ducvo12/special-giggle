import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import type { StreamDelta } from '../src/shared/chat.ts'

const tick = () => new Promise(resolve => setTimeout(resolve, 10))
async function until(predicate: () => boolean, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await tick()
  }
  throw new Error('Timed out waiting for condition')
}

function chunk(res: ServerResponse, delta: unknown, finish_reason: string | null = null) {
  res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`)
}

function answer(res: ServerResponse, content = 'Done') {
  chunk(res, { content })
  chunk(res, {}, 'stop')
  res.end('data: [DONE]\n\n')
}

function call(res: ServerResponse, id: string, name: string, args: unknown) {
  chunk(res, { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] })
  chunk(res, {}, 'tool_calls')
  res.end('data: [DONE]\n\n')
}

async function createTestFixture(handler: (body: any, res: ServerResponse) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'granite-pass6-fixture-'))
  let runtime = await AgentRuntime.open(directory)
  const agent = await runtime.createAgent('Pass6 Agent')
  const requests: any[] = []

  const server = createServer(async (req, res) => {
    try {
      let text = ''
      for await (const data of req) text += data
      const body = JSON.parse(text)
      requests.push(body)
      res.setHeader('Content-Type', 'text/event-stream')
      handler(body, res)
    } catch (err) {
      console.error('SERVER HANDLER ERROR:', err)
      res.statusCode = 500
      res.end()
    }
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  const connection = {
    connectionId: 'fixture',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'mock-model',
    apiKey: '',
    maxConcurrentRequests: 4
  }

  const fixture = {
    get runtime() { return runtime },
    set runtime(r: AgentRuntime) { runtime = r },
    agent,
    requests,
    directory,
    connection,
    server,
    async close() {
      await runtime.stopAll().catch(() => {})
      runtime.close()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }

  return fixture
}

test('Pass 6: End-to-end full user journey integration', { timeout: 25000 }, async () => {
  const externalRepoDir = await mkdtemp(join(tmpdir(), 'granite-ext-repo-'))
  const canonicalRepo = await realpath(externalRepoDir)
  await writeFile(join(canonicalRepo, 'app.ts'), 'export const name = "GraniteApp";\n')

  const f = await createTestFixture((body, res) => {
    const lastMsg = body.messages.at(-1)
    if (lastMsg?.role === 'tool') {
      answer(res, 'File was created successfully.')
    } else if (lastMsg?.content === 'Hello') {
      answer(res, 'Hello! I am ready to help.')
    } else if (lastMsg?.content === 'Create new file') {
      call(res, 'call-create-1', 'repo_write', { path: 'created.ts', content: 'export const created = true;\n', revision: null })
    } else {
      answer(res, 'Generic reply')
    }
  })

  try {
    // 1. Create structure: Section -> Project -> Attach External Repository
    const section = await f.runtime.createSection(f.agent.id, 'Engineering', 'shared')
    const project = await f.runtime.createProject(f.agent.id, section.id, 'CoreApp', canonicalRepo)
    assert.equal(project.repositoryPath, canonicalRepo)

    // 2. Chat creation & streaming text run
    const chat = await f.runtime.createConversation(f.agent.id, { sectionId: section.id, projectId: project.id })
    const deltas: StreamDelta[] = []
    const firstResult = await f.runtime.run('run-1', f.agent.id, chat.id, f.connection, 'Hello', delta => deltas.push(delta))
    assert.equal(firstResult.stopped, false)
    const messages = f.runtime.store.get(f.agent.id, chat.id).messages
    assert.equal(messages.at(-1)?.content, 'Hello! I am ready to help.')

    // 3. Repository tool execution: write file and verify real disk content
    const editResult = await f.runtime.run('run-2', f.agent.id, chat.id, f.connection, 'Create new file', () => {})
    assert.equal(editResult.stopped, false)
    const createdContent = await readFile(join(canonicalRepo, 'created.ts'), 'utf8')
    assert.equal(createdContent, 'export const created = true;\n')

    // 4. Temporary chat lifecycle: creation, touch, and explicit Keep
    const tempChat = await f.runtime.createConversation(f.agent.id, { sectionId: section.id }, 'temporary')
    assert.equal(tempChat.retention, 'temporary')
    assert.ok(tempChat.expiresAt !== null)
    // Attempting to move a temporary chat directly into a project without Keep is rejected
    await assert.rejects(
      f.runtime.moveConversation(f.agent.id, tempChat.id, { sectionId: section.id, projectId: project.id }),
      /Keep .*temporary chat/
    )
    // Keep conversation converts to permanent
    await f.runtime.keepConversation(f.agent.id, tempChat.id)
    const kept = f.runtime.store.get(f.agent.id, tempChat.id)
    assert.equal(kept.retention, 'permanent')
    assert.equal(kept.expiresAt, null)
    // Now move into repository project is permitted
    await f.runtime.moveConversation(f.agent.id, tempChat.id, { sectionId: section.id, projectId: project.id })
    assert.equal(f.runtime.store.get(f.agent.id, tempChat.id).projectId, project.id)

    // 5. Skill package import
    const tempDir = await mkdtemp(join(tmpdir(), 'granite-skill-pkg-'))
    const skillSource = join(tempDir, 'pass6-skill')
    await mkdir(skillSource, { recursive: true })
    await writeFile(join(skillSource, 'SKILL.md'), '---\nname: pass6-skill\ndescription: Test skill\n---\n# Instructions\n')
    await mkdir(join(skillSource, 'resources'), { recursive: true })
    await writeFile(join(skillSource, 'resources/data.json'), '{"ok":true}')
    const imported = await f.runtime.importSkill(f.agent.id, skillSource)
    assert.equal(imported.name, 'pass6-skill')
    const workspace = await f.runtime.registry.workspace(f.agent.id)
    const skillJson = await readFile(join(workspace.root, 'tools/skills', imported.name, 'resources/data.json'), 'utf8')
    assert.equal(JSON.parse(skillJson).ok, true)
    await rm(tempDir, { recursive: true, force: true })
  } finally {
    await f.close()
    await rm(externalRepoDir, { recursive: true, force: true })
  }
})

test('Pass 6: Concurrency & repository serialization', { timeout: 25000 }, async () => {
  const repoDirA = await mkdtemp(join(tmpdir(), 'granite-repo-a-'))
  const repoDirB = await mkdtemp(join(tmpdir(), 'granite-repo-b-'))
  const held: ServerResponse[] = []

  const f = await createTestFixture((body, res) => {
    const text = body.messages.filter((m: any) => m.role === 'user').at(-1)?.content
    if (text?.startsWith('hold')) {
      chunk(res, { content: 'Holding' })
      held.push(res)
    } else {
      answer(res, `Processed: ${text}`)
    }
  })

  try {
    const section = await f.runtime.createSection(f.agent.id, 'Projects', 'shared')
    const projA = await f.runtime.createProject(f.agent.id, section.id, 'ProjA', await realpath(repoDirA))
    const projB = await f.runtime.createProject(f.agent.id, section.id, 'ProjB', await realpath(repoDirB))

    const chatA1 = await f.runtime.createConversation(f.agent.id, { sectionId: section.id, projectId: projA.id })
    const chatA2 = await f.runtime.createConversation(f.agent.id, { sectionId: section.id, projectId: projA.id })
    const chatB = await f.runtime.createConversation(f.agent.id, { sectionId: section.id, projectId: projB.id })

    // 1. Two chats in the SAME project: chatA1 holds the repository lock, chatA2 must queue
    const runA1 = f.runtime.run('run-a1', f.agent.id, chatA1.id, f.connection, 'hold A1', () => {})
    await until(() => held.length === 1)

    const runA2 = f.runtime.run('run-a2', f.agent.id, chatA2.id, f.connection, 'next A2', () => {})
    await until(() => f.runtime.listRuns().some(run => run.id === 'run-a2' && run.phase === 'queued'))

    const queuedRun = f.runtime.listRuns().find(run => run.id === 'run-a2')
    assert.equal(queuedRun?.phase, 'queued')
    assert.match(queuedRun?.queue?.reason ?? '', /repository project/)

    // 2. Chat in DIFFERENT project runs concurrently without being blocked by projA
    const runB = f.runtime.run('run-b', f.agent.id, chatB.id, f.connection, 'chat B run', () => {})
    await runB
    const chatBMsgs = f.runtime.store.get(f.agent.id, chatB.id).messages
    assert.equal(chatBMsgs.at(-1)?.content, 'Processed: chat B run')

    // Release held run A1 -> run A2 should automatically unqueue and finish
    answer(held[0])
    await runA1
    await runA2

    const chatA2Msgs = f.runtime.store.get(f.agent.id, chatA2.id).messages
    assert.equal(chatA2Msgs.at(-1)?.content, 'Processed: next A2')
  } finally {
    await f.close()
    await rm(repoDirA, { recursive: true, force: true })
    await rm(repoDirB, { recursive: true, force: true })
  }
})

test('Pass 6: Interruption, Stop, and restart recovery', { timeout: 25000 }, async () => {
  let heldStream: ServerResponse | null = null
  let streamed = false
  const f = await createTestFixture((body, res) => {
    chunk(res, { content: 'Partial streaming output...' })
    heldStream = res
  })

  try {
    const chat = await f.runtime.createConversation(f.agent.id)

    // 1. Mid-stream Stop
    const runPromise = f.runtime.run('run-stop', f.agent.id, chat.id, f.connection, 'Stream something', delta => {
      if (delta.text) streamed = true
    })
    await until(() => streamed && heldStream !== null)

    f.runtime.stop('run-stop')
    const result = await runPromise
    assert.equal(result.stopped, true)

    const messages = f.runtime.store.get(f.agent.id, chat.id).messages
    const lastMsg = messages.at(-1)
    assert.equal(lastMsg?.role, 'assistant')
    assert.equal(lastMsg?.status, 'stopped')
    assert.match(lastMsg?.content ?? '', /Partial streaming output/)

    // 2. Simulate crash / abrupt process shutdown with active work and pending prompts
    const pendingChat = await f.runtime.createConversation(f.agent.id)
    const pendingRun = {
      id: 'crash-run',
      agentId: f.agent.id,
      conversationId: pendingChat.id,
      phase: 'queued' as const,
      model: f.connection.model,
      connectionId: f.connection.connectionId,
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      messageIds: []
    }
    f.runtime.store.runs.accept(pendingRun, 'Unexecuted prompt on crash')

    // Close runtime without clean stop (simulating sudden quit)
    f.runtime.close()

    // Reopen runtime: verify recovery logic
    f.runtime = await AgentRuntime.open(f.directory)
    const recoveredRuns = f.runtime.listRuns()
    const recoveredJob = recoveredRuns.find(r => r.id === 'crash-run')
    assert.equal(recoveredJob?.phase, 'not_started')

    const pendingMessages = f.runtime.store.get(f.agent.id, pendingChat.id).messages
    assert.equal(pendingMessages[0].delivery, 'pending')
    assert.equal(pendingMessages[0].content, 'Unexecuted prompt on crash')

    const recoveryNotice = f.runtime.store.runs.recovery()
    assert.deepEqual(recoveryNotice, { active: 0, pending: 1 })
    f.runtime.store.runs.dismissRecovery()
  } finally {
    if (heldStream && !(heldStream as ServerResponse).writableEnded) {
      ;(heldStream as ServerResponse).end()
    }
    await f.close()
  }
})

test('Pass 6: Provider error resilience matrix (E1-E5)', { timeout: 25000 }, async () => {
  let mode: 'e1-empty' | 'e2-truncated' | 'e3-invalid-json' | 'e4-duplicate-id' | 'e5-length' = 'e1-empty'
  let e3Step = 0

  const f = await createTestFixture((body, res) => {
    if (mode === 'e1-empty') {
      // E1: Empty text with stop
      answer(res, '')
    } else if (mode === 'e2-truncated') {
      // E2: Truncated stream: partial text, then broken connection without finish_reason
      chunk(res, { content: 'Partial text before socket drop' })
      res.destroy()
    } else if (mode === 'e3-invalid-json') {
      // E3: Repeated invalid JSON in tool arguments
      e3Step++
      chunk(res, {
        tool_calls: [{
          index: 0,
          id: `call-malformed-${e3Step}`,
          function: { name: 'repo_read', arguments: '{ broken_json: ' }
        }]
      })
      chunk(res, {}, 'tool_calls')
      res.end('data: [DONE]\n\n')
    } else if (mode === 'e4-duplicate-id') {
      // E4: Duplicate tool call IDs in the same batch
      chunk(res, {
        tool_calls: [
          { index: 0, id: 'dup-id', function: { name: 'repo_read', arguments: '{}' } },
          { index: 1, id: 'dup-id', function: { name: 'repo_read', arguments: '{}' } }
        ]
      })
      chunk(res, {}, 'tool_calls')
      res.end('data: [DONE]\n\n')
    } else if (mode === 'e5-length') {
      // E5: Finish reason length
      chunk(res, { content: 'Reaching limit' })
      chunk(res, {}, 'length')
      res.end('data: [DONE]\n\n')
    }
  })

  try {
    const chat = await f.runtime.createConversation(f.agent.id)

    // E1: Empty response fails cleanly with clear message, allowing Continue
    mode = 'e1-empty'
    await assert.rejects(
      f.runtime.run('run-e1', f.agent.id, chat.id, f.connection, 'E1 request', () => {}),
      /no answer/
    )

    // E2: Truncated stream
    mode = 'e2-truncated'
    await assert.rejects(
      f.runtime.run('run-e2', f.agent.id, chat.id, f.connection, 'E2 request', () => {}),
      /stopped before completing|network|aborted|fetch failed|could not reach the model/i
    )

    // E3: Malformed tool JSON returns validation error to model or fails batch
    mode = 'e3-invalid-json'
    e3Step = 0
    await assert.rejects(
      f.runtime.run('run-e3', f.agent.id, chat.id, f.connection, 'E3 request', () => {}),
      /invalid tool|could not finish/i
    )

    // E4: Duplicate tool call ID
    mode = 'e4-duplicate-id'
    await assert.rejects(
      f.runtime.run('run-e4', f.agent.id, chat.id, f.connection, 'E4 request', () => {}),
      /invalid or repeated tool-call identifiers/i
    )

    // E5: Output length exhaustion
    mode = 'e5-length'
    await assert.rejects(
      f.runtime.run('run-e5', f.agent.id, chat.id, f.connection, 'E5 request', () => {}),
      /output limit/i
    )
  } finally {
    await f.close()
  }
})

test('Pass 6: Database migration idempotency & upgrade persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-migration-check-'))

  // Open database, create full hierarchy with agent, section, project, repository, and chat
  let runtime = await AgentRuntime.open(directory)
  const agent = await runtime.createAgent('Migrated Agent')
  const section = await runtime.createSection(agent.id, 'Work', 'shared')
  const project = await runtime.createProject(agent.id, section.id, 'ProjectOne', null)
  const chat = await runtime.createConversation(agent.id, { sectionId: section.id, projectId: project.id })
  runtime.store.saveMessage(chat.id, {
    id: 'm1',
    role: 'user',
    content: 'Persisted message across migrations',
    delivery: 'processed'
  })
  runtime.close()

  // Reopen 1st time
  runtime = await AgentRuntime.open(directory)
  const agent1 = await runtime.registry.get(agent.id)
  assert.equal(agent1.name, 'Migrated Agent')
  const sections1 = runtime.store.organization.snapshot(agent.id).sections
  assert.ok(sections1.some(s => s.name === 'Work'))
  const chat1 = runtime.store.get(agent.id, chat.id)
  assert.equal(chat1.messages[0].content, 'Persisted message across migrations')
  runtime.close()

  // Reopen 2nd time to verify migration idempotency (no duplicate General sections or constraints)
  runtime = await AgentRuntime.open(directory)
  const generalSections = runtime.store.organization.snapshot(agent.id).sections.filter(s => s.name === 'General')
  assert.equal(generalSections.length, 1, 'Only one General section exists')
  runtime.close()

  await rm(directory, { recursive: true, force: true })
})
