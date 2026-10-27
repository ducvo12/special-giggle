import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, realpath, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!process.versions.electron) {
  const result = spawnSync(createRequire(import.meta.url)('electron'), ['--experimental-strip-types', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  process.exit(result.status ?? 1)
}
const { AgentRuntime } = await import('../src/backend/agents/runtime.ts')
const { RepositorySession } = await import('../src/backend/repositories/session.ts')
const framework = process.argv[2] ?? 'vite'
const version = process.argv[3] ?? 'latest'
if (!/^(?:latest|[0-9]+\.[0-9]+\.[0-9]+)$/.test(version)) throw new Error('Use latest or an exact scaffold version.')
if (!['vite', 'next'].includes(framework)) throw new Error('Choose vite or next.')
const directory = await realpath(await mkdtemp(join(tmpdir(), `granite-${framework}-setup-`)))
const root = join(directory, 'repository'), runtime = await AgentRuntime.open(join(directory, 'profile'))
let session
try {
  await mkdir(root)
  const agent = await runtime.createAgent('Setup verification'), section = await runtime.createSection(agent.id, 'Code', 'shared')
  const project = await runtime.createProject(agent.id, section.id, 'Disposable setup')
  await runtime.attachRepository(agent.id, project.id, root)
  const chat = await runtime.createConversation(agent.id, { sectionId: section.id, projectId: project.id })
  const record = { runId: `${framework}-setup`, agentId: agent.id, conversationId: chat.id, projectId: project.id, root,
    baseline: {}, touched: [], report: { runId: `${framework}-setup`, projectId: project.id, name: project.name, state: 'active', changes: [], preExisting: 0 } }
  runtime.repositories.save(record)
  session = new RepositorySession(record, runtime.repositories, new AbortController().signal, () => {})
  const commands = framework === 'vite' ? [
    `npm create --yes vite@${version} . -- --template react-ts --no-interactive`,
    'npm install --no-audit --no-fund',
    'npm run build'
  ] : [
    `npx --yes create-next-app@${version} . --ts --eslint --app --src-dir --use-npm --no-tailwind --import-alias "@/*" --disable-git --webpack --yes`,
    'NEXT_TELEMETRY_DISABLED=1 npm run build'
  ]
  console.log(JSON.stringify({ framework, directory, commands }))
  for (const command of commands) {
    console.log(`START ${command}`)
    let state = await session.startCommand(command, '', true, false)
    let offset = 0
    do {
      state = await session.readCommand(state.id, offset, 1000)
      if (state.output) process.stdout.write(state.output)
      offset = state.nextOffset
    } while (['starting', 'running', 'publishing'].includes(state.status))
    assert.equal(state.status, 'complete', JSON.stringify(state))
    assert.equal(state.exitCode, 0, JSON.stringify(state)); assert.equal(state.publication, 'applied')
    assert.notEqual(record.report.state, 'attention', record.report.error)
    console.log(`PASS ${command}`)
  }
  const previewCommand = framework === 'vite'
    ? 'npm run preview -- --host "$HOST" --port "$PORT" --strictPort'
    : 'npm run start -- --hostname "$HOST" --port "$PORT"'
  let preview = await runtime.previews.start(record, previewCommand, '', 0, new AbortController().signal)
  for (let attempt = 0; preview.status === 'starting' && attempt < 120; attempt++) preview = await runtime.previews.read(agent.id, chat.id, preview.id, 500)
  assert.equal(preview.status, 'ready', JSON.stringify(preview))
  assert.equal((await fetch(preview.url)).status, 200)
  console.log(JSON.stringify({ framework, preview: { status: preview.status, revision: preview.revision, output: preview.output }, result: 'preview passed' }))
  await runtime.previews.stop(agent.id, chat.id, preview.id)
  const packageData = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.ok((await readdir(join(root, framework === 'vite' ? 'dist' : '.next'))).length)
  assert.ok(record.report.changes.some(change => change.symbolicLink), 'installed executable links were published')
  console.log(JSON.stringify({ framework, dependencies: packageData.dependencies, devDependencies: packageData.devDependencies,
    changedItems: record.report.changes.length, links: record.report.changes.filter(change => change.symbolicLink).length, result: 'passed' }))
} finally {
  await session?.close(); await runtime.stopAll(); runtime.close()
  await rm(directory, { recursive: true, force: true })
}
