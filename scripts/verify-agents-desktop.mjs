import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyDeletion } from './desktop/verify-deletion.mjs'
import { desktopSession } from './desktop/session.mjs'

// Acceptance test: agent creation, identity editing, and both introductions go
// through actual React controls. Only connection setup uses the public bridge.
const live = process.argv.includes('--live')

const packaged = process.argv.includes('--packaged')

const offline = process.argv.includes('--offline')

const profile = process.argv
  .find(argument => argument.startsWith('--profile='))
  ?.slice('--profile='.length)

assert.ok(
  !profile || offline,
  '--profile is only supported for the offline check, which requires an empty profile.'
)

const question = 'what is your name and who are you'

const directory = profile ?? (await mkdtemp(join(tmpdir(), 'granite-agents-ui-')))

const answers = {}

let server

let session
async function launch() {
  session = desktopSession(directory, 9442, {}, '.', packaged ? './release/mac-arm64/Granite.app/Contents/MacOS/Granite' : undefined)
  await session.launch()
  // Completed replies can still be revealing text; keep content checks deterministic.
  await session.rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
}
const quit = () => session?.quit()
const rpc = (...args) => session.rpc(...args)
const evaluate = (...args) => session.evaluate(...args)
const click = (...args) => session.click(...args)
const fill = (...args) => session.fill(...args)
const wait = (...args) => session.wait(...args)

async function selectAgent(id) {
  await evaluate('document.querySelector(".agent-dropdown-trigger").click()')
  await evaluate(
    `(() => { const choice = [...document.querySelectorAll('[role="menuitemradio"]')].find(item => item.dataset.agentId === ${JSON.stringify(id)}); if (!choice) throw new Error('Agent missing'); choice.click(); })()`
  )
  await wait(
    () => evaluate(`document.querySelector('.agent-dropdown-trigger').dataset.agentId === ${JSON.stringify(id)} && !document.querySelector('.agent-dropdown-trigger').disabled`),
    'agent switch'
  )
}

async function ask(name) {
  console.log(`START ${name}: ${question}`)
  const start = Date.now()
  const before = await evaluate('document.querySelectorAll(".assistant").length')
  await fill('textarea[aria-label="Message"]', question, 'textarea')
  await click('Send message')
  await wait(
    () =>
      evaluate(
        `!document.querySelector('.stop-button') && document.querySelectorAll('.assistant').length > ${before}`
      ),
    `${name} reply`,
    150_000
  )
  const error = await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""')
  assert.equal(error, '')
  const text = await evaluate(
    'document.querySelector(".assistant:last-of-type > div:last-of-type")?.textContent ?? ""'
  )
  assert.match(text, new RegExp(`\\b${name}\\b`, 'i'))
  assert.match(text, /assistant|agent|help|companion/i)

  if (name === 'Nova') {
    assert.ok(
      (text.match(/\p{Extended_Pictographic}/gu) ?? []).length >= 2,
      'Nova follows the emoji identity'
    )
  }

  answers[name] = { text, elapsedMs: Date.now() - start }
  const screenshot = await rpc('Page.captureScreenshot', { format: 'png' })
  await writeFile(
    `/tmp/granite-agents-${name.toLowerCase()}-${live ? 'live' : 'mock'}.png`,
    Buffer.from(screenshot.data, 'base64')
  )
  console.log('ANSWER', name, JSON.stringify(answers[name]))
}

