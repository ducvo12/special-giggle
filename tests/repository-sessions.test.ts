import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readlink, lstat, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { RepositorySession } from '../src/backend/repositories/session.ts'
import { TerminalOutput } from '../src/backend/repositories/terminal-output.ts'
import { processGroup, settleProcess, type ProcessRecord } from '../src/backend/repositories/process.ts'
import { createToolRegistry } from '../src/backend/harness/tools/registry.ts'
import { repositoryAccess } from '../src/backend/repositories/access.ts'
import { defaultHarnessSettings } from '../src/shared/harness.ts'

const mac = { skip: process.platform !== 'darwin', timeout: 30_000 }
async function until<T>(read: () => Promise<T>, check: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 300; i++) { const value = await read(); if (check(value)) return value; await new Promise(r => setTimeout(r, 10)) }
  throw new Error('Session fixture did not reach the expected state.')
}
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'granite-sessions-')))
  const runtime = await AgentRuntime.open(join(directory, 'profile'))
  const agent = await runtime.createAgent('Sessions'), section = await runtime.createSection(agent.id, 'Code', 'shared')
  const project = await runtime.createProject(agent.id, section.id, 'Project'), root = join(directory, 'repo')
  await mkdir(root); await runtime.attachRepository(agent.id, project.id, root)
  const chat = await runtime.createConversation(agent.id, { sectionId: section.id, projectId: project.id })
  const controller = new AbortController()
  const record = { runId: 'session-fixture', agentId: agent.id, conversationId: chat.id, projectId: project.id, root,
    baseline: {}, touched: [], report: { runId: 'session-fixture', projectId: project.id, name: project.name, state: 'active' as const, changes: [], preExisting: 0 } }
  runtime.repositories.save(record)
  const session = new RepositorySession(record, runtime.repositories, controller.signal, () => {})
  return { directory, runtime, root, session, controller, agent, section, project, chat,
    async close() { await session.close(); await runtime.stopAll(); runtime.close(); await rm(directory, { recursive: true, force: true }) } }
}

test('PTY prompts, resize, guarded input, executable links and isolated cache work across commands', mac, async () => {
  const f = await fixture()
  try {
    const command = `set -e
test -t 0 && test -t 1
stty size
printf 'Project name? '
read name
printf 'Install? '
read install
stty size
mkdir -p node_modules/demo/bin node_modules/.bin
printf '#!/bin/sh\\nprintf "hello %s"\\n' "$name" > node_modules/demo/bin/demo
chmod +x node_modules/demo/bin/demo
ln -s ../demo/bin/demo node_modules/.bin/demo
printf '%s' "$install" > "$HOME/setup-answer"
printf complete`
    let state = await f.session.startCommand(command, '', false, true, 90, 25)
    assert.equal(state.status, 'running', JSON.stringify(state))
    assert.match(state.output, /25\s+90/)
    assert.match(state.output, /Project name/)
    await assert.rejects(f.session.command('/bin/sh', ['-c', 'true']), /active command/)
    await assert.rejects(f.session.write('native.txt', Buffer.from('bad'), null), /active command/)
    state = await f.session.inputCommand(state.id, 0, 'demo\r', 120, 40)
    await assert.rejects(f.session.inputCommand(state.id, 0, 'duplicate\r'), /Stale command input/)
    state = await until(() => f.session.readCommand(state.id, 0, 20), value => value.output.includes('Install?'))
    state = await f.session.inputCommand(state.id, 1, 'yes\r')
    state = await until(() => f.session.readCommand(state.id, 0, 20), value => value.status !== 'running' && value.status !== 'publishing')
    assert.equal(state.status, 'complete', JSON.stringify(state))
    assert.equal(state.publication, 'applied')
    assert.match(state.output, /40\s+120/)
    assert.equal(await readlink(join(f.root, 'node_modules/.bin/demo')), '../demo/bin/demo')
    const result = await f.session.command('/bin/sh', ['-c', './node_modules/.bin/demo > invoked.txt; cat "$HOME/setup-answer"'])
    assert.equal(result.exitCode, 0, JSON.stringify(result)); assert.equal(result.output, 'yes')
    assert.equal(await readFile(join(f.root, 'invoked.txt'), 'utf8'), 'hello demo')
    assert.ok(f.session.record.report.changes.some(change => change.symbolicLink))
    assert.ok(f.session.record.report.changes.some(change => change.generated))
    assert.ok(f.session.record.environment)
    const home = f.session.record.environment!
    await f.session.close()
    await assert.rejects(lstat(home), { code: 'ENOENT' })
    await assert.rejects(f.session.readCommand(state.id), /unavailable/)
  } finally { await f.close() }
})

