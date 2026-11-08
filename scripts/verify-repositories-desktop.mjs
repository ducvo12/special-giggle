import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { desktopSession } from './desktop/session.mjs'

const usage = `Usage: node scripts/verify-repositories-desktop.mjs [entry] [--executable <path>] [--packaged]

Without --executable, launch the local Electron binary with entry (default: .).
--executable <path> launches that application binary directly, without an entry.
Example: node scripts/verify-repositories-desktop.mjs --executable "/path/Granite.app/Contents/MacOS/Granite"
--packaged requires --executable <path>; no release bundle is guessed.
Use --help to show this message.`

const args = process.argv.slice(2)

if (args.includes('--help')) {
  console.log(usage)
  process.exit(0)
}

let entry
let executable
let packaged = false

for (let index = 0; index < args.length; index++) {
  const arg = args[index]

  if (arg === '--executable') {
    const path = args[index + 1]

    if (executable || !path || path.startsWith('--')) {
      throw new Error(`Expected one --executable <path>.\n${usage}`)
    }

    executable = path
    index++
    continue
  }

  if (arg === '--packaged') {
    packaged = true
    continue
  }

  if (arg.startsWith('-') || entry) {
    throw new Error(`Unexpected argument: ${arg}\n${usage}`)
  }

  entry = arg
}

if (packaged && !executable) {
  throw new Error(`--packaged requires --executable <path> to the packaged application binary.\n${usage}`)
}

if (entry && executable) {
  throw new Error(`An entry cannot be combined with --executable.\n${usage}`)
}

const directory = await mkdtemp(join(tmpdir(), 'granite-repository-ui-'))
const profile = join(directory, 'profile')
const desktop = desktopSession(profile, 9491, { ELECTRON_RENDERER_URL: '' }, entry ?? '.', executable)
const { evaluate, fill, wait } = desktop
const requests = []
const failures = []
let project
let agent
let sequence = 0
let releaseInteractiveInput
const interactiveOutputInspected = new Promise(resolve => {
  releaseInteractiveInput = resolve
})

const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'repo-ui' }] }))
    return
  }

  let raw = ''

  for await (const chunk of req) {
    raw += chunk
  }

  const body = JSON.parse(raw)
  requests.push(body)
  res.setHeader('Content-Type', 'text/event-stream')

  const event = value => res.write(`data: ${JSON.stringify(value)}\n\n`)
  const text = content => event({ choices: [{ delta: { content }, finish_reason: null }] })

  function answer(content) {
    text(content)
    event({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    res.end('data: [DONE]\n\n')
  }

  function call(name, args) {
    event({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: `ui-${++sequence}`,
            function: { name, arguments: JSON.stringify(args) }
          }]
        },
        finish_reason: null
      }]
    })
    event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    res.end('data: [DONE]\n\n')
  }

  const latestUser = body.messages.findLastIndex(message => message.role === 'user')
  const user = body.messages[latestUser].content
  const outputs = body.messages.slice(latestUser + 1).filter(message => message.role === 'tool')

  if (user === 'Question setup') {
    call('ask_user', {
      questions: [
        { title: 'Which styling should this project use?', options: ['Plain CSS', 'Tailwind'] },
        { title: 'What should the project be called?' }
      ]
    })
    return
  }

  if (user.startsWith('User answer to question')) {
    answer('I will use your selected styling.')
    return
  }

  if (user === 'Check the app') {
    if (!outputs.length) {
      call('repo_preview_start', {
        command: `node -e '
          require("node:http").createServer((q, r) => {
            console.log("request:" + q.url)
            r.end("preview works")
          }).listen(Number(process.env.PORT), process.env.HOST)
        '`
      })
      return
    }

    const state = JSON.parse(outputs.at(-1).content)

    if (state.status === 'ready') {
      answer(`The local preview is ready. [Open the app](${state.url}/manual-link-check)`)
    } else {
      call('repo_preview_read', { preview_id: state.id, wait_ms: 100 })
    }

    return
  }

  if (user === 'Hold repository') {
    text('Holding project reservation')
    return
  }

  if (user === 'Outside edit') {
    if (!outputs.length) {
      call('request_repository_edit', { project_id: project.id })
    } else {
      answer('Move this chat into Website to edit its files.')
    }

    return
  }

  if (user === 'Interactive command') {
    if (!outputs.length) {
      call('repo_command_start', {
        command: 'printf "Project name? "; read name; printf "%s" "$name" > interactive.txt',
        interactive: true
      })
      return
    }

    const state = JSON.parse(outputs.at(-1).content)

    if (state.status === 'complete') {
      answer('The interactive command completed and its changes were applied.')
    } else if (state.inputRevision === 0 && state.output.includes('Project name?')) {
      await interactiveOutputInspected
      call('repo_command_input', { session_id: state.id, input_revision: 0, data: 'demo-project\r' })
    } else {
      call('repo_command_read', { session_id: state.id, offset: 0, wait_ms: 100 })
    }

    return
  }

  if (user === 'Command check') {
    if (!outputs.length) {
      call('repo_command', { command: 'printf generated > generated.txt' })
    } else {
      answer('The check completed and generated.txt was created.')
    }

    return
  }

  if (user === 'Edit repository' || user === 'Crash repository') {
    if (!outputs.length) {
      call('repo_read', { project_id: project.id, path: 'app.txt' })
    } else if (outputs.length === 1) {
      call('repo_edit', {
        path: 'app.txt',
        revision: JSON.parse(outputs[0].content).revision,
        old_string: user === 'Crash repository' ? 'updated' : 'original',
        new_string: user === 'Crash repository' ? 'changed before crash' : 'updated'
      })
    } else if (user === 'Crash repository') {
      call('repo_command', {
        command: 'printf staging > command-only.txt; sleep 20; printf late > never.txt'
      })
    } else {
      answer('Updated app.txt.')
    }

    return
  }

  answer('Queued work finished.')
})

