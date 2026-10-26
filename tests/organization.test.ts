import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { AgentFilesystem } from '../src/backend/workspace/filesystem.ts'

test('flat databases migrate into one General per agent without changing history, files or native state on repeated reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-organization-migrate-'))
  const root = join(directory, 'agents', 'atlas')
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'identity.md'), 'Existing personality')
  await writeFile(join(root, 'memory.md'), 'Existing preference')
  await writeFile(join(root, 'notes', 'retained.md'), 'Keep this note')
  const otherId = 'agent-00000000-0000-4000-8000-000000000001'
  const otherRoot = join(directory, 'agents', otherId)
  await mkdir(otherRoot)
  await writeFile(join(otherRoot, 'agent.json'), JSON.stringify({ id: otherId, name: 'Existing second agent' }))
  await writeFile(join(otherRoot, 'identity.md'), 'Other existing personality')
  await writeFile(join(otherRoot, 'memory.md'), 'Other existing preference')
  const old = SqliteSaver.fromConnString(join(directory, 'atlas.sqlite'))
  old.db.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, updatedAt INTEGER NOT NULL,
    graphId TEXT NOT NULL, recover INTEGER NOT NULL DEFAULT 0, agentId TEXT NOT NULL DEFAULT 'atlas', engine TEXT NOT NULL DEFAULT 'openai');
    CREATE TABLE messages (id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, createdAt INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE harness_state (conversationId TEXT PRIMARY KEY, modelKey TEXT NOT NULL, data TEXT NOT NULL);`)
  const message = { id: 'message', role: 'assistant', content: 'Saved response', model: 'old-model', status: 'complete' }
  const state = [{ role: 'assistant', content: 'Native continuation' }]
  old.db.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?, ?)').run('chat', 'Old title', 123, 'graph', 0, 'atlas', 'old-engine')
  old.db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)').run(message.id, 'chat', 124, JSON.stringify(message))
  old.db.prepare('INSERT INTO harness_state VALUES (?, ?, ?)').run('chat', 'key', JSON.stringify(state))
  old.db.close()
  let generalId = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const runtime = await AgentRuntime.open(directory)
    try {
      const layout = await runtime.organization('atlas')
      assert.equal(layout.sections.length, 1)
      const general = layout.sections[0]
      assert.equal(general.name, 'General'); assert.equal(general.kind, 'general'); assert.equal(general.mode, 'shared')
      if (generalId) assert.equal(general.id, generalId)
      generalId = general.id
      const chat = runtime.store.get('atlas', 'chat')
      assert.equal(chat.sectionId, general.id); assert.equal(chat.projectId, null)
      assert.equal(chat.retention, 'permanent'); assert.equal(chat.expiresAt, null)
      assert.equal(chat.updatedAt, 123); assert.equal(chat.title, 'Old title')
      assert.equal(chat.createdAt, 124); assert.equal(chat.lastChattedAt, 124)
      assert.deepEqual(chat.messages, [message]); assert.deepEqual(runtime.store.modelState('chat', 'key'), state)
      const row = runtime.store.saver.db.prepare('SELECT graphId, engine FROM conversations WHERE id = ?').get('chat')
      assert.deepEqual(row, { graphId: 'graph', engine: 'old-engine' })
      assert.equal(await runtime.read('atlas', '/identity.md'), 'Existing personality')
      assert.equal(await runtime.read('atlas', '/memory.md'), 'Existing preference')
      assert.equal(await runtime.read('atlas', '/notes/retained.md'), 'Keep this note')
      await access(join(root, 'sections', general.id, 'summary.md'))
      await access(join(root, 'tools', 'skills'))
      await access(join(otherRoot, 'tools', 'skills'))
      assert.equal((await runtime.organization(otherId)).sections.length, 1)
      assert.equal(await runtime.read(otherId, '/memory.md'), 'Other existing preference')
    } finally { runtime.close() }
  }
  await rm(directory, { recursive: true, force: true })
})

test('chat creation dates persist independently of activity and renaming', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-chat-dates-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Dates')
    const chat = await runtime.createConversation(agent.id)
    assert.ok(chat.createdAt > 0)
    assert.equal(chat.lastChattedAt, null)
    await runtime.renameConversation(agent.id, chat.id, 'Renamed empty chat')
    assert.equal(runtime.store.get(agent.id, chat.id).lastChattedAt, null)
    const turn = runtime.store.begin(agent.id, chat.id, 'Hello', 'test')
    runtime.store.finish(chat.id, turn.message, 'complete')
    const activity = runtime.store.get(agent.id, chat.id).lastChattedAt
    assert.ok(activity! >= chat.createdAt)
    await runtime.renameConversation(agent.id, chat.id, 'Renamed again')
    runtime.close(); runtime = await AgentRuntime.open(directory)
    const saved = runtime.store.list(agent.id)[0]
    assert.equal(saved.createdAt, chat.createdAt)
    assert.equal(saved.lastChattedAt, activity)
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('hierarchy persists, names do not move folders, ownership is checked and database invariants reject invalid placement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-hierarchy-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const owner = await runtime.createAgent('Owner')
    const other = await runtime.createAgent('Other')
    const general = (await runtime.organization(owner.id)).sections[0]
    const closed = await runtime.createSection(owner.id, 'Club', 'closed')
    const shared = await runtime.createSection(owner.id, 'Shared section', 'shared')
    const project = await runtime.createProject(owner.id, closed.id, 'Website planning')
    const root = (await runtime.registry.workspace(owner.id)).root
    const projectPath = join(root, 'sections', closed.id, 'projects', project.id)
    await access(projectPath)
    await runtime.renameSection(owner.id, closed.id, 'Renamed club')
    await runtime.renameProject(owner.id, project.id, 'Renamed project')
    await access(projectPath)
    await assert.rejects(runtime.renameSection(owner.id, general.id, 'Other'), /cannot be renamed/)
    await assert.rejects(runtime.createProject(owner.id, general.id, 'Invalid'), /General contains chats only/)
    await assert.rejects(runtime.createProject(other.id, closed.id, 'Invalid'), /Section not found/)
    await assert.rejects(runtime.renameProject(other.id, project.id, 'Invalid'), /Project not found/)
    await assert.rejects(runtime.createSection(owner.id, '../bad\nname', 'closed'), /section name/)
    await assert.rejects(runtime.createSection(owner.id, 'Unspecified', 'invalid' as any), /Choose Shared or Closed/)
    await assert.rejects(runtime.createConversation(other.id, { sectionId: closed.id }), /Section not found/)
    await assert.rejects(runtime.createConversation(owner.id, { sectionId: shared.id, projectId: project.id }), /does not belong/)
    const db = runtime.store.saver.db
    assert.throws(() => db.prepare('UPDATE projects SET sectionId = ? WHERE id = ?').run(shared.id, project.id), /cannot move/)
    assert.throws(() => db.prepare("UPDATE sections SET mode = 'closed' WHERE id = ?").run(shared.id), /cannot become Closed/)
    const chat = await runtime.createConversation(owner.id, { sectionId: closed.id, projectId: project.id })
    assert.throws(() => db.prepare('UPDATE conversations SET sectionId = ? WHERE id = ?').run(general.id, chat.id))
    const before = await runtime.organization(owner.id)
    runtime.close(); runtime = await AgentRuntime.open(directory)
    assert.deepEqual(await runtime.organization(owner.id), before)
    assert.equal((await runtime.organization(other.id)).sections.length, 1)
    assert.equal(runtime.store.get(owner.id, chat.id).projectId, project.id)
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('moves retain transcript and IDs, enforce Closed/project boundaries and invalidate source continuation state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-chat-moves-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Mover')
    const other = await runtime.createAgent('Other')
    const general = (await runtime.organization(agent.id)).sections[0]
    const closed = await runtime.createSection(agent.id, 'Private', 'closed')
    const project = await runtime.createProject(agent.id, closed.id, 'Private planning')
    const chat = await runtime.createConversation(agent.id)
    await runtime.renameConversation(agent.id, chat.id, 'Planning chat')
    const turn = runtime.store.begin(agent.id, chat.id, 'Keep my history', 'offline')
    turn.message.content = 'Original response'
    runtime.store.finish(chat.id, turn.message, 'complete')
    assert.equal(runtime.store.get(agent.id, chat.id).title, 'Planning chat')
    runtime.store.saveModelState(chat.id, 'key', [{ role: 'assistant', content: 'Old privileged context' }])
    const history = runtime.store.get(agent.id, chat.id).messages
    await runtime.moveConversation(agent.id, chat.id, { sectionId: closed.id, projectId: null })
    assert.equal(runtime.store.modelState(chat.id, 'key'), undefined)
    assert.deepEqual(runtime.store.get(agent.id, chat.id).messages, history)
    await runtime.moveConversation(agent.id, chat.id, { sectionId: closed.id, projectId: project.id })
    await assert.rejects(runtime.moveConversation(agent.id, chat.id, { sectionId: general.id, projectId: null }), /entire Closed section Shared/)
    await assert.rejects(runtime.moveConversation(other.id, chat.id, { sectionId: general.id, projectId: null }), /Conversation not found/)
    runtime.active = { id: 'busy', controller: new AbortController() }
    await assert.rejects(runtime.moveConversation(agent.id, chat.id, { sectionId: closed.id, projectId: null }), /Finish the current operation/)
    runtime.active = null
    await runtime.shareSection(agent.id, closed.id)
    await runtime.moveConversation(agent.id, chat.id, { sectionId: general.id, projectId: null })
    assert.deepEqual(runtime.store.get(agent.id, chat.id).messages, history)
    assert.equal(runtime.store.get(agent.id, chat.id).id, chat.id)
    const temporary = runtime.store.create(agent.id, { sectionId: closed.id }, 'temporary')
    await assert.rejects(runtime.moveConversation(agent.id, temporary.id, { sectionId: closed.id, projectId: project.id }), /Keep a temporary chat/)
    assert.equal(runtime.store.get(agent.id, temporary.id).expiresAt, null)
  } finally { runtime.active = null; runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('repository links bind all project chats, allow duplicate physical roots and never copy or modify external code', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-repository-links-'))
  const runtime = await AgentRuntime.open(join(directory, 'profile'))
  try {
    const repository = join(directory, 'external-repo')
    await mkdir(repository); await writeFile(join(repository, 'keep.ts'), 'original')
    const alias = join(directory, 'repo-alias'); await symlink(repository, alias)
    const agent = await runtime.createAgent('Developer')
    const other = await runtime.createAgent('Another developer')
    const section = await runtime.createSection(agent.id, 'Code', 'shared')
    const secondSection = await runtime.createSection(other.id, 'Code', 'shared')
    const project = await runtime.createProject(agent.id, section.id, 'One')
    const second = await runtime.createProject(other.id, secondSection.id, 'Two')
    const chat = await runtime.createConversation(agent.id, { sectionId: section.id, projectId: project.id })
    const attached = await runtime.attachRepository(agent.id, project.id, repository)
    const duplicate = await runtime.attachRepository(other.id, second.id, alias)
    const canonical = await realpath(repository)
    assert.equal(attached.repositoryPath, canonical); assert.equal(duplicate.repositoryPath, canonical)
    await assert.rejects(runtime.moveConversation(agent.id, chat.id, { sectionId: section.id, projectId: null }), /cannot leave/)
    await assert.rejects(runtime.attachRepository(agent.id, project.id, directory), /already has a repository/)
    assert.throws(() => runtime.store.saver.db.prepare('UPDATE projects SET repositoryPath = NULL WHERE id = ?').run(project.id), /already has a repository/)
    const outside = await runtime.createConversation(agent.id, { sectionId: section.id })
    await runtime.moveConversation(agent.id, outside.id, { sectionId: section.id, projectId: project.id })
    const unattached = await runtime.createProject(agent.id, section.id, 'Failed attachment')
    await assert.rejects(runtime.attachRepository(agent.id, unattached.id, join(directory, 'missing')))
    assert.equal(runtime.store.organization.project(agent.id, unattached.id).repositoryPath, null)
    assert.equal(await readFile(join(repository, 'keep.ts'), 'utf8'), 'original')
    assert.deepEqual(await readdir(repository), ['keep.ts'])
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('project creation can link a repository immediately and invalid folders do not publish a project', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-project-repository-create-'))
  const runtime = await AgentRuntime.open(join(directory, 'profile'))
  try {
    const repository = join(directory, 'code')
    await mkdir(repository); await writeFile(join(repository, 'keep.ts'), 'original')
    const alias = join(directory, 'code-alias'); await symlink(repository, alias)
    const agent = await runtime.createAgent('Developer')
    const section = await runtime.createSection(agent.id, 'Code', 'shared')
    const project = await runtime.createProject(agent.id, section.id, 'Website', alias)
    assert.equal(project.repositoryPath, await realpath(repository))
    assert.equal(runtime.store.organization.project(agent.id, project.id).repositoryPath, project.repositoryPath)
    const chat = await runtime.createConversation(agent.id, { sectionId: section.id, projectId: project.id })
    await assert.rejects(runtime.moveConversation(agent.id, chat.id, { sectionId: section.id, projectId: null }), /cannot leave/)
    const before = await runtime.organization(agent.id)
    for (const invalid of [join(directory, 'missing'), join(repository, 'keep.ts'), join(directory, 'profile'), 'relative-folder']) {
      await assert.rejects(runtime.createProject(agent.id, section.id, 'Invalid', invalid))
      assert.deepEqual(await runtime.organization(agent.id), before)
    }
    const unlinked = await runtime.createProject(agent.id, section.id, 'Planning')
    assert.equal(unlinked.repositoryPath, null)
    assert.equal(await readFile(join(repository, 'keep.ts'), 'utf8'), 'original')
    assert.deepEqual(await readdir(repository), ['keep.ts'])
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('new section storage cannot leak through legacy agent tools and unsafe storage fails without publishing a section', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-section-storage-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Private owner')
    const section = await runtime.createSection(agent.id, 'Private', 'closed')
    const root = (await runtime.registry.workspace(agent.id)).root
    await writeFile(join(root, 'sections', section.id, 'notes', 'secret.md'), 'organization-secret')
    await writeFile(join(root, 'notes', 'visible.md'), 'ordinary-note')
    const modelFiles = new AgentFilesystem(root, { excludeOrganization: true })
    assert.ok(!(await modelFiles.ls('/')).files?.some(file => file.path === '/sections/'))
    await assert.rejects(modelFiles.readRaw(`/sections/${section.id}/notes/secret.md`), /not available/)
    assert.deepEqual((await modelFiles.grep('organization-secret')).matches, [])
    assert.equal((await modelFiles.grep('ordinary-note')).matches?.length, 1)
    assert.ok(!(await modelFiles.glob('**/*.md')).files?.some(file => file.path.includes('/sections/')))
    const chat = await runtime.createConversation(agent.id, { sectionId: section.id })
    await assert.rejects(runtime.run('closed', agent.id, chat.id, { baseUrl: 'http://127.0.0.1:1', model: 'offline', apiKey: '' }, 'Hello', () => {}), /isolated context/)
    const before = await runtime.organization(agent.id)
    const outside = join(directory, 'outside'); await mkdir(outside)
    await rename(join(root, 'sections'), join(root, 'saved-sections'))
    await symlink(outside, join(root, 'sections'))
    await assert.rejects(runtime.createSection(agent.id, 'Unsafe', 'shared'), /symbolic links/)
    assert.deepEqual(await runtime.organization(agent.id), before)
    assert.deepEqual(await readdir(outside), [])
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})