test('stopping an interactive command discards staged edits and preserves completed live edits', mac, async () => {
  const f = await fixture()
  try {
    await f.session.write('kept.txt', Buffer.from('kept'), null)
    const state = await f.session.startCommand('printf staged > unfinished.txt; printf waiting; read answer; printf late > late.txt')
    assert.equal(state.status, 'running')
    await assert.rejects(lstat(join(f.root, 'unfinished.txt')), { code: 'ENOENT' })
    const stopped = await f.session.stopCommand(state.id)
    assert.equal(stopped.status, 'stopped'); assert.equal(stopped.publication, 'discarded')
    await assert.rejects(f.session.inputCommand(state.id, 0, 'late\r'), /not accepting/)
    await assert.rejects(lstat(join(f.root, 'late.txt')), { code: 'ENOENT' })
    assert.equal(await readFile(join(f.root, 'kept.txt'), 'utf8'), 'kept')
    assert.equal((await f.session.command('/bin/sh', ['-c', 'printf next > next.txt'])).exitCode, 0)
  } finally { await f.close() }
})

test('commands can clean up their own workers and use a disposable parent without gaining host access', mac, async () => {
  const f = await fixture()
  try {
    assert.throws(() => settleProcess({ pid: process.pid, token: 'not-the-owner' }), /identified safely/)
    const result = await f.session.command('/bin/sh', ['-c', `set -e
test -w ..
printf scratch > ../container-only
sleep 20 & owned=$!
kill "$owned"
wait "$owned" || true
if kill -0 ${process.pid}; then exit 41; fi
if printf bad > '${join(f.directory, 'host-parent-write')}'; then exit 42; fi
printf live > published.txt`])
    assert.equal(result.exitCode, 0, JSON.stringify(result))
    assert.equal(await readFile(join(f.root, 'published.txt'), 'utf8'), 'live')
    await assert.rejects(lstat(join(f.directory, 'host-parent-write')), { code: 'ENOENT' })
    await assert.rejects(lstat(join(f.directory, 'container-only')), { code: 'ENOENT' })
    assert.ok(!f.session.record.report.changes.some(change => change.path.includes('container-only')))
  } finally { await f.close() }
})

test('an interactive shell retains its environment and working directory until its checkpoint', mac, async () => {
  const f = await fixture()
  try {
    let state = await f.session.startCommand('/bin/sh -i')
    state = await f.session.inputCommand(state.id, 0, 'export SETUP_TOKEN=retained; mkdir work; cd work; printf "%s" "$SETUP_TOKEN" > first.txt\r')
    state = await f.session.inputCommand(state.id, 1, 'printf "%s" "$SETUP_TOKEN" > second.txt; exit\r')
    state = await until(() => f.session.readCommand(state.id, 0, 20), value => ['complete','failed'].includes(value.status))
    assert.equal(state.status, 'complete', JSON.stringify(state))
    assert.equal(await readFile(join(f.root, 'work/first.txt'), 'utf8'), 'retained')
    assert.equal(await readFile(join(f.root, 'work/second.txt'), 'utf8'), 'retained')
  } finally { await f.close() }
})