function bridge(expression) {
  return evaluate(`(async () => {
    const result = await (${expression})

    if (result == null) {
      return
    }

    if (!result.ok) {
      throw new Error(result.error)
    }

    return result.value
  })()`)
}

async function click(label) {
  await wait(() => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(button => {
      const text = button.cloneNode(true)
      text.querySelectorAll('.prompt-choice-number').forEach(number => number.remove())

      return button.getAttribute('aria-label') === ${JSON.stringify(label)} ||
        text.textContent.trim().replace(/^■\\s*/, '') === ${JSON.stringify(label)}
    })

    if (!button || button.disabled) {
      return false
    }

    button.click()
    return true
  })()`), `button ${label}`)
}

async function send(text) {
  await fill('textarea[aria-label=Message]', text, 'textarea')
  await click('Send message')
  await wait(() => evaluate(`
    document.querySelector('textarea[aria-label=Message]')?.value === '' &&
    [...document.querySelectorAll('.messages article.user')].at(-1)?.textContent.includes(${JSON.stringify(text)})
  `), 'submitted')
}

function idle(expectAnswer = true) {
  return wait(() => evaluate(`
    document.querySelector('.messages')?.getAttribute('aria-busy') === 'false' &&
    !document.querySelector('.stop-button') &&
    (${!expectAnswer} || [...document.querySelectorAll('.messages article.message')].at(-1)?.classList.contains('assistant'))
  `), 'reply complete')
}

async function shot(name) {
  const image = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(directory, `${name}.png`), Buffer.from(image.data, 'base64'))
}

async function openActivity(title) {
  await wait(() => evaluate(`(() => {
    const toggle = document.querySelector('.activity-toggle')

    if (toggle?.getAttribute('aria-expanded') === 'false') {
      toggle.click()
      return false
    }

    const section = [...document.querySelectorAll('#chat-activity-panel .activity-section')].find(
      section => section.querySelector('.activity-section-label')?.textContent === ${JSON.stringify(title)}
    )
    const button = section?.querySelector('.activity-disclosure')

    if (!button) {
      return false
    }

    if (button.getAttribute('aria-expanded') !== 'true') {
      button.click()
      return false
    }

    return section.querySelector('.activity-section-content')?.getBoundingClientRect().height > 0
  })()`), `open activity ${title}`)
}

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  await desktop.launch()

  // Background windows can throttle animation frames; verify the revealed content directly.
  await desktop.rpc('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })

  const seed = await evaluate(`(async () => {
    function unwrap(result) {
      if (!result.ok) {
        throw new Error(result.error)
      }

      return result.value
    }

    const agent = unwrap(await window.granite.agents.create('Repository demo'))
    const section = unwrap(await window.granite.organization.createSection(agent.id, 'Development', 'shared'))
    const project = unwrap(await window.granite.organization.createProject(agent.id, section.id, 'Website'))

    unwrap(await window.granite.organization.createRepository(agent.id, project.id))
    unwrap(await window.granite.harness.save(agent.id, {
      instructions: '',
      terminal: true,
      approveWrites: true,
      skills: true,
      mcpServers: []
    }))

    const connection = unwrap(await window.granite.connections.save({
      name: 'Fixture',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:${server.address().port}/v1',
      model: 'repo-ui',
      maxConcurrentRequests: 2
    }))

    localStorage.setItem('granite.agent', agent.id)
    localStorage.setItem('granite.connection', connection.id)

    return {
      agent,
      section,
      project: unwrap(await window.granite.organization.get(agent.id)).projects.find(item => item.id === project.id)
    }
  })()`)
  project = seed.project
  agent = seed.agent

  await writeFile(join(project.repositoryPath, 'app.txt'), 'original\n')
  await desktop.rpc('Page.reload')
  await wait(() => evaluate('document.querySelector("textarea[aria-label=Message]")?.disabled === false'), 'composer')

  await click('New chat in Website')
  await send('Edit repository')
  await idle()
  await openActivity('Line changes')
  await wait(() => evaluate(`
    document.querySelector('.activity-line-totals')?.getAttribute('aria-label') === '1 lines added, 1 lines removed' &&
    document.querySelectorAll('.repository-file-change').length === 1
  `), 'one changed file and +1/−1 summary')

  assert.equal(await readFile(join(project.repositoryPath, 'app.txt'), 'utf8'), 'updated\n')
  assert.equal(await evaluate('Boolean(document.querySelector(".approval-panel"))'), false)

  await evaluate('document.querySelector(".repository-file-change > summary").click()')
  await wait(() => evaluate(`(() => {
    const diff = document.querySelector('.repository-file-change pre')

    return diff?.getBoundingClientRect().height > 0 &&
      diff.textContent.includes('-original') &&
      diff.textContent.includes('+updated')
  })()`), 'visible inspectable diff')
  await shot('edit-and-diff')
  console.log('PASS: project reply, implicit editing grant, real file edit and visible +1/−1 diff')

  await click('New chat')
  await send('Outside edit')
  await idle()
  await click('Move into Website…')
  await click('Confirm permanent move')
  await wait(() => evaluate('document.querySelector(".chat-breadcrumb")?.textContent.includes("Website")'), 'permanent project entry')

  const outsideRequest = requests.find(request => request.messages.some(message => message.content === 'Outside edit'))
  assert.ok(!outsideRequest.tools.some(tool => tool.function.name === 'repo_write'))

  await send('Command check')
  await idle()
  assert.equal(await readFile(join(project.repositoryPath, 'generated.txt'), 'utf8'), 'generated')
  await shot('project-entry-and-command')
  console.log('PASS: outside write unavailable, explicit permanent project entry, automatic confined command and imported output')

  await send('Interactive command')
  const commandChatId = await evaluate('localStorage.getItem("granite.conversation." + localStorage.getItem("granite.agent"))')
  await openActivity('Terminal processes')

  try {
    await wait(() => evaluate(`(() => {
      const section = [...document.querySelectorAll('.activity-section')].find(
        section => section.querySelector('.activity-section-label')?.textContent === 'Terminal processes'
      )
      const item = section?.querySelector('.activity-item')

      if (!item) {
        return false
      }

      item.open = true
      const output = item.querySelector('pre[aria-label="Terminal output"]')

      return item.querySelector('.activity-status')?.textContent === 'running' &&
        output?.getBoundingClientRect().height > 0 &&
        output.textContent.includes('Project name?')
    })()`), 'visible running PTY and sanitized prompt output')
    console.log('PASS: visible running PTY status and sanitized prompt output')
  } catch (error) {
    failures.push(error)
    console.error('FAIL: running PTY prompt output was not visible:', error.message)

    await writeFile(join(directory, 'interactive-command-failure.txt'), await evaluate('document.body.innerText'))
    const runningReports = await bridge(`window.granite.repositories.reports(${JSON.stringify(agent.id)}, ${JSON.stringify(commandChatId)})`)
    await writeFile(join(directory, 'interactive-command-reports.json'), JSON.stringify(runningReports, null, 2))
  } finally {
    await shot('interactive-command-output')
    releaseInteractiveInput()
  }

  await idle()
  await wait(() => evaluate(`
    document.querySelector('.messages')?.textContent.includes('The interactive command completed and its changes were applied.')
  `), 'fully revealed interactive reply')

  assert.equal(await readFile(join(project.repositoryPath, 'interactive.txt'), 'utf8'), 'demo-project')

  const commandReports = await bridge(`window.granite.repositories.reports(${JSON.stringify(agent.id)}, ${JSON.stringify(commandChatId)})`)
  const interactiveCommand = commandReports
    .flatMap(report => report.commands ?? [])
    .find(command => command.command.includes('interactive.txt'))

  assert.equal(interactiveCommand?.status, 'complete')
  assert.equal(interactiveCommand.publication, 'applied')
  assert.ok(interactiveCommand.output.includes('Project name?'))

  await wait(() => evaluate(`
    ![...document.querySelectorAll('.activity-section')].find(
      section => section.querySelector('.activity-section-label')?.textContent === 'Terminal processes'
    )?.querySelector('.activity-item')
  `), 'completed command leaves active terminal processes')
  console.log('PASS: real PTY start/input/publication through model, worker and IPC; completed applied report and imported file; completed command removed from active terminal processes')

  await send('Question setup')
  await wait(() => evaluate('Boolean(document.querySelector(".question-panel"))'), 'pending question panel')
  await shot('question-pending')
  await click('Tailwind')
  await wait(() => evaluate(`
    Boolean(document.querySelector('input[aria-label="Your answer: What should the project be called?"]'))
  `), 'next question')
  await fill('input[aria-label="Your answer: What should the project be called?"]', 'Repository demo')
  await click('Submit')
  await idle()
  await wait(() => evaluate('document.querySelector(".messages")?.textContent.includes("I will use your selected styling.")'), 'question answer resumed')

  assert.equal(await evaluate('Boolean(document.querySelector(".question-panel .prompt-choices"))'), false)
  assert.ok(requests.some(request => request.messages.some(message =>
    typeof message.content === 'string' &&
    message.content.startsWith('User answer to question') &&
    message.content.includes('Tailwind') &&
    message.content.includes('Repository demo')
  )), 'selected and free-text answers reached the resumed model request')

  await send('Check the app')
  await idle()
  await openActivity('Running apps')
  await wait(() => evaluate(`
    [...document.querySelectorAll('.activity-section')].find(
      section => section.querySelector('.activity-section-label')?.textContent === 'Running apps'
    )?.querySelector('.activity-item .activity-status')?.textContent === 'Running'
  `), 'agent-chosen ready preview without approval')

  assert.equal(await evaluate('Boolean(document.querySelector(".approval-panel"))'), false)

  await evaluate(`(() => {
    const section = [...document.querySelectorAll('.activity-section')].find(
      section => section.querySelector('.activity-section-label')?.textContent === 'Running apps'
    )
    const disclosure = section.querySelector('.activity-disclosure')

    if (disclosure.getAttribute('aria-expanded') !== 'true') {
      disclosure.click()
    }

    section.querySelector('.activity-item').open = true
  })()`)
  await shot('managed-preview')
  await wait(() => evaluate(`
    Boolean([...document.querySelectorAll('.formatted-response a')].find(link => link.textContent === 'Open the app'))
  `), 'chat preview link')

  const previewChatId = await evaluate('localStorage.getItem("granite.conversation." + localStorage.getItem("granite.agent"))')
  const pageUrl = await evaluate('window.location.href')

  await evaluate(`
    [...document.querySelectorAll('.formatted-response a')].find(link => link.textContent === 'Open the app').click()
  `)
  await wait(async () => {
    const previews = await bridge(`window.granite.previews.list(${JSON.stringify(agent.id)}, ${JSON.stringify(previewChatId)})`)
    return previews?.some(preview => preview.output.includes('request:/manual-link-check'))
  }, 'chat link opened in system browser')

  assert.equal(await evaluate('window.location.href'), pageUrl, 'link never navigates Granite to external content')
  console.log('PASS: the Markdown preview link opens the system browser and reaches the preview route; Granite stays on its own page')

  await evaluate(`(() => {
    const section = [...document.querySelectorAll('.activity-section')].find(
      section => section.querySelector('.activity-section-label')?.textContent === 'Running apps'
    )
    const button = [...section.querySelectorAll('.preview-actions button')].find(button => button.textContent === 'Stop')

    if (!button || button.disabled) {
      throw new Error('Preview Stop unavailable')
    }

    button.click()
  })()`)
  await wait(async () => {
    const previews = await bridge(`window.granite.previews.list(${JSON.stringify(agent.id)}, ${JSON.stringify(previewChatId)})`)

    return previews?.some(preview => preview.status === 'stopped') && await evaluate(`
      ![...document.querySelectorAll('.activity-section')].find(
        section => section.querySelector('.activity-section-label')?.textContent === 'Running apps'
      )?.querySelector('.activity-item')
    `)
  }, 'explicit preview stop and removal from running apps')
  console.log('PASS: question options/free-text UI resumes the same task; ready local preview survives reply and explicit Stop cleans it')

  await click('New chat in Website')
  await send('Hold repository')
  await wait(async () => {
    const holdingRequest = requests.some(request =>
      request.messages.at(-1)?.role === 'user' &&
      request.messages.at(-1).content === 'Hold repository'
    )

    return holdingRequest && await evaluate(`
      document.querySelector('.messages')?.getAttribute('aria-busy') === 'true' &&
      Boolean(document.querySelector('.stop-button'))
    `)
  }, 'dispatched live run holding the project reservation')

  await click('New chat in Website')
  await send('Queued repository')
  await wait(() => evaluate('document.querySelector(".run-status-bar")?.textContent.includes("Queued for repository project")'), 'project queue')
  await shot('project-queue')

  await click('Hold repository')
  await click('Stop')
  await idle(false)
  await click('Queued repository')
  await idle()
  console.log('PASS: project queue is visible and starts after Stop releases the reservation')

  await click('New chat in Website')
  await send('Crash repository')

  const electron = './node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
  let pending

  await wait(() => {
    const raw = execFileSync(electron, [
      '-e',
      `
        const Database = require('better-sqlite3')
        const db = new Database(process.argv[1], { readonly: true })
        const row = db.prepare('SELECT data FROM repository_runs ORDER BY rowid DESC LIMIT 1').get()
        console.log(row?.data ?? 'null')
        db.close()
      `,
      join(profile, 'atlas.sqlite')
    ], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'ignore']
    })
    pending = JSON.parse(raw)?.pending
    return Boolean(pending?.process && pending?.workspace)
  }, 'durable command process')

  assert.equal(await readFile(join(project.repositoryPath, 'app.txt'), 'utf8'), 'changed before crash\n')

  const worker = Number(execFileSync('/bin/ps', [
    '-p', String(pending.process.pid), '-o', 'ppid='
  ], { encoding: 'utf8' }).trim())
  assert.ok(worker > 1 && worker !== process.pid)

  const command = execFileSync('/bin/ps', [
    '-p', String(worker), '-o', 'command='
  ], { encoding: 'utf8' })
  assert.match(command, /Granite|Electron|Helper/)

  const count = requests.length
  process.kill(worker, 'SIGKILL')
  await wait(() => evaluate('Boolean(document.querySelector(".recovery-dialog"))'), 'worker crash recovery popup')

  assert.equal(requests.length, count, 'recovery does not dispatch another model request')
  await click('OK')
  assert.equal(await readFile(join(project.repositoryPath, 'app.txt'), 'utf8'), 'changed before crash\n')
  await assert.rejects(lstat(join(project.repositoryPath, 'command-only.txt')), { code: 'ENOENT' })
  await assert.rejects(lstat(join(project.repositoryPath, 'never.txt')), { code: 'ENOENT' })
  await shot('recovered-kept-changes')
  console.log('PASS: real worker crash, owned command settlement, recovery popup, completed native edit kept, unfinished command copy not imported, no replay')

  if (failures.length) {
    throw new AggregateError(failures, 'Repository desktop verification has failed assertions; see evidence.')
  }
} catch (error) {
  try {
    await writeFile(join(directory, 'failure.txt'), await evaluate('document.body.innerText'))
    await shot('failure')
  } catch (diagnosticError) {
    console.error('Could not capture failure evidence:', diagnosticError)
  }

  throw error
} finally {
  try {
    await writeFile(join(directory, 'requests.json'), JSON.stringify(requests, null, 2))
    console.log(`Evidence: ${directory}`)
  } finally {
    try {
      await desktop.quit()
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
}
