import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RepositoryEditors } from '../src/main/repository-editors.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'granite-editors-'))
  const applications = join(root, 'Applications'), repository = join(root, 'repo with spaces; $literal')
  await mkdir(repository)
  const calls: { executable: string; args: string[] }[] = []
  const environment = { platform: 'darwin' as const, applicationDirectories: [applications], launch: async (executable: string, args: string[]) => { calls.push({ executable, args }) } }
  const directory = join(root, 'preferences')
  const editors = new RepositoryEditors(directory, environment)
  async function app(name: string) {
    const path = join(applications, name + '.app')
    await mkdir(join(path, 'Contents'), { recursive: true })
    await writeFile(join(path, 'Contents', 'Info.plist'), '<plist/>')
    return path
  }
  return { root, repository, calls, editors, environment, directory, app, close: () => rm(root, { recursive: true, force: true }) }
}

test('repository editor defaults to VS Code and opens a new window with a literal folder argument', async () => {
  const f = await fixture()
  try {
    const code = await f.app('Visual Studio Code')
    await f.app('Cursor')
    assert.equal((await f.editors.choices()).selectedId, 'vscode')
    await f.editors.open(f.repository)
    assert.deepEqual(f.calls, [{ executable: '/usr/bin/open', args: ['-n', '-a', code, '--args', '--new-window', f.repository] }])
    await f.editors.open(f.repository, 'cursor')
    assert.equal((await new RepositoryEditors(f.directory, f.environment).choices()).selectedId, 'cursor')
  } finally { await f.close() }
})

test('native application choices persist; removed editors fall back to an installed editor', async () => {
  const f = await fixture()
  try {
    await f.app('Cursor')
    assert.equal((await f.editors.choices()).selectedId, 'cursor')
    const custom = await f.app('Another IDE')
    await f.editors.openApplication(f.repository, custom)
    const reopened = new RepositoryEditors(f.directory, f.environment)
    assert.equal((await reopened.choices()).selectedId, 'custom')
    assert.deepEqual(f.calls[0].args, ['-n', '-a', custom, f.repository])
    await rm(custom, { recursive: true })
    assert.equal((await reopened.choices()).selectedId, 'cursor')
  } finally { await f.close() }
})

test('missing folders, unknown editor IDs and failed launches do not change the preferred editor', async () => {
  const f = await fixture()
  try {
    await f.app('Visual Studio Code'); await f.app('Cursor')
    await assert.rejects(f.editors.open(f.repository, '/bin/sh'), /No selected editor/)
    await assert.rejects(f.editors.open(join(f.root, 'missing')), /ENOENT/)
    const failing = new RepositoryEditors(f.directory, { ...f.environment, launch: async () => { throw new Error('OS launch failed') } })
    await assert.rejects(failing.open(f.repository, 'cursor'), /Could not open Cursor/)
    assert.equal((await f.editors.choices()).selectedId, 'vscode')
    assert.equal(f.calls.length, 0)
  } finally { await f.close() }
})

test('Linux editor discovery uses executable PATH entries and passes the repository as a literal argument', async () => {
  const f = await fixture()
  try {
    const bin = join(f.root, 'bin'); await mkdir(bin)
    const code = join(bin, 'code'); await writeFile(code, '#!/bin/sh\n'); await chmod(code, 0o700)
    const editors = new RepositoryEditors(f.directory, { ...f.environment, platform: 'linux', variables: { PATH: `.:${bin}` } })
    await editors.open(f.repository)
    assert.deepEqual(f.calls[0], { executable: code, args: ['--new-window', f.repository] })
  } finally { await f.close() }
})
