import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { unlinkSync } from 'node:fs'

function rowCounts(runtime: AgentRuntime) {
  const tables = runtime.store.saver.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'context_fts_%'")
    .all() as { name: string }[]

  return Object.fromEntries(
    tables.map(({ name }) => {
      const row = runtime.store.saver.db
        .prepare(`SELECT count(*) AS count FROM "${name}"`)
        .get() as { count: number }

      return [name, row.count]
    })
  )
}

async function saveCheckpoint(runtime: AgentRuntime, graphId: string, id: string) {
  const config = await runtime.store.saver.put(
    { configurable: { thread_id: graphId } },
    {
      v: 4,
      id,
      ts: new Date().toISOString(),
      channel_values: { saved: true },
      channel_versions: {},
      versions_seen: {}
    },
    { source: 'input', step: 0, parents: {} }
  )
  await runtime.store.saver.putWrites(config, [['saved', 'offline test']], 'test-task')
}

test('empty → create → delete leaves no agent files or database rows, including recovery checkpoints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-agent-deletion-'))
  let runtime = await AgentRuntime.open(directory)

  try {
    assert.deepEqual(await runtime.registry.list(), [])
    assert.ok(Object.values(rowCounts(runtime)).every(count => count === 0))

    const agent = await runtime.createAgent('Offline test')
    const section = await runtime.createSection(agent.id, 'Section to delete', 'shared')
    await runtime.createProject(agent.id, section.id, 'Project to delete')
    const root = join(directory, 'agents', agent.id)
    await access(join(root, 'identity.md'))
    await mkdir(join(root, 'projects', 'nested'), { recursive: true })
    await writeFile(join(root, 'projects', 'nested', 'note.md'), 'A local file.')

    // Seed persisted history directly. No model connection or chat is needed.
    const chat = runtime.store.create(agent.id)
    const first = runtime.store.begin(agent.id, chat.id, 'Saved input', 'offline')
    await saveCheckpoint(runtime, first.graphId, 'first-checkpoint')
    runtime.store.finish(chat.id, first.message, 'stopped')

    const recovered = runtime.store.begin(agent.id, chat.id, 'Recovered input', 'offline')
    assert.notEqual(recovered.graphId, first.graphId)
    await saveCheckpoint(runtime, recovered.graphId, 'recovered-checkpoint')
    runtime.store.finish(chat.id, recovered.message, 'complete')
    runtime.store.create(agent.id)
    runtime.store.saveModelState(runtime.store.list(agent.id)[0].id, 'test', [
      { role: 'user', content: 'retained native state' }
    ])
    const populated = rowCounts(runtime)
    for (const table of ['conversations', 'messages', 'conversation_threads', 'harness_state', 'sections', 'projects', 'checkpoints', 'writes']) assert.ok(populated[table] > 0, table)

    // Ownership of both graph histories must survive a process restart.
    runtime.close()
    runtime = await AgentRuntime.open(directory)
    await runtime.deleteAgent(agent.id)

    assert.deepEqual(await runtime.registry.list(), [])
    assert.deepEqual(await readdir(join(directory, 'agents')), [])
    await assert.rejects(access(root), { code: 'ENOENT' })
    assert.ok(
      Object.values(rowCounts(runtime)).every(count => count === 0),
      JSON.stringify(rowCounts(runtime))
    )

    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.deepEqual(await runtime.registry.list(), [])
    assert.ok(Object.values(rowCounts(runtime)).every(count => count === 0))
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('deletion preserves other agents and rejects unsafe paths, active runs, and concurrent changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-agent-isolation-'))
  const runtime = await AgentRuntime.open(directory)

  try {
    const target = await runtime.createAgent('Delete me')
    const survivor = await runtime.createAgent('Keep me')
    const chat = runtime.store.create(survivor.id)
    const turn = runtime.store.begin(survivor.id, chat.id, 'Keep this history', 'offline')
    await saveCheckpoint(runtime, turn.graphId, 'surviving-checkpoint')
    runtime.store.finish(chat.id, turn.message, 'complete')
    runtime.store.create(target.id)

    await assert.rejects(runtime.deleteAgent('../outside'), /Invalid agent/)

    const outside = join(directory, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'keep.txt'), 'Do not delete.')
    await symlink(outside, join(directory, 'agents', 'linked-agent'))
    await assert.rejects(runtime.deleteAgent('linked-agent'), /symbolic links/)
    await access(join(outside, 'keep.txt'))

    const deleting = runtime.deleteAgent(target.id)
    await assert.rejects(runtime.createAgent('Concurrent agent'), /Finish the current operation/)
    await assert.rejects(
      runtime.createConversation(target.id),
      /Finish the current operation|ENOENT/
    )
    await deleting

    await assert.rejects(runtime.createConversation(target.id))

    assert.deepEqual(await runtime.registry.list(), [survivor])
    assert.equal(runtime.store.list(survivor.id).length, 1)
    assert.equal(runtime.store.get(survivor.id, chat.id).messages.length, 2)
    assert.ok(await runtime.store.saver.getTuple({ configurable: { thread_id: turn.graphId } }))
    await access(join(directory, 'agents', survivor.id, 'identity.md'))
    assert.deepEqual(runtime.store.list(target.id), [])
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('database deletion failures roll back records and leave the agent folder intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-agent-delete-failure-'))
  const runtime = await AgentRuntime.open(directory)

  try {
    const agent = await runtime.createAgent('Keep on failure')
    runtime.store.create(agent.id)
    const before = rowCounts(runtime)
    runtime.store.saver.db.exec(`
      CREATE TEMP TRIGGER reject_deletion BEFORE DELETE ON conversations
      BEGIN SELECT RAISE(ABORT, 'Simulated database failure'); END;
    `)

    await assert.rejects(runtime.deleteAgent(agent.id), /Simulated database failure/)
    assert.deepEqual(rowCounts(runtime), before)
    await access(join(directory, 'agents', agent.id, 'identity.md'))
    assert.deepEqual(await runtime.registry.list(), [agent])

    runtime.store.saver.db.exec('DROP TRIGGER reject_deletion')
    await runtime.deleteAgent(agent.id)
    assert.ok(Object.values(rowCounts(runtime)).every(count => count === 0))
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('uncommitted staged deletion restores intact data before registry startup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-delete-stage-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Staged')
    await runtime.saveMarkdown(agent.id, '/notes/keep.md', 'Exact bytes', null)
    const chat = await runtime.createConversation(agent.id)
    runtime.close()
    await mkdir(join(directory, 'agent-deletions'))
    await rename(join(directory, 'agents', agent.id), join(directory, 'agent-deletions', agent.id))
    runtime = await AgentRuntime.open(directory)
    assert.deepEqual(await runtime.registry.list(), [agent])
    assert.equal(await runtime.read(agent.id, '/notes/keep.md'), 'Exact bytes')
    assert.equal(runtime.store.get(agent.id, chat.id).id, chat.id)
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('committed partial purge remains deleted and startup retries cleanup', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-delete-purge-'))
  const external = await mkdtemp(join(tmpdir(), 'granite-delete-external-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Deleted')
    await runtime.createConversation(agent.id)
    const section = await runtime.createSection(agent.id, 'Code', 'shared')
    const project = await runtime.createProject(agent.id, section.id, 'External')
    await writeFile(join(external, 'keep.txt'), 'External repository')
    await runtime.attachRepository(agent.id, project.id, external)
    context.mock.method(runtime.deletions, 'purge', () => {
      unlinkSync(join(directory, 'agent-deletions', agent.id, 'identity.md'))
      throw new Error('Simulated partial purge failure')
    })
    assert.deepEqual(await runtime.deleteAgent(agent.id), { cleanupPending: true })
    assert.deepEqual(await runtime.registry.list(), [])
    assert.equal(runtime.store.list(agent.id).length, 0)
    assert.match(runtime.recovery().agentDeletions![0].message, /cleanup pending/)
    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.deepEqual(await runtime.registry.list(), [])
    assert.equal(runtime.recovery().agentDeletions, undefined)
    await assert.rejects(access(join(directory, 'agent-deletions', agent.id)), { code: 'ENOENT' })
    assert.ok(Object.values(rowCounts(runtime)).every(count => count === 0))
    assert.equal(await readFile(join(external, 'keep.txt'), 'utf8'), 'External repository')
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
    await rm(external, { recursive: true, force: true })
  }
})

