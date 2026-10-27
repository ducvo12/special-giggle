import { app, safeStorage } from 'electron'
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import assert from 'node:assert/strict'

// Launch with Electron (not ELECTRON_RUN_AS_NODE). Use the same application
// name as development for normal OS credential protection. Tokens stay only in
// the account store/connection memory and are never printed or passed to shells.
app.setName('granite')
void app.whenReady().then(async () => {
const { AgentRuntime } = await import('../src/backend/agents/runtime.ts')
const { ChatGPTAccounts } = await import('../src/backend/auth/chatgpt.ts')
let runtime, directory
try {
  let connection
  if (process.env.GRANITE_MODEL_BASE_URL && process.env.GRANITE_MODEL_ID) {
    connection = { baseUrl: process.env.GRANITE_MODEL_BASE_URL, model: process.env.GRANITE_MODEL_ID, apiKey: process.env.GRANITE_MODEL_API_KEY ?? '' }
  } else {
    const profile = process.env.GRANITE_LIVE_PROFILE ?? join(homedir(), 'Library', 'Application Support', 'Granite Development')
    const saved = JSON.parse(await readFile(join(profile, 'connections.json'), 'utf8')).find(item => item.provider === 'chatgpt' && item.accountId)
    if (!saved) throw new Error('No configured ChatGPT account or explicit live endpoint is available.')
    const accounts = new ChatGPTAccounts(profile, { available: () => safeStorage.isEncryptionAvailable(), encrypt: text => safeStorage.encryptString(text), decrypt: data => safeStorage.decryptString(data) })
    const catalog = await accounts.modelCatalog(saved.accountId)
    const selected = catalog.find(model => model.id === saved.model) ?? catalog[0]
    if (!selected) throw new Error('The configured account has no available models.')
    connection = { provider: 'chatgpt', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', model: selected.id, apiKey: await accounts.resolve(saved.accountId) }
  }
  console.log(JSON.stringify({ liveModel: connection.model, protocol: connection.protocol ?? 'chat-completions' }))
  if (process.argv.includes('--probe')) { console.log('PASS: configured live model access'); app.quit() }
  else {
    directory = await mkdtemp(join(tmpdir(), 'granite-project-agent-live-'))
    runtime = await AgentRuntime.open(join(directory, 'profile'))
    const agent = await runtime.createAgent('Setup verification'), section = await runtime.createSection(agent.id, 'Code', 'shared')
    await runtime.saveSettings(agent.id, { instructions: '', terminal: true, approveWrites: false, skills: false, mcpServers: [] })
    for (const scenario of ['supplied', 'underspecified']) {
      const project = await runtime.createProject(agent.id, section.id, scenario)
      const root = join(directory, scenario); await mkdir(root)
      await runtime.attachRepository(agent.id, project.id, root)
      const chat = await runtime.createConversation(agent.id, { sectionId: section.id, projectId: project.id })
      const runId = `live-${scenario}`
      const prompt = scenario === 'supplied'
        ? 'Run npm create --yes vite@9.3.1 . -- --template react-ts --no-interactive in this empty repository, install dependencies and verify a production build. Keep it as a basic template. Defaults are authorized for other routine choices. Do not start a preview.'
        : 'Make this repository a Next.js project. Ask me for the consequential language and styling choices using ask_user before running commands. After I answer, use defaults for other choices, install dependencies and verify a production build. Do not start a preview or deploy.'
      const tools = [], questions = []
      await runtime.run(runId, agent.id, chat.id, connection, prompt, delta => {
        if (delta.tool?.status === 'running') { tools.push(delta.tool.name); console.log('TOOL', scenario, delta.tool.name) }
        if (delta.run?.question && !questions.includes(delta.run.question.id)) {
          const question = delta.run.question; questions.push(question.id)
          console.log('QUESTION', scenario, question.questions.map(item => item.title))
          runtime.answerQuestion(runId, question.id, question.questions.map(() => 'Use TypeScript and plain CSS without Tailwind. Use defaults for the rest and preserve any existing work.'))
        }
        if (delta.approval) {
          console.log('UNEXPECTED_APPROVAL', scenario, delta.approval.title, delta.approval.detail)
          runtime.approvals.answer(runId, delta.approval.id, false)
        }
      })
      const packageData = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
      assert.ok(packageData.scripts.build)
      await readFile(join(root, scenario === 'supplied' ? 'dist/index.html' : '.next/BUILD_ID'))
      if (scenario === 'underspecified') assert.ok(questions.length, 'real model used the question tool')
      const report = runtime.repositories.reports(agent.id, chat.id).at(-1)
      assert.ok(report.commands.some(command => /build/.test(command.command) && command.status === 'complete' && command.exitCode === 0), 'real build completed')
      console.log(JSON.stringify({ scenario, tools, questions: questions.length, dependencies: packageData.dependencies, commands: report.commands.map(command => ({ command: command.command, status: command.status, exitCode: command.exitCode })), result: 'passed' }))
    }
  }
} catch (error) {
  console.error('LIVE_ACCEPTANCE_BLOCKED_OR_FAILED:', error instanceof Error ? error.message : 'Unknown error')
  process.exitCode = 1
} finally {
  await runtime?.stopAll(); runtime?.close()
  if (directory) await rm(directory, { recursive: true, force: true })
  app.quit()
}

}).catch(error => { console.error('LIVE_ACCEPTANCE_BLOCKED_OR_FAILED:', error.message); app.exit(1) })
