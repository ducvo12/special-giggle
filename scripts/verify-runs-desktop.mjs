import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopSession } from './desktop/session.mjs'

// A small launch/IPC/UI smoke check. Uses a disposable profile and no real model.
const directory = await mkdtemp(join(tmpdir(), 'granite-runs-ui-'))
let held
const requests = []
function answer(response, text) {
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`)
  response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
  response.end('data: [DONE]\n\n')
}
const server = createServer(async (request, response) => {
  if (request.url === '/v1/models') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'run-smoke' }] }))
    return
  }
  let raw = ''
  for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw)
  requests.push(body)
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const users = body.messages.filter(message => message.role === 'user').map(message => message.content)
  if (users.at(-1) === 'Keep working') {
    held = response
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Working provisionally' }, finish_reason: null }] })}\n\n`)
  } else answer(response, `Finished: ${users.join(' | ')}`)
})
const desktop = desktopSession(directory, 9461, { ELECTRON_RENDERER_URL: '' })
const { evaluate, click, fill, wait } = desktop
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  await desktop.launch()
  const seeded = await evaluate(`(async () => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error); return result.value }
    const agent = unwrap(await window.granite.agents.create('Run smoke'))
    const connection = unwrap(await window.granite.connections.save({ name: 'Fixture', apiKey: '',
      baseUrl: 'http://127.0.0.1:${server.address().port}/v1', model: 'run-smoke', maxConcurrentRequests: 1 }))
    localStorage.setItem('granite.agent', agent.id)
    localStorage.setItem('granite.connection', connection.id)
    return { agent, connection }
  })()`)
  await desktop.rpc('Page.reload')
  await wait(() => evaluate('document.querySelector("textarea[aria-label=Message]")?.disabled === false'), 'composer ready')
  await fill('textarea[aria-label=Message]', 'Keep working', 'textarea')
  await click('Send message')
  await wait(() => evaluate('document.querySelector(".messages")?.textContent.includes("Working provisionally")'), 'provisional reply')
  assert.ok(held)
  await click('New chat')
  await wait(() => evaluate('document.querySelector(".chat-heading-status")?.textContent === "Unsaved draft"'), 'draft available during another run')
  await fill('textarea[aria-label=Message]', 'Queued question', 'textarea')
  await click('Send message')
  await wait(() => evaluate('document.querySelector(".run-status-bar")?.textContent.includes("position 1")'), 'live local-model queue position')
  assert.equal(requests.length, 1)
  assert.equal(await evaluate('document.querySelector(".new-chat-button").disabled'), false)
  await click('Keep working')
  await fill('textarea[aria-label=Message]', 'Use the new direction', 'textarea')
  await click('Send update')
  await wait(() => evaluate('document.querySelector(".messages")?.textContent.includes("Finished: Keep working | Use the new direction") && !document.querySelector(".stop-button")'), 'steered reply completes')
  const runs = await evaluate('window.granite.runs.list()')
  assert.equal(runs.ok, true)
  await wait(async () => (await evaluate('window.granite.runs.list()')).value.every(run => run.phase === 'complete'), 'both chats complete')
  assert.equal(requests.length, 3)
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '')
  const screenshot = process.argv.find(value => value.startsWith('--screenshot='))?.slice('--screenshot='.length)
  if (screenshot) {
    const { writeFile } = await import('node:fs/promises')
    const image = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
    await writeFile(screenshot, Buffer.from(image.data, 'base64'))
  }
  console.log('PASS: disposable Electron launch, IPC/worker, provisional reply, independent draft, live model queue, steering and completion; three simulated model requests, no real provider.')
} finally {
  await desktop.quit()
  server.closeAllConnections()
  await new Promise(resolve => server.close(() => resolve()))
  await rm(directory, { recursive: true, force: true })
}