test('Stop settles interactive shell job-control groups as well as its PTY leader', mac, async () => {
  const f = await fixture()
  try {
    let state = await f.session.startCommand('/bin/sh -i')
    state = await f.session.inputCommand(state.id, 0, 'sleep 30 & echo owned-worker:$!\r')
    state = await until(() => f.session.readCommand(state.id, 0, 20), value => /owned-worker:\d+/.test(value.output))
    const worker = Number(state.output.match(/owned-worker:(\d+)/)![1])
    await f.session.stopCommand(state.id)
    await until(async () => { try { process.kill(worker, 0); return false } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' } }, Boolean)
  } finally { await f.close() }
})

test('link replacement/deletion and contained hard-link outputs publish without sharing live inodes', mac, async () => {
  const f = await fixture()
  try {
    assert.equal((await f.session.command('/bin/sh', ['-c', 'printf a > a; printf b > b; ln -s a alias'])).exitCode, 0)
    assert.notEqual(f.session.record.report.state, 'attention', f.session.record.report.error)
    assert.equal((await f.session.command('/bin/sh', ['-c', 'rm alias; ln -s b alias; mkdir -p node_modules/pkg; printf bin > node_modules/pkg/bin; ln node_modules/pkg/bin node_modules/pkg/copy'])).exitCode, 0)
    assert.equal(await readlink(join(f.root, 'alias')), 'b')
    assert.notEqual((await lstat(join(f.root, 'node_modules/pkg/bin'))).ino, (await lstat(join(f.root, 'node_modules/pkg/copy'))).ino)
    assert.equal((await f.session.command('/bin/sh', ['-c', 'rm alias; printf regular > alias'])).exitCode, 0)
    assert.equal(await readFile(join(f.root, 'alias'), 'utf8'), 'regular')
    assert.equal((await f.session.command('/bin/sh', ['-c', 'rm alias; ln -s a alias'])).exitCode, 0)
    assert.equal((await f.session.command('/bin/sh', ['-c', 'rm alias'])).exitCode, 0)
    await assert.rejects(lstat(join(f.root, 'alias')), { code: 'ENOENT' })
  } finally { await f.close() }
})

for (const [label, command] of [
  ['absolute', 'ln -s /etc/passwd unsafe'], ['escaping', 'ln -s ../outside unsafe'],
  ['Git metadata', 'ln -s .git/config unsafe'], ['cyclic', 'ln -s second unsafe; ln -s unsafe second'],
  ['linked parent chain', 'mkdir nested; ln -s ../../outside nested/target; ln -s nested/target unsafe']
]) test(`${label} command links cannot publish any staged files`, mac, async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.session.command('/bin/sh', ['-c', `printf ordinary > ordinary.txt; ${command}`]), /link|metadata/i)
    await assert.rejects(lstat(join(f.root, 'ordinary.txt')), { code: 'ENOENT' })
    await assert.rejects(lstat(join(f.root, 'unsafe')), { code: 'ENOENT' })
  } finally { await f.close() }
})

test('interactive publication rejects concurrent live edits before importing generated files', mac, async () => {
  const f = await fixture()
  try {
    await writeFile(join(f.root, 'existing.txt'), 'before')
    let state = await f.session.startCommand('printf ready; read answer; printf command > existing.txt; printf new > new.txt')
    await writeFile(join(f.root, 'existing.txt'), 'user update')
    state = await f.session.inputCommand(state.id, 0, 'continue\r')
    state = await until(() => f.session.readCommand(state.id, 0, 20), value => value.status === 'failed')
    assert.match(state.error!, /conflict|newer/)
    assert.equal(state.publication, 'discarded')
    assert.equal(await readFile(join(f.root, 'existing.txt'), 'utf8'), 'user update')
    await assert.rejects(lstat(join(f.root, 'new.txt')), { code: 'ENOENT' })
  } finally { await f.close() }
})

test('Stop during publication retains applied files and reports a partial checkpoint', mac, async () => {
  const f = await fixture()
  let watcher: ReturnType<typeof watch> | undefined
  try {
    let state = await f.session.startCommand('printf ready; read answer; printf kept > a.txt; /usr/bin/perl -e \'open(my $f, ">", "large.bin") or die; truncate($f, 25000000) or die;\'')
    let stopping: Promise<unknown> | undefined
    watcher = watch(f.root, (_, name) => {
      if (String(name) === 'a.txt' && !stopping) stopping = f.session.stopCommand(state.id)
    })
    state = await f.session.inputCommand(state.id, 0, 'continue\r')
    state = await until(() => f.session.readCommand(state.id, 0, 20), value => value.status === 'stopped')
    await stopping
    assert.equal(state.publication, 'partial')
    assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'kept')
    await assert.rejects(lstat(join(f.root, 'large.bin')), { code: 'ENOENT' })
    assert.ok(f.session.record.report.changes.some(change => change.path === 'a.txt'))
  } finally { watcher?.close(); await f.close() }
})

