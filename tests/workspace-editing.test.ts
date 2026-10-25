import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'

test('user Markdown edits persist, detect stale content, and exclusively create notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-user-files-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Editor')
    const memory = await runtime.read(agent.id, '/memory.md')
    await runtime.saveMarkdown(agent.id, '/memory.md', '# Preferences\nI enjoy coding.', memory)
    await assert.rejects(runtime.saveMarkdown(agent.id, '/memory.md', 'Stale overwrite', memory), /changed/)
    await runtime.saveMarkdown(agent.id, '/identity.md', '# Editor\nBe concise.', '')
    await runtime.saveMarkdown(agent.id, '/notes/research.md', '# Research', null)
    await assert.rejects(runtime.saveMarkdown(agent.id, '/notes/research.md', 'Overwrite', null), /exist/i)
    await runtime.saveMarkdown(agent.id, '/notes/research.md', '# Updated research', '# Research')
    runtime.close(); runtime = await AgentRuntime.open(directory)
    assert.equal(await runtime.read(agent.id, '/memory.md'), '# Preferences\nI enjoy coding.')
    assert.equal(await runtime.read(agent.id, '/identity.md'), '# Editor\nBe concise.')
    assert.equal(await runtime.read(agent.id, '/notes/research.md'), '# Updated research')
    await runtime.saveMarkdown(agent.id, '/notes/research.md', '', '# Updated research')
    assert.equal(await runtime.read(agent.id, '/notes/research.md'), '')
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('renaming notes preserves content, follows nested folders and persists without replacing another note', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-note-renames-'))
  let runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Notes')
    await runtime.saveMarkdown(agent.id, '/notes/original.md', '# Original\nKeep these contents.', null)
    assert.equal(await runtime.renameNote(agent.id, '/notes/original.md', 'Renamed'), '/notes/Renamed.md')
    await assert.rejects(runtime.read(agent.id, '/notes/original.md'))
    assert.equal(await runtime.read(agent.id, '/notes/Renamed.md'), '# Original\nKeep these contents.')
    assert.equal(await runtime.renameNote(agent.id, '/notes/Renamed.md', 'renamed.md'), '/notes/renamed.md')
    await runtime.saveMarkdown(agent.id, '/notes/occupied.md', 'Do not replace', null)
    await assert.rejects(runtime.renameNote(agent.id, '/notes/renamed.md', 'occupied'), /already exists/)
    assert.equal(await runtime.read(agent.id, '/notes/occupied.md'), 'Do not replace')
    assert.equal(await runtime.read(agent.id, '/notes/renamed.md'), '# Original\nKeep these contents.')
    const workspace = await runtime.registry.workspace(agent.id)
    await mkdir(join(workspace.root, 'notes', 'nested'))
    await runtime.saveMarkdown(agent.id, '/notes/nested/old.md', 'Nested note', null)
    assert.equal(await runtime.renameNote(agent.id, '/notes/nested/old.md', 'new.md'), '/notes/nested/new.md')
    assert.equal(await runtime.renameNote(agent.id, '/notes/nested/new.md', 'new.md'), '/notes/nested/new.md')
    runtime.close(); runtime = await AgentRuntime.open(directory)
    assert.equal(await runtime.read(agent.id, '/notes/nested/new.md'), 'Nested note')
    await runtime.saveMarkdown(agent.id, '/notes/renamed.md', 'Editable after rename', '# Original\nKeep these contents.')
  } finally { runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('note renaming rejects protected files, unsafe names, links, folders and concurrent runs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-note-rename-boundaries-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Notes')
    await runtime.saveMarkdown(agent.id, '/notes/keep.md', 'Keep me', null)
    for (const name of ['', '   ', '.md', '..md', '../escape', 'nested/new', 'bad\\name', 'bad\nname', 'x'.repeat(121)]) {
      await assert.rejects(runtime.renameNote(agent.id, '/notes/keep.md', name))
    }
    for (const path of ['/identity.md', '/memory.md', '/agent.json', '/notes/../identity.md', '/notes/missing.md']) {
      await assert.rejects(runtime.renameNote(agent.id, path, 'No'))
    }
    const workspace = await runtime.registry.workspace(agent.id)
    await symlink(join(workspace.root, 'memory.md'), join(workspace.root, 'notes', 'link.md'))
    await assert.rejects(runtime.renameNote(agent.id, '/notes/link.md', 'No'), /Symbolic links/)
    await assert.rejects(runtime.renameNote(agent.id, '/notes/keep.md', 'link.md'), /Symbolic links/)
    await mkdir(join(workspace.root, 'notes', 'folder.md'))
    await assert.rejects(runtime.renameNote(agent.id, '/notes/folder.md', 'No'), /not a folder/)
    runtime.active = { id: 'run', controller: new AbortController() }
    await assert.rejects(runtime.renameNote(agent.id, '/notes/keep.md', 'No'), /current operation/)
    runtime.active = null
    assert.equal(await runtime.read(agent.id, '/notes/keep.md'), 'Keep me')
  } finally { runtime.active = null; runtime.close(); await rm(directory, { recursive: true, force: true }) }
})

test('user editor rejects unsafe/configuration paths, stale external edits and writes during runs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'granite-user-file-boundaries-'))
  const runtime = await AgentRuntime.open(directory)
  try {
    const agent = await runtime.createAgent('Editor')
    const workspace = await runtime.registry.workspace(agent.id)
    await writeFile(join(workspace.root, 'notes', 'external.md'), 'external change')
    await assert.rejects(runtime.saveMarkdown(agent.id, '/notes/external.md', 'draft', 'old value'), /changed/)
    await symlink(join(workspace.root, 'memory.md'), join(workspace.root, 'notes', 'alias.md'))
    for (const path of ['/agent.json', '/harness.json', '/tools/skills/test.md', '/notes/../memory.md', '/notes/alias.md', '/notes/../../escape.md', '/notes\\escape.md']) {
      await assert.rejects(runtime.saveMarkdown(agent.id, path, 'bad write', null))
    }
    await assert.rejects(runtime.saveMarkdown(agent.id, '/memory.md', 'new', null), /New files/)
    await assert.rejects(runtime.saveMarkdown(agent.id, '/notes/huge.md', 'x'.repeat(100_001), null), /100,000/)
    runtime.active = { id: 'run', controller: new AbortController() }
    await assert.rejects(runtime.saveMarkdown(agent.id, '/notes/during-run.md', 'new', null), /current operation/)
    runtime.active = null
    assert.equal(await runtime.read(agent.id, '/notes/external.md'), 'external change')
  } finally { runtime.active = null; runtime.close(); await rm(directory, { recursive: true, force: true }) }
})