test('unsafe deletion storage cannot move an agent or touch the linked target', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-delete-storage-'))
  const external = await mkdtemp(join(tmpdir(), 'granite-delete-target-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Preserved')
    const chat = await runtime.createConversation(agent.id)
    await writeFile(join(external, 'keep.txt'), 'Untouched')
    await symlink(external, join(directory, 'agent-deletions'))
    await assert.rejects(runtime.deleteAgent(agent.id), /local directory/)
    assert.deepEqual(await runtime.registry.list(), [agent])
    assert.equal(runtime.store.get(agent.id, chat.id).id, chat.id)
    assert.equal(await readFile(join(external, 'keep.txt'), 'utf8'), 'Untouched')
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
    await rm(external, { recursive: true, force: true })
  }
})

test('a live folder cannot resurrect an agent whose deletion already committed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-delete-committed-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Conflict')
    runtime.store.saver.db.prepare('INSERT INTO agent_deletions VALUES (?)').run(agent.id)
    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.deepEqual(await runtime.registry.list(), [])
    await access(join(directory, 'agents', agent.id, 'identity.md'))
    assert.equal(runtime.recovery().agentDeletions![0].agentId, agent.id)
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('recovery preserves conflicting folders and isolates only the affected agent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-delete-conflict-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Conflict')
    const other = await runtime.createAgent('Usable')
    runtime.close()
    const staged = join(directory, 'agent-deletions', agent.id)
    await mkdir(join(directory, 'agent-deletions'))
    await rename(join(directory, 'agents', agent.id), staged)
    await mkdir(join(directory, 'agents', agent.id))
    await writeFile(join(directory, 'agents', agent.id, 'preserve.txt'), 'Live data')
    runtime = await AgentRuntime.open(directory)
    assert.deepEqual(await runtime.registry.list(), [other])
    await assert.rejects(runtime.read(agent.id, '/identity.md'), /recovery conflict/)
    await runtime.saveMarkdown(other.id, '/notes/works.md', 'Other data', null)
    assert.equal(await readFile(join(directory, 'agents', agent.id, 'preserve.txt'), 'utf8'), 'Live data')
    await access(join(staged, 'identity.md'))
    assert.equal(runtime.recovery().agentDeletions![0].agentId, agent.id)
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('chat deletion removes all recovered history and preserves other chats and workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-chat-delete-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Chat owner')
    const other = await runtime.createAgent('Other owner')
    const chat = await runtime.createConversation(agent.id)
    const survivor = await runtime.createConversation(agent.id)
    const turn = runtime.store.begin(agent.id, chat.id, 'Delete this', 'offline')
    await saveCheckpoint(runtime, turn.graphId, 'original')
    runtime.store.finish(chat.id, turn.message, 'stopped')
    const recovered = runtime.store.begin(agent.id, chat.id, 'Retry', 'offline')
    await saveCheckpoint(runtime, recovered.graphId, 'recovered')
    runtime.store.finish(chat.id, recovered.message, 'complete')
    runtime.store.saveModelState(chat.id, 'offline', [{ role: 'user', content: 'History' }])

    await assert.rejects(runtime.deleteConversation(other.id, chat.id), /Conversation not found/)

    const before = rowCounts(runtime)
    runtime.store.saver.db.exec(`CREATE TEMP TRIGGER reject_chat_deletion BEFORE DELETE ON conversations
      BEGIN SELECT RAISE(ABORT, 'Deletion failed'); END;`)
    await assert.rejects(runtime.deleteConversation(agent.id, chat.id), /Deletion failed/)
    assert.deepEqual(rowCounts(runtime), before)
    runtime.store.saver.db.exec('DROP TRIGGER reject_chat_deletion')

    await runtime.deleteConversation(agent.id, chat.id)
    const { messages: _messages, ...survivingMetadata } = survivor
    assert.deepEqual(runtime.store.list(agent.id), [survivingMetadata])
    assert.throws(() => runtime.store.get(agent.id, chat.id), /Conversation not found/)
    assert.equal(runtime.store.modelState(chat.id, 'offline'), undefined)
    for (const graphId of [turn.graphId, recovered.graphId]) {
      assert.equal(await runtime.store.saver.getTuple({ configurable: { thread_id: graphId } }), undefined)
    }
    for (const table of ['messages', 'conversation_threads', 'writes']) {
      const row = runtime.store.saver.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }
      assert.equal(row.count, table === 'conversation_threads' ? 1 : 0)
    }
    await access(join(directory, 'agents', agent.id, 'identity.md'))
    assert.equal((await runtime.registry.list()).length, 2)
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('chat renaming persists, validates names, and respects ownership and active operations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-chat-rename-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Owner')
    const other = await runtime.createAgent('Other')
    const chat = await runtime.createConversation(agent.id)
    const turn = runtime.store.begin(agent.id, chat.id, 'Original title', 'offline')
    runtime.store.finish(chat.id, turn.message, 'complete')
    const original = runtime.store.get(agent.id, chat.id)
    await assert.rejects(runtime.renameConversation(other.id, chat.id, 'Wrong owner'), /Conversation not found/)
    for (const title of ['', '   ', 'x'.repeat(201)]) {
      await assert.rejects(runtime.renameConversation(agent.id, chat.id, title), /Chat names/)
    }
    await runtime.renameConversation(agent.id, chat.id, '  Renamed chat  ')
    runtime.close()
    runtime = await AgentRuntime.open(directory)
    assert.deepEqual(runtime.store.get(agent.id, chat.id), { ...original, title: 'Renamed chat' })
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('deleteProject purges project chats and internal folder, but strictly preserves external repository', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-project-delete-'))
  const externalRepo = await mkdtemp(join(tmpdir(), 'granite-external-repo-'))
  await writeFile(join(externalRepo, 'main.ts'), 'console.log("preserve me")')
  const runtime = await AgentRuntime.open(directory)

  try {
    const agent = await runtime.createAgent('Project Test')
    const section = await runtime.createSection(agent.id, 'Coding', 'shared')
    const project = await runtime.createProject(agent.id, section.id, 'My Project', externalRepo)

    const chat = await runtime.createConversation(agent.id, { sectionId: section.id, projectId: project.id })
    const turn = runtime.store.begin(agent.id, chat.id, 'Hello in project', 'offline')
    runtime.store.finish(chat.id, turn.message, 'complete')

    assert.equal(runtime.store.list(agent.id).length, 1)
    const orgBefore = await runtime.organization(agent.id)
    assert.equal(orgBefore.projects.length, 1)

    // Delete the project
    await runtime.deleteProject(agent.id, project.id)

    // Project and its chat are removed from Granite
    const orgAfter = await runtime.organization(agent.id)
    assert.equal(orgAfter.projects.length, 0)
    assert.equal(runtime.store.list(agent.id).length, 0)

    // CRITICAL: External repo still exists on disk with all files untouched!
    await access(join(externalRepo, 'main.ts'))
    const content = await readFile(join(externalRepo, 'main.ts'), 'utf8')
    assert.equal(content, 'console.log("preserve me")')
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
    await rm(externalRepo, { recursive: true, force: true })
  }
})

