import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'

const duplicateSection = /section with this name already exists/
const duplicateProject = /project with this name already exists/

test('new names ignore case and surrounding spaces within their own scopes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-name-scopes-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const owner = await runtime.createAgent('Owner')
    const other = await runtime.createAgent('Other')
    const work = await runtime.createSection(owner.id, 'Work', 'shared')
    const personal = await runtime.createSection(owner.id, 'Personal', 'shared')
    const otherWork = await runtime.createSection(other.id, 'Work', 'shared')
    await runtime.createSection(owner.id, 'Équipe', 'shared')
    for (const value of ['Work', ' work ', 'WORK', 'éQUIPE', '\u00a0ÉQUIPE\u00a0', 'General', ' general ']) {
      await assert.rejects(runtime.createSection(owner.id, value, 'shared'), duplicateSection)
    }
    const project = await runtime.createProject(owner.id, work.id, 'Website')
    for (const value of ['Website', ' website ', 'WEBSITE']) {
      await assert.rejects(runtime.createProject(owner.id, work.id, value), duplicateProject)
    }
    await runtime.createProject(owner.id, personal.id, 'Website')
    await runtime.createProject(other.id, otherWork.id, 'Website')
    const root = (await runtime.registry.workspace(owner.id)).root
    const projectsPath = join(root, 'sections', work.id, 'projects')
    const folders = await readdir(projectsPath)
    await assert.rejects(runtime.createProject(owner.id, work.id, ' website ', null, true), duplicateProject)
    assert.deepEqual(await readdir(projectsPath), folders)
    assert.deepEqual(folders, [project.id])

    const db = runtime.store.saver.db
    assert.throws(() => db.prepare('INSERT INTO sections VALUES (?, ?, ?, ?, ?, ?)')
      .run('raw-section', owner.id, ' work ', 'custom', 'shared', Date.now()), duplicateSection)
    assert.throws(() => db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)')
      .run('raw-project', owner.id, work.id, ' WEBSITE ', null, Date.now()), duplicateProject)
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('renaming rejects collisions, permits case-only edits and excludes the item itself', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-name-renames-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const owner = await runtime.createAgent('Owner')
    const work = await runtime.createSection(owner.id, 'Work', 'shared')
    const personal = await runtime.createSection(owner.id, 'Personal', 'shared')
    const website = await runtime.createProject(owner.id, work.id, 'Website')
    const notes = await runtime.createProject(owner.id, work.id, 'Notes')
    const elsewhere = await runtime.createProject(owner.id, personal.id, 'Elsewhere')
    await assert.rejects(runtime.renameSection(owner.id, personal.id, ' WORK '), duplicateSection)
    await assert.rejects(runtime.renameSection(owner.id, personal.id, ' General '), duplicateSection)
    await assert.rejects(runtime.renameProject(owner.id, notes.id, ' website '), duplicateProject)
    assert.equal(runtime.store.organization.section(owner.id, personal.id).name, 'Personal')
    assert.equal(runtime.store.organization.project(owner.id, notes.id).name, 'Notes')
    assert.equal((await runtime.renameSection(owner.id, work.id, ' wOrK ')).name, 'wOrK')
    assert.equal((await runtime.renameSection(owner.id, work.id, 'wOrK')).id, work.id)
    assert.equal((await runtime.renameProject(owner.id, website.id, ' wEbSiTe ')).name, 'wEbSiTe')
    assert.equal((await runtime.renameProject(owner.id, website.id, 'wEbSiTe')).id, website.id)
    assert.equal((await runtime.renameProject(owner.id, elsewhere.id, 'Website')).name, 'Website')
    const db = runtime.store.saver.db
    assert.throws(() => db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(' WORK ', personal.id), duplicateSection)
    assert.throws(() => db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(' WEBSITE ', notes.id), duplicateProject)
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('legacy duplicates reopen unchanged and can be resolved without losing their folders or chats', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-legacy-duplicate-names-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const owner = await runtime.createAgent('Owner')
    const first = await runtime.createSection(owner.id, 'First', 'shared')
    const second = await runtime.createSection(owner.id, 'Second', 'shared')
    const website = await runtime.createProject(owner.id, first.id, 'Website')
    const duplicate = await runtime.createProject(owner.id, first.id, 'Another website')
    const chat = await runtime.createConversation(owner.id, { sectionId: first.id, projectId: duplicate.id })
    const turn = runtime.store.begin(owner.id, chat.id, 'Keep my history', 'test')
    turn.message.content = 'Saved response'
    runtime.store.finish(chat.id, turn.message, 'complete')
    const history = runtime.store.get(owner.id, chat.id).messages
    const root = (await runtime.registry.workspace(owner.id)).root
    const summary = join(root, 'sections', second.id, 'summary.md')
    await writeFile(summary, 'Keep this section context')
    const projectPath = join(root, 'sections', first.id, 'projects', duplicate.id)

    // Simulate the names an older version could save, without modifying any IDs.
    const db = runtime.store.saver.db
    db.exec('DROP TRIGGER section_name_insert; DROP TRIGGER section_name_update; DROP TRIGGER project_name_insert; DROP TRIGGER project_name_update;')
    db.prepare('UPDATE sections SET name = ? WHERE id = ?').run('Work', first.id)
    db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(' work ', second.id)
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(' website ', duplicate.id)
    const before = await runtime.organization(owner.id)
    for (let attempt = 0; attempt < 2; attempt++) {
      runtime.close(); runtime = await AgentRuntime.open(directory)
      assert.deepEqual(await runtime.organization(owner.id), before)
      assert.deepEqual(runtime.store.get(owner.id, chat.id).messages, history)
      assert.equal(await readFile(summary, 'utf8'), 'Keep this section context')
      await access(projectPath)
    }
    await assert.rejects(runtime.createSection(owner.id, 'WORK', 'shared'), duplicateSection)
    await assert.rejects(runtime.createProject(owner.id, first.id, 'WEBSITE'), duplicateProject)
    await runtime.renameSection(owner.id, second.id, 'WORK')
    await runtime.renameProject(owner.id, duplicate.id, 'WEBSITE')
    await runtime.renameSection(owner.id, second.id, 'Personal')
    await runtime.renameSection(owner.id, first.id, 'Archive')
    await runtime.renameProject(owner.id, duplicate.id, 'Other')
    await runtime.renameProject(owner.id, website.id, 'Documentation')
    await runtime.createSection(owner.id, 'Work', 'shared')
    await runtime.createProject(owner.id, first.id, 'Website')
    assert.deepEqual(runtime.store.get(owner.id, chat.id).messages, history)
    await access(projectPath)
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('independent connections cannot create matching section or project names concurrently', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-concurrent-names-'))
  const first = await AgentRuntime.open(directory)
  let second: AgentRuntime | undefined
  try {
    const owner = await first.createAgent('Owner')
    second = await AgentRuntime.open(directory)
    const sections = await Promise.allSettled([
      first.createSection(owner.id, 'Work', 'shared'), second.createSection(owner.id, ' work ', 'shared')
    ])
    assert.equal(sections.filter(result => result.status === 'fulfilled').length, 1)
    const sectionFailure = sections.find(result => result.status === 'rejected')!
    assert.match(sectionFailure.reason.message, duplicateSection)
    const section = (await first.organization(owner.id)).sections.find(item => item.kind === 'custom')!
    const projects = await Promise.allSettled([
      first.createProject(owner.id, section.id, 'Website'), second.createProject(owner.id, section.id, ' WEBSITE ')
    ])
    assert.equal(projects.filter(result => result.status === 'fulfilled').length, 1)
    const projectFailure = projects.find(result => result.status === 'rejected')!
    assert.match(projectFailure.reason.message, duplicateProject)
  } finally { second?.close(); first.close(); await rm(directory, { recursive: true, force: true }) }
})
