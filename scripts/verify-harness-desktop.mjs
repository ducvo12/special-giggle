import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { desktopSession } from './desktop/session.mjs'

const directory = await mkdtemp(join(tmpdir(), 'granite-harness-ui-'))

const { launch, quit, rpc, evaluate, click, fill, wait } = desktopSession(directory, 9443)

let number = 0

const requests = []

const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'harness-mock' }] }))

    return
  }

  let raw = ''

  for await (const chunk of req) {
    raw += chunk
  }

  const body = JSON.parse(raw)
  requests.push(body)
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const event = value => res.write(`data: ${JSON.stringify(value)}\n\n`)
  const output =
    body.input.at(-1)?.type === 'function_call_output'
      ? [
          {
            type: 'message',
            role: 'assistant',
            id: 'answer-' + ++number,
            content: [{ type: 'output_text', text: body.input.at(-1).output }]
          }
        ]
      : [
          {
            type: 'reasoning',
            id: 'reason-' + ++number,
            encrypted_content: 'opaque-context',
            summary: []
          },
          {
            type: 'function_call',
            id: 'item-' + number,
            call_id: 'call-' + number,
            namespace: 'granite',
            name: 'write_file',
            arguments: JSON.stringify({
              file_path: '/notes/harness-ui.md',
              content: 'Granite owns this tool execution.'
            })
          }
        ]

  if (output[0].type === 'message') {
    event({ type: 'response.output_text.delta', delta: output[0].content[0].text })
  }

  event({ type: 'response.completed', response: { status: 'completed', output } })
  res.end()
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

async function selectLabel(label, value) {
  const selector = await evaluate(`(() => {
    const element = [...document.querySelectorAll('label')].find(item => item.firstChild.textContent.trim() === ${JSON.stringify(label)})?.querySelector('select');
    if (!element) throw new Error('Control not found: ' + ${JSON.stringify(label)});
    element.dataset.testControl = ${JSON.stringify(label)};
    return '[data-test-control="' + ${JSON.stringify(label)} + '"]';
  })()`)
  await fill(selector, value, 'select')
}

try {
  await launch()
  await click('Create agent')
  await fill('input[aria-label="Agent name"]', 'Harness test')
  await click('Create agent')
  await wait(
    () => evaluate('Boolean(document.querySelector(".identity-editor"))'),
    'identity draft'
  )
  await click('Save and continue')
  await wait(() => evaluate('Boolean(document.querySelector(".chat-main"))'), 'identity saved')
  await click('⌘ Tools & skills')
  await wait(
    () => evaluate('Boolean(document.querySelector(".harness-settings fieldset:not(:disabled)"))'),
    'agent tools loaded'
  )
  await evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find(item => item.textContent.includes('Ask before each workspace file change'));
    label.querySelector('input').click();
  })()`)
  await click('Save agent tools')
  await wait(
    () => evaluate('document.querySelector("[role=status]")?.textContent.includes("saved")'),
    'tools saved'
  )
  await fill('input[placeholder="research-notes"]', 'careful-notes')
  await fill(
    '.skills-editor textarea',
    '# Careful notes\nRead existing files before making changes.',
    'textarea'
  )
  await click('Save skill')
  await wait(
    () =>
      evaluate(
        'document.querySelector(".skills-editor [role=status]")?.textContent.includes("Skill saved")'
      ),
    'skill saved'
  )
  await click('Back to chat')
  await click('Connect model')
  await click('+ Add connection')
  await selectLabel('Connection type', 'chatgpt')
  await wait(
    () =>
      evaluate(
        'Boolean([...document.querySelectorAll("button")].find(item => item.textContent.trim() === "Continue with ChatGPT"))'
      ),
    'direct ChatGPT connection UI'
  )
  assert.equal(await evaluate('typeof window.granite.codex'), 'undefined')
  await selectLabel('Connection type', 'openai')
  await selectLabel('API protocol', 'responses')
  await fill('input[placeholder="Home desktop"]', 'Direct harness test')
  await fill('input[type=url]', `http://127.0.0.1:${server.address().port}/v1`)
  await click('Load models')
  await wait(
    () =>
      evaluate('document.querySelector("input[list=available-models]")?.value === "harness-mock"'),
    'model loaded'
  )
  await click('Save connection')
  await wait(
    () => evaluate('Boolean(document.querySelector(".connection-card"))'),
    'connection saved'
  )
  await click('Back to chat')
  await fill('textarea[aria-label="Message"]', 'Save a note', 'textarea')
  await click('Send ↗')
  await wait(
    () => evaluate('Boolean(document.querySelector("[role=alertdialog]"))'),
    'Granite approval shown'
  )
  const agent = (await evaluate('window.granite.agents.list()')).value[0]
  await assert.rejects(readFile(join(directory, 'agents', agent.id, 'notes/harness-ui.md')), {
    code: 'ENOENT'
  })
  const screenshot = await rpc('Page.captureScreenshot', { format: 'png' })
  await writeFile(
    '/private/tmp/granite-harness-approval.png',
    Buffer.from(screenshot.data, 'base64')
  )
  await click('Deny')
  await wait(() => evaluate('!document.querySelector(".stop-button")'), 'denied action finished')
  assert.match(
    await evaluate('document.querySelector(".assistant")?.textContent'),
    /Permission denied/
  )
  await assert.rejects(readFile(join(directory, 'agents', agent.id, 'notes/harness-ui.md')), {
    code: 'ENOENT'
  })
  await fill('textarea[aria-label="Message"]', 'Try writing now', 'textarea')
  await click('Send ↗')
  await wait(
    () => evaluate('Boolean(document.querySelector("[role=alertdialog]"))'),
    'new approval'
  )
  await click('Allow once')
  await wait(() => evaluate('!document.querySelector(".stop-button")'), 'approved action finished')
  assert.match(
    await readFile(join(directory, 'agents', agent.id, 'notes/harness-ui.md'), 'utf8'),
    /Granite owns/
  )
  await fill('textarea[aria-label="Message"]', 'Wait for approval', 'textarea')
  await click('Send ↗')
  await wait(
    () => evaluate('Boolean(document.querySelector("[role=alertdialog]"))'),
    'pending approval'
  )
  await click('Stop agent')
  await wait(
    () =>
      evaluate(
        '!document.querySelector("[role=alertdialog]") && !document.querySelector(".stop-button")'
      ),
    'stopped during approval'
  )
  await quit()
  await launch()
  await wait(
    () => evaluate('Boolean(document.querySelector(".assistant"))'),
    'conversation recovered'
  )
  assert.equal(
    (await evaluate(`window.granite.harness.get(${JSON.stringify(agent.id)})`)).value.approveWrites,
    true
  )
  assert.equal(
    (await evaluate(`window.granite.harness.skills(${JSON.stringify(agent.id)})`)).value[0].name,
    'careful-notes'
  )
  assert.ok(requests.every(request => request.store === false && request.stream === true))
  console.log(
    'PASS: own harness setup, direct connection UI, agent settings, skills, approval denial/allow, Stop, and restart persistence.'
  )
} finally {
  await quit()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