test('deleteSection purges custom section, descendant projects and chats, and rejects deleting General', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-section-delete-'))
  const runtime = await AgentRuntime.open(directory)

  try {
    const agent = await runtime.createAgent('Section Test')
    const org = await runtime.organization(agent.id)
    const general = org.sections.find(s => s.kind === 'general')!
    await assert.rejects(runtime.deleteSection(agent.id, general.id), /General is the built-in section/)

    const custom = await runtime.createSection(agent.id, 'Research', 'closed')
    const project = await runtime.createProject(agent.id, custom.id, 'Research Notes')
    await runtime.createConversation(agent.id, { sectionId: custom.id, projectId: project.id })
    await runtime.createConversation(agent.id, { sectionId: custom.id })

    assert.equal(runtime.store.list(agent.id).length, 2)
    assert.equal((await runtime.organization(agent.id)).sections.length, 2)

    await runtime.deleteSection(agent.id, custom.id)

    const orgAfter = await runtime.organization(agent.id)
    assert.equal(orgAfter.sections.length, 1)
    assert.equal(orgAfter.projects.length, 0)
    assert.equal(runtime.store.list(agent.id).length, 0)
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('relinkProject updates repositoryPath, warns on duplicate link, and prevents detaching to chat-only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-relink-test-'))
  const repo1 = await mkdtemp(join(tmpdir(), 'granite-repo1-'))
  const repo2 = await mkdtemp(join(tmpdir(), 'granite-repo2-'))
  const runtime = await AgentRuntime.open(directory)

  try {
    const agent = await runtime.createAgent('Relink Agent')
    const section = await runtime.createSection(agent.id, 'Projects', 'shared')
    const p1 = await runtime.createProject(agent.id, section.id, 'P1', repo1)
    const p2 = await runtime.createProject(agent.id, section.id, 'P2')

    // Relink p1 to repo2
    const canonicalRepo2 = await realpath(repo2)
    const result = await runtime.relinkProject(agent.id, p1.id, repo2)
    assert.equal(result.project.repositoryPath, canonicalRepo2)
    assert.equal(result.warning, undefined)

    // Linking p2 to repo2 warns about duplicate
    const p2Relink = await runtime.relinkProject(agent.id, p2.id, repo2)
    assert.equal(p2Relink.project.repositoryPath, canonicalRepo2)
    assert.ok(p2Relink.warning?.includes('already linked to Project "P1"'))
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
    await rm(repo1, { recursive: true, force: true })
    await rm(repo2, { recursive: true, force: true })
  }
})