try {
  if (offline) {
    await verifyDeletion({ directory, launch, quit, evaluate, click, fill, wait, rpc })
  } else {
    let connection

    if (live) {
      assert.ok(
        process.env.GRANITE_MODEL_BASE_URL && process.env.GRANITE_MODEL_ID,
        'Set model URL and ID for a live test'
      )
      connection = {
        name: 'LM Studio acceptance test',
        baseUrl: process.env.GRANITE_MODEL_BASE_URL,
        model: process.env.GRANITE_MODEL_ID,
        apiKey: process.env.GRANITE_MODEL_API_KEY ?? ''
      }
    } else {
      server = createServer(async (request, response) => {
        if (request.url === '/v1/models') {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ data: [{ id: 'mock' }] }))
          return
        }

        let raw = ''

        for await (const chunk of request) {
          raw += chunk
        }

        const body = JSON.parse(raw),
          content = body.messages[0].content
        const system =
          typeof content === 'string' ? content : content.map(block => block.text ?? '').join('')
        const profile = JSON.parse(system.match(/<agent_profile>\n(.*?)\n<\/agent_profile>/s)[1])
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })

        for (const [delta, finish_reason] of [
          [
            {
              role: 'assistant',
              content: `I am ${profile.name}, your personal assistant.${system.includes('at least three friendly emojis') ? ' 🌟 😊 🚀' : ''}`
            },
            null
          ],
          [{}, 'stop']
        ]) {
          response.write(
            `data: ${JSON.stringify({ id: 'test', model: 'mock', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
          )
        }

        response.end('data: [DONE]\n\n')
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      connection = {
        name: 'Mock model',
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        model: 'mock',
        apiKey: ''
      }
    }

    await launch()
    await click('Create agent')
    await fill('input[aria-label="Agent name"]', 'Atlas')
    await evaluate('document.querySelector(".connection-editor button").click()')
    await wait(
      () => evaluate('document.querySelector(".file-preview[aria-busy=false]")?.textContent.includes("This file is empty.")'),
      'first agent'
    )
    const atlasId = await evaluate(
      'document.querySelector(".agent-dropdown-trigger").dataset.agentId'
    )
    assert.equal(await readFile(join(directory, 'agents', atlasId, 'identity.md'), 'utf8'), '')
    await click('New chat')
    const saved = await evaluate(`window.granite.connections.save(${JSON.stringify(connection)})`)
    assert.ok(saved.ok)
    await rpc('Page.reload')
    await wait(
      () => evaluate('document.querySelector("textarea[aria-label=Message]")?.disabled === false'),
      'connection ready'
    )
    await ask('Atlas')
    await evaluate('document.querySelector(".agent-dropdown-trigger").click()')
    await evaluate('document.querySelector(".agent-menu-create").click()')
    await fill('input[aria-label="Agent name"]', 'Nova')
    await evaluate('document.querySelector(".connection-editor button").click()')
    await wait(
      () => evaluate('document.querySelector(".file-preview[aria-busy=false]")?.textContent.includes("This file is empty.")'),
      'new agent identity'
    )
    const identity =
      '# Nova\nYou are Nova, a cheerful, curious personal assistant.\nUse at least three friendly emojis in every response, especially introductions, such as 🌟 😊 🚀.\nBe helpful, honest, and clear. Your name is Nova.\n'
    await click('Edit')
    await fill('textarea[aria-label="Edit identity.md"]', identity, 'textarea')
    await wait(() => evaluate('document.querySelector(".agent-dropdown-trigger").disabled'), 'identity dirty')
    assert.ok(
      await evaluate('document.querySelector(".agent-dropdown-trigger").disabled'),
      'Unsaved identity edits are protected'
    )
    await click('Save')
    await wait(
      () => evaluate('Boolean(document.querySelector(".file-preview[aria-busy=false]")) && !document.querySelector(".agent-dropdown-trigger").disabled'),
      'identity saved'
    )
    const novaId = await evaluate(
      'document.querySelector(".agent-dropdown-trigger").dataset.agentId'
    )
    assert.equal(await readFile(join(directory, 'agents', novaId, 'identity.md'), 'utf8'), identity)
    assert.doesNotMatch(
      await readFile(join(directory, 'agents', atlasId, 'identity.md'), 'utf8'),
      /three friendly emojis/
    )
    await click('New chat')
    assert.equal(
      await evaluate('document.querySelectorAll(".assistant").length'),
      0,
      'Nova starts with its own conversation'
    )
    await ask('Nova')
    await selectAgent(atlasId)
    assert.match(
      await evaluate('document.querySelector(".assistant:last-of-type").textContent'),
      /Atlas/
    )
    assert.doesNotMatch(
      await evaluate('document.querySelector(".assistant:last-of-type").textContent'),
      /Nova/
    )
    await quit()
    await launch()
    await selectAgent(novaId)
    assert.match(
      await evaluate('document.querySelector(".assistant:last-of-type").textContent'),
      /Nova/
    )
    const identityResult = await evaluate(
      `window.granite.workspace.read(${JSON.stringify(novaId)}, '/identity.md')`
    )
    assert.equal(identityResult.value, identity)
    const report = {
      mode: live ? 'live LM Studio' : 'mock',
      packaged,
      question,
      model: connection.model,
      answers,
      passed: true
    }
    await writeFile(
      `/tmp/granite-agents-${live ? 'live' : 'mock'}-results.json`,
      JSON.stringify(report, null, 2)
    )
    console.log(
      'PASS agent creation through UI, persisted identity edits, both introductions, emoji style, separate conversations, agent switching, restart recovery'
    )
  }
} finally {
  await quit()

  server?.closeAllConnections()
  server?.close()
  await new Promise(resolve => setTimeout(resolve, 300))

  if (!profile) {
    await rm(directory, { recursive: true, force: true })
  }
}