test('session schemas honor terminal settings and reject another run’s session identifiers', mac, async () => {
  const f = await fixture()
  let registry: Awaited<ReturnType<typeof createToolRegistry>> | undefined
  try {
    let settings = { ...defaultHarnessSettings, terminal: true }
    const options = { workspace: await f.runtime.registry.workspace(f.agent.id), settings, signal: f.controller.signal,
      getSettings: async () => settings, approve: async () => true, onTool: () => {}, repository: {
        signal: f.controller.signal, owner: f.session, previews: f.runtime.previews, authorization: f.runtime.authorization,
        access: () => repositoryAccess(f.runtime.store, join(f.directory, 'profile'), f.agent.id, f.chat.id), userMessages: () => [], requestEntry: () => {} } }
    registry = await createToolRegistry(options)
    assert.ok(registry.definitions.some(tool => tool.name === 'repo_command_start'))
    assert.ok(registry.definitions.some(tool => tool.name === 'repo_preview_start'))
    const state = await f.session.startCommand('read answer')
    const other = new RepositorySession({ ...f.session.record, runId: 'other' }, f.runtime.repositories, f.controller.signal, () => {})
    await assert.rejects(other.readCommand(state.id), /unavailable/)
    settings = { ...settings, terminal: false }
    const denied = await registry.execute({ id: 'disabled-input', name: 'repo_command_input', arguments: JSON.stringify({ session_id: state.id, input_revision: 0, data: 'bad\r' }) })
    assert.equal(denied.success, false); assert.match(denied.output, /no longer permitted/)
    const previewDenied = await registry.execute({ id: 'disabled-preview', name: 'repo_preview_start', arguments: JSON.stringify({ command: 'echo disabled' }) })
    assert.equal(previewDenied.success, false); assert.match(previewDenied.output, /no longer permitted/)
    await registry.close()
    registry = await createToolRegistry({ ...options, settings })
    assert.ok(!registry.definitions.some(tool => tool.name.startsWith('repo_command')))
    assert.ok(!registry.definitions.some(tool => tool.name.startsWith('repo_preview')))
    await f.session.stopCommand(state.id)
  } finally { await registry?.close(); await f.close() }
})

test('terminal output strips split escape sequences and pages a bounded history', () => {
  const output = new TerminalOutput()
  output.append('before\x1b]8;;https://example.test'); output.append('\x07link\x1b]8;;\x1b'); output.append('\\after\x1b[31'); output.append('mred\x1b[0m')
  assert.equal(output.read().output, 'beforelinkafterred')
  output.append('x'.repeat(600_000))
  const page = output.read(0)
  assert.equal(page.truncated, true); assert.equal(page.output.length, 16_000)
  assert.ok(page.offset > 0); assert.equal(output.preview().truncated, true)
})

test('parent death settles both supervisor and PTY groups without replay', mac, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'granite-pty-crash-')))
  const child = spawn(process.execPath, ['--experimental-strip-types', 'tests/fixtures/terminal-parent.ts', root], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let record: ProcessRecord | undefined, ready = false, output = ''
  child.stdout.on('data', chunk => {
    output += chunk.toString()
    for (const line of output.split('\n').slice(0, -1)) {
      const message = JSON.parse(line)
      if (message.record) record = message.record
      if (message.ready) ready = true
    }
  })
  try {
    await until(async () => ready && Boolean(record?.pty), Boolean)
    assert.ok(record!.pty)
    child.kill('SIGKILL')
    await until(async () => processGroup(record!).length, value => value === 0)
  } finally { child.kill('SIGKILL'); await rm(root, { recursive: true, force: true }) }
})