test('temporary chat expiry, keep, and sweep', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-temp-chat-'))
  const runtime = await AgentRuntime.open(directory)

  try {
    const agent = await runtime.createAgent('Temporary Chat Agent')
    // Create temporary chat
    const tempChat = await runtime.createConversation(agent.id, undefined, 'temporary')
    assert.equal(tempChat.retention, 'temporary')
    assert.ok(tempChat.expiresAt !== null)
    assert.ok(tempChat.expiresAt > Date.now())

    // Keep converts it to permanent
    const kept = await runtime.keepConversation(agent.id, tempChat.id)
    assert.equal(kept.retention, 'permanent')
    assert.equal(kept.expiresAt, null)

    // Cannot keep an already permanent chat
    await assert.rejects(runtime.keepConversation(agent.id, tempChat.id), /already permanent/)

    // Create another temporary chat and simulate expiry
    const expiringChat = await runtime.createConversation(agent.id, undefined, 'temporary')
    runtime.store.touchConversation(agent.id, expiringChat.id, Date.now() - 1000)

    // Sweep deletes expired chat
    await runtime.sweepExpiredChats()
    assert.equal(runtime.store.list(agent.id).filter(c => c.id === expiringChat.id).length, 0)
    // Kept chat survived
    assert.equal(runtime.store.list(agent.id).filter(c => c.id === tempChat.id).length, 1)
  } finally {
    runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})
