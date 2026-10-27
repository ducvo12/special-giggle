import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, lstat, readFile, realpath, rm, writeFile, open, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { terminalTool } from '../src/backend/harness/tools/terminal.ts'
import { AgentFilesystem } from '../src/backend/workspace/filesystem.ts'
import { runRepositoryProcess } from '../src/backend/repositories/process.ts'
import { RepositoryPaths } from '../src/backend/repositories/paths.ts'
import { scanTree, scanPaths, fingerprint } from '../src/backend/repositories/changes.ts'
import { copyVerifiedFile, inspectFile } from '../src/backend/repositories/files.ts'
import { gitManifest, mergeGitFile } from '../src/backend/repositories/command-workspace.ts'

async function directory() { return realpath(await mkdtemp(join(tmpdir(), 'granite-terminal-limits-'))) }
async function ready(path: string) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await lstat(path).then(() => true, () => false)) return
    await pause(10)
  }
  throw new Error('Command did not start.')
}

test('command scratch paths resolve aliases without granting access to sibling temporary files', { skip: process.platform !== 'darwin' }, async () => {
  const parent = await directory(), root = join(parent, 'repository')
  const storage = join(parent, 'temp-storage'), alias = join(parent, 'temp-alias')
  const previousTemp = process.env.TMPDIR
  try {
    await mkdir(root); await mkdir(storage); await symlink(storage, alias)
    await writeFile(join(parent, 'secret'), 'outside-secret')
    process.env.TMPDIR = alias
    const result = await runRepositoryProcess({ root, privateRoot: join(parent, 'private'), cwd: root,
      executable: '/bin/sh', args: ['-c', `set -e
mkdir -p "$HOME/.npm/_cacache"
printf cache > "$HOME/.npm/_cacache/probe"
printf temp > "$TMPDIR/probe"
printf '%s\\n%s\\n' "$HOME" "$TMPDIR"
if cat '${join(parent, 'secret')}'; then exit 41; fi
if printf forbidden > '${join(parent, 'outside-write')}'; then exit 42; fi
if printf forbidden > "$TMPDIR/../outside-scratch"; then exit 43; fi
cat "$HOME/.npm/_cacache/probe" "$TMPDIR/probe"`],
      signal: new AbortController().signal, writable: true, onStart: () => {} })
    assert.equal(result.exitCode, 0, JSON.stringify(result))
    const [home, temp] = result.output.split('\n')
    assert.equal(dirname(home), storage)
    assert.equal(temp, home)
    assert.ok(result.output.endsWith('cachetemp'))
    assert.ok(!result.output.includes('outside-secret'))
    await assert.rejects(lstat(home), { code: 'ENOENT' }, 'command scratch is removed on completion')
    await assert.rejects(lstat(join(parent, 'outside-write')), { code: 'ENOENT' })
    await assert.rejects(lstat(join(storage, 'outside-scratch')), { code: 'ENOENT' })
  } finally {
    if (previousTemp === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previousTemp
    await rm(parent, { recursive: true, force: true })
  }
})

for (const kind of ['repository', 'workspace'] as const) {
  test(`${kind} commands survive the former deadline and retain sandbox confinement`, { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
    const root = await directory(), controller = new AbortController()
    let running: Promise<any> | undefined
    try {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const command = '#' + 'x'.repeat(17_000) + '\nprintf ready > ready; while [ ! -e release ]; do sleep 0.01; done; printf completed > result; printf done'
      running = kind === 'repository'
        ? runRepositoryProcess({ root, privateRoot: join(root, 'private'), cwd: root, executable: '/bin/sh', args: ['-c', command],
          signal: controller.signal, writable: true, onStart: () => {} })
        : terminalTool(new AgentFilesystem(root), controller.signal).run({ command, cwd: '/' })
      await ready(join(root, 'ready'))
      // Advance the parent's clock past both old kill deadlines while the real
      // sandboxed child is demonstrably still running.
      t.mock.timers.tick(121_000)
      await writeFile(join(root, 'release'), '')
      const result = await running
      assert.equal(result.exitCode, 0, JSON.stringify(result))
      assert.equal(result.timedOut, false)
      assert.equal(result.output, 'done')
      assert.equal(await readFile(join(root, 'result'), 'utf8'), 'completed')
      t.mock.timers.reset()
      const outside = join(tmpdir(), `blocked-${root.split('/').at(-1)}`)
      const denied = `printf bad > '${outside}'`
      const outcome: any = kind === 'repository'
        ? await runRepositoryProcess({ root, privateRoot: join(root, 'private'), cwd: root, executable: '/bin/sh', args: ['-c', denied],
          signal: controller.signal, writable: true, onStart: () => {} })
        : await terminalTool(new AgentFilesystem(root), controller.signal).run({ command: denied })
      assert.notEqual(outcome.exitCode, 0)
      await assert.rejects(lstat(outside), { code: 'ENOENT' })
      const waiting = 'printf ready > waiting; while :; do sleep 0.01; done'
      running = kind === 'repository'
        ? runRepositoryProcess({ root, privateRoot: join(root, 'private'), cwd: root, executable: '/bin/sh', args: ['-c', waiting],
          signal: controller.signal, writable: true, onStart: () => {} })
        : terminalTool(new AgentFilesystem(root), controller.signal).run({ command: waiting })
      await ready(join(root, 'waiting'))
      controller.abort(new Error('Stopped by user'))
      await assert.rejects(running, /Stopped by user/)
    } finally {
      controller.abort(); t.mock.timers.reset()
      await running?.catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('manifests and verified publication support artifacts beyond the former 128 MB cap', async () => {
  const root = await directory()
  try {
    const source = join(root, 'large.bin'), file = await open(source, 'w')
    await file.truncate(128_000_001); await file.close()
    const paths = new RepositoryPaths(root, join(root, 'private'))
    const before = await scanTree(paths)
    assert.equal(before['large.bin'].large, true)
    assert.equal(before['large.bin'].text, undefined)
    assert.equal((await scanPaths(paths, ['large.bin']))['large.bin'].hash, before['large.bin'].hash)
    await copyVerifiedFile(source, join(root, 'copied.bin'), before['large.bin'].hash, 0o755)
    assert.equal((await lstat(join(root, 'copied.bin'))).size, 128_000_001)
    assert.equal((await inspectFile(join(root, 'copied.bin'))).hash, before['large.bin'].hash)
    await mkdir(join(root, '.git/objects'), { recursive: true })
    await copyVerifiedFile(source, join(root, '.git/objects/large'), before['large.bin'].hash, 0o644)
    const metadata = await gitManifest(root)
    assert.equal(metadata['.git/objects/large'].hash, before['large.bin'].hash)
    const target = join(root, 'target'); await mkdir(target)
    await mergeGitFile(target, root, '.git/objects/large', undefined, before['large.bin'].hash)
    assert.equal((await lstat(join(target, '.git/objects/large'))).size, 128_000_001)
    await assert.rejects(copyVerifiedFile(source, join(root, 'wrong.bin'), fingerprint(Buffer.from('wrong')), 0o644), /changed/)
    await assert.rejects(lstat(join(root, 'wrong.bin')), { code: 'ENOENT' })
    await symlink(source, join(root, 'link'))
    await assert.rejects(copyVerifiedFile(join(root, 'link'), join(root, 'escape.bin'), before['large.bin'].hash, 0o644))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('manifests accept dependency trees beyond the former 25,000-entry cap', { timeout: 60_000 }, async () => {
  const root = await directory()
  try {
    await mkdir(join(root, '.git'))
    for (let start = 0; start < 25_001; start += 100) {
      await Promise.all(Array.from({ length: Math.min(100, 25_001 - start) }, async (_, i) => {
        await writeFile(join(root, '.git', String(start + i)), '')
      }))
    }
    assert.equal(Object.keys(await gitManifest(root)).length, 25_001)
    await (await import('node:fs/promises')).rename(join(root, '.git'), join(root, 'node_modules'))
    assert.equal(Object.keys(await scanTree(new RepositoryPaths(root, join(root, 'private')))).length, 25_002)
  } finally { await rm(root, { recursive: true, force: true }) }
})
