import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopSession } from './desktop/session.mjs'

// Run after npm run build. All data and the simulated model stay local to this check.
const directory = await mkdtemp(join(tmpdir(), 'granite-organization-ui-'))
let requests = 0
const server = createServer(async (request, response) => {
  if (request.url === '/v1/models') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'organization-test' }] }))
    return
  }
  let raw = ''
  for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw)
  requests++
  const text = body.messages.findLast(message => message.role === 'user').content
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const chunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
    id: 'test', model: 'organization-test', choices: [{ index: 0, delta, finish_reason }]
  })}\n\n`)
  chunk({ role: 'assistant', content: `Reply to ${text}` })
  chunk({}, 'stop')
  response.end('data: [DONE]\n\n')
})
const desktop = desktopSession(directory, 9459, { ELECTRON_RENDERER_URL: '' })
const { evaluate, click, fill, wait } = desktop

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  await desktop.launch()
  const seeded = await evaluate(`(async () => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error); return result.value }
    const agent = unwrap(await window.granite.agents.create('Organization check'))
    const shared = unwrap(await window.granite.organization.createSection(agent.id, 'Club', 'shared'))
    const closed = unwrap(await window.granite.organization.createSection(agent.id, 'Private', 'closed'))
    const project = unwrap(await window.granite.organization.createProject(agent.id, shared.id, 'Planning'))
    const general = unwrap(await window.granite.organization.get(agent.id)).sections.find(section => section.kind === 'general')
    unwrap(await window.granite.connections.save({ name: 'Local test', baseUrl: 'http://127.0.0.1:${server.address().port}/v1', model: 'organization-test', apiKey: '' }))
    localStorage.setItem('granite.agent', agent.id)
    return { agent, shared, closed, project, general }
  })()`)
  await desktop.rpc('Page.reload')
  await wait(() => evaluate('document.querySelectorAll(".organization-location").length === 4 && !document.querySelector(".new-chat-button").disabled'), 'organization loaded')

  const chats = async () => {
    const result = await evaluate(`window.granite.conversations.list(${JSON.stringify(seeded.agent.id)})`)
    assert.equal(result.ok, true)
    return result.value
  }
  const breadcrumb = () => evaluate('Array.from(document.querySelectorAll(".chat-breadcrumb li")).map(item => item.textContent)')
  async function selectLocation(name) {
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('.organization-location')].find(button => button.firstElementChild.textContent === ${JSON.stringify(name + '/')});
      if (!button || button.disabled) throw new Error('Location unavailable');
      button.click();
    })()`)
    await wait(() => evaluate(`document.querySelector('.chat-breadcrumb')?.textContent.includes(${JSON.stringify(name)}) && document.querySelector('.chat-heading-status')?.textContent === 'Unsaved draft'`), `draft in ${name}`)
  }
  async function submit(text, expectedCount) {
    await fill('textarea[aria-label="Message"]', text, 'textarea')
    await wait(() => evaluate('document.querySelector(".send-button")?.disabled === false'), 'send enabled')
    // Two clicks in the same event turn must still create just one chat/run.
    await evaluate('document.querySelector(".send-button").click(); document.querySelector(".send-button")?.click()')
    await wait(() => evaluate(`!document.querySelector('.stop-button') && document.querySelector('.messages')?.textContent.includes(${JSON.stringify(`Reply to ${text}`)})`), `reply to ${text}`)
    const saved = await chats()
    assert.equal(saved.length, expectedCount)
    assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '')
    return saved.find(chat => chat.title === text)
  }
  async function placement(title) {
    return evaluate(`(() => {
      const button = [...document.querySelectorAll('.conversation-choice')].find(button => button.title === ${JSON.stringify(title)});
      return { section: button?.closest('.organization-section-group')?.getAttribute('aria-label'), project: button?.closest('.organization-project-group')?.getAttribute('aria-label') ?? null };
    })()`)
  }

  assert.deepEqual(await breadcrumb(), ['General', 'New chat'])
  for (let i = 0; i < 5; i++) await click('New chat')
  await fill('textarea[aria-label="Message"]', '   ', 'textarea')
  await evaluate('document.querySelector(".composer").requestSubmit()')
  await click('New chat')
  assert.equal((await chats()).length, 0)
  assert.equal(await evaluate('document.querySelectorAll(".conversation-row").length'), 0)
  await fill('textarea[aria-label="Message"]', 'Unsent draft', 'textarea')
  await selectLocation('Club')
  await selectLocation('Planning')
  assert.deepEqual(await breadcrumb(), ['Club', 'Planning', 'New chat'])
  assert.equal((await chats()).length, 0)
  await click('New chat')
  assert.deepEqual(await breadcrumb(), ['General', 'New chat'])

  const generalChat = await submit('General hello', 1)
  assert.equal(generalChat.sectionId, seeded.general.id)
  assert.equal(generalChat.projectId, null)
  assert.deepEqual(await placement('General hello'), { section: 'General', project: null })
  assert.equal(await evaluate('document.querySelectorAll(".organization-location.selected").length'), 0)
  await selectLocation('Club')
  const sectionChat = await submit('Club hello', 2)
  assert.equal(sectionChat.sectionId, seeded.shared.id)
  assert.equal(sectionChat.projectId, null)
  assert.deepEqual(await placement('Club hello'), { section: 'Club', project: null })
  await selectLocation('Planning')
  const projectChat = await submit('Project hello', 3)
  assert.equal(projectChat.sectionId, seeded.shared.id)
  assert.equal(projectChat.projectId, seeded.project.id)
  assert.deepEqual(await placement('Project hello'), { section: 'Club', project: 'Planning' })
  assert.deepEqual(await breadcrumb(), ['Club', 'Planning', 'Project hello'])
  assert.equal(requests, 3)
  assert.equal(await evaluate('document.querySelectorAll(".conversation-row.selected").length'), 1)
  assert.equal(await evaluate('document.querySelectorAll(".organization-location.selected, .organization-location[aria-current]").length'), 0)

  await click('General hello')
  await wait(() => evaluate('document.querySelector(".chat-breadcrumb")?.textContent.includes("General hello")'), 'saved chat opened')
  await click('Options for General hello')
  await click('Move chat…')
  await fill('#chat-destination', JSON.stringify({ sectionId: seeded.shared.id, projectId: seeded.project.id }), 'select')
  await click('Move')
  await wait(() => evaluate('!document.querySelector(".chat-context-menu") && document.querySelector(".chat-breadcrumb")?.textContent.includes("Planning")'), 'chat moved')
  assert.deepEqual(await placement('General hello'), { section: 'Club', project: 'Planning' })
  assert.deepEqual(await breadcrumb(), ['Club', 'Planning', 'General hello'])
  assert.equal((await chats()).length, 3)

  // The explorer replaces the old navigation and opens files in preview first.
  assert.equal(await evaluate('document.querySelectorAll(".sidebar .nav-item").length'), 0)
  await evaluate(`document.querySelector('.tree-file[title="identity.md"]').click()`)
  await wait(() => evaluate('Boolean(document.querySelector(".file-preview")) && !document.querySelector(".file-preview").getAttribute("aria-busy").includes("true")'), 'identity preview')
  assert.equal(await evaluate('Boolean(document.querySelector(".file-editor"))'), false)
  await click('Edit')
  await fill('.file-editor', '# Organization check\nBe concise.', 'textarea')
  await wait(() => evaluate('document.querySelector(".new-chat-button").disabled'), 'unsaved file protects navigation')
  await click('Save')
  await wait(() => evaluate('Boolean(document.querySelector(".file-preview h1"))'), 'identity rendered as Markdown')
  const identity = await evaluate(`window.granite.workspace.read(${JSON.stringify(seeded.agent.id)}, '/identity.md')`)
  assert.equal(identity.value, '# Organization check\nBe concise.')

  await evaluate(`document.querySelector('.tree-file[title="memory.md"]').click()`)
  await wait(() => evaluate('document.querySelector(".file-breadcrumb")?.textContent.includes("memory.md") && document.querySelector(".file-preview")?.getAttribute("aria-busy") === "false"'), 'memory preview')
  const memory = await evaluate(`window.granite.workspace.read(${JSON.stringify(seeded.agent.id)}, '/memory.md')`)
  await click('Edit')
  await fill('.file-editor', '# My unsaved draft', 'textarea')
  const external = await evaluate(`window.granite.workspace.save(${JSON.stringify(seeded.agent.id)}, '/memory.md', '# External update', ${JSON.stringify(memory.value)})`)
  assert.equal(external.ok, true)
  await click('Save')
  await wait(() => evaluate('document.querySelector("[role=alert]")?.textContent.includes("changed")'), 'conflicting edit rejected')
  assert.equal(await evaluate('document.querySelector(".file-editor").value'), '# My unsaved draft')
  await click('Discard draft and reload')
  await wait(() => evaluate('document.querySelector(".file-preview h1")?.textContent === "External update"'), 'external update loaded')

  await click('New note')
  await fill('input[aria-label="Note name"]', 'Research')
  await click('Create')
  await wait(() => evaluate('document.querySelector(".file-breadcrumb")?.textContent.includes("notes/Research.md") && Boolean(document.querySelector(".file-preview h1"))'), 'note created and previewed')
  await click('Edit')
  await fill('.file-editor', '# Research\n\nA saved note.', 'textarea')
  await click('Save')
  await wait(() => evaluate('document.querySelector(".file-preview")?.textContent.includes("A saved note.")'), 'note saved')
  assert.ok(await evaluate('Boolean(document.querySelector(".notes-tree .tree-file.selected"))'))

  await click('Options for note Research.md')
  await click('Rename note')
  await fill('input[aria-label="Note name"]', 'Research methods')
  await click('Rename')
  await wait(() => evaluate('document.querySelector(".file-breadcrumb")?.textContent.includes("notes/Research methods.md") && !document.querySelector(".tree-dialog")'), 'open note follows its new name')
  const renamedNote = await evaluate(`window.granite.workspace.read(${JSON.stringify(seeded.agent.id)}, '/notes/Research methods.md')`)
  assert.equal(renamedNote.value, '# Research\n\nA saved note.')
  assert.equal(await evaluate(`Boolean(document.querySelector('.notes-tree .tree-file[title="/notes/Research.md"]'))`), false)
  const occupiedNote = await evaluate(`window.granite.workspace.save(${JSON.stringify(seeded.agent.id)}, '/notes/Existing.md', 'Do not replace', null)`)
  assert.equal(occupiedNote.ok, true)
  await click('Options for note Research methods.md')
  await click('Rename note')
  await fill('input[aria-label="Note name"]', 'Existing')
  await click('Rename')
  await wait(() => evaluate('document.querySelector(".tree-dialog [role=alert]")?.textContent.includes("already exists")'), 'duplicate note name rejected')
  await click('Cancel')
  await click('Edit')
  await fill('.file-editor', '# Research\n\nStill editable after renaming.', 'textarea')
  await click('Save')
  await wait(() => evaluate('document.querySelector(".file-preview")?.textContent.includes("Still editable after renaming.")'), 'renamed note remains editable')

  async function checkRowSurface(selector, hovered = false) {
    if (hovered) {
      const position = await evaluate(`(() => {
        const row = document.querySelector(${JSON.stringify(selector)});
        row.scrollIntoView({ block: 'nearest' });
        const rect = row.querySelector('button:last-child')?.getBoundingClientRect() ?? row.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`)
      await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position })
    }
    const state = await evaluate(`(() => {
      const row = document.querySelector(${JSON.stringify(selector)});
      const sample = document.createElement('span');
      sample.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--surface-hover');
      document.body.append(sample);
      const expected = getComputedStyle(sample).backgroundColor;
      sample.remove();
      const rect = row.getBoundingClientRect();
      return {
        highlighted: getComputedStyle(row).backgroundColor === expected,
        controlsShareSurface: [...row.querySelectorAll('button')].every(button => getComputedStyle(button).backgroundColor === 'rgba(0, 0, 0, 0)'),
        controlsInsideRow: [...row.querySelectorAll('button')].every(button => {
          const buttonRect = button.getBoundingClientRect();
          return buttonRect.left >= rect.left && buttonRect.right <= rect.right && buttonRect.top >= rect.top && buttonRect.bottom <= rect.bottom;
        })
      };
    })()`)
    assert.deepEqual(state, { highlighted: true, controlsShareSurface: true, controlsInsideRow: true }, selector)
  }
  await checkRowSurface('.note-row:has(> .tree-file.selected)')
  for (const selector of [
    '.agent-tree-header', '.sections-tree-header', '.notes-tree > .tree-row',
    '.organization-section-group[aria-label=General] > .tree-row',
    '.organization-project-group[aria-label=Planning] > .tree-row'
  ]) await checkRowSurface(selector, true)
  await desktop.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 650, y: 100 })
  await click('General hello')
  await wait(() => evaluate('document.querySelector(".conversation-row.selected .conversation-choice")?.title === "General hello"'), 'saved chat selection')
  await evaluate('document.querySelector(".conversation-row.selected .conversation-choice").focus()')
  await checkRowSurface('.conversation-row.selected')
  assert.equal(await evaluate('document.querySelectorAll(".organization-location.selected, .organization-location[aria-current]").length'), 0)
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.organization-section-group > .tree-row, .organization-project-group > .tree-row'))
    .every(row => getComputedStyle(row).backgroundColor === 'rgba(0, 0, 0, 0)')`), true)

  // Plus controls create children through small dialogs.
  await click('New section')
  await fill('input[aria-label="New section name"]', 'Alpha')
  await fill('select[aria-label="Section memory"]', 'closed', 'select')
  await click('Create')
  await wait(() => evaluate('document.querySelectorAll(".organization-section-group").length === 4 && !document.querySelector(".tree-dialog")'), 'section created')
  await click('Options for section Alpha')
  await click('Section settings')
  await fill('input[aria-label="Section settings name"]', 'Zeta')
  await click('Save name')
  await wait(() => evaluate('Boolean(document.querySelector(".organization-section-group[aria-label=Zeta]")) && !document.querySelector(".tree-dialog")'), 'section renamed')
  await click('Options for section Zeta')
  await click('Section settings')
  await click('Make section Shared')
  await wait(() => evaluate('!document.querySelector(".tree-dialog") && !document.querySelector(".organization-section-group[aria-label=Zeta] .organization-mode")'), 'section shared')
  await click('Add to Club')
  await click('New project')
  assert.equal(await evaluate(`document.querySelector('input[aria-label="New project name"]').value`), '')
  await fill('input[aria-label="New project name"]', 'Planning two')
  await click('Create')
  await wait(() => evaluate(`Boolean(document.querySelector('.organization-project-group[aria-label="Planning two"]')) && !document.querySelector('.tree-dialog')`), 'project created')
  await click('Options for project Planning two')
  await click('Project settings')
  assert.ok(await evaluate('Array.from(document.querySelectorAll(".tree-dialog button")).some(button => button.textContent === "Link repository folder")'))
  await click('Cancel')

  async function chooseSort(menu, choice) { await click(menu); await click(choice) }
  const sectionOrder = () => evaluate('Array.from(document.querySelectorAll(".organization-section-group")).map(section => section.getAttribute("aria-label"))')
  await chooseSort('Sections options', 'Alphabetical order')
  await chooseSort('Sections options', 'Ascending')
  assert.deepEqual(await sectionOrder(), ['Club', 'General', 'Private', 'Zeta'])
  await chooseSort('Sections options', 'Descending')
  assert.deepEqual(await sectionOrder(), ['Zeta', 'Private', 'General', 'Club'])
  await chooseSort('Sections options', 'Most recently made')
  const layout = await evaluate(`window.granite.organization.get(${JSON.stringify(seeded.agent.id)})`)
  assert.equal(layout.ok, true)
  const creationDates = new Map(layout.value.sections.map(section => [section.name, section.createdAt]))
  function assertCreationOrder(names, direction) {
    // Multiple sections can be created in the same millisecond. Their tie
    // order is alphabetical, rather than necessarily the order of IPC calls.
    for (let index = 1; index < names.length; index++) {
      const before = creationDates.get(names[index - 1]), after = creationDates.get(names[index])
      assert.ok(direction === 'desc' ? before >= after : before <= after)
    }
  }
  assertCreationOrder(await sectionOrder(), 'desc')
  await chooseSort('Sections options', 'Ascending')
  assertCreationOrder(await sectionOrder(), 'asc')
  await chooseSort('Sections options', 'Most recently chatted')
  await chooseSort('Sections options', 'Descending')
  assert.equal((await sectionOrder())[0], 'Club')
  await chooseSort('Options for project Planning', 'Alphabetical order')
  await chooseSort('Options for project Planning', 'Ascending')
  const projectChatOrder = () => evaluate('Array.from(document.querySelectorAll(".organization-project-group[aria-label=Planning] .conversation-choice")).map(button => button.title)')
  assert.deepEqual(await projectChatOrder(), ['General hello', 'Project hello'])
  await chooseSort('Options for project Planning', 'Descending')
  assert.deepEqual(await projectChatOrder(), ['Project hello', 'General hello'])

  const origin = await evaluate('performance.timeOrigin')
  await desktop.rpc('Page.reload')
  await wait(() => evaluate(`performance.timeOrigin !== ${origin} && document.querySelector('.agent-dropdown-trigger')?.disabled === false && document.querySelectorAll('.organization-section-group').length === 4`), 'reload with saved sort preferences')
  assert.equal((await sectionOrder())[0], 'Club')
  assert.deepEqual(await projectChatOrder(), ['Project hello', 'General hello'])
  await click('Options for project Planning')
  assert.equal(await evaluate('document.querySelector(".tree-menu button[aria-checked=true]")?.textContent.includes("Alphabetical order")'), true)
  await desktop.rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })

  // Agent creation leads to the same generic file viewer, and the header switches agents.
  await click('Create agent')
  await fill('input[aria-label="Agent name"]', 'Another agent')
  await evaluate('document.querySelector(".connection-editor button").click()')
  await wait(() => evaluate('document.querySelector(".file-breadcrumb")?.textContent.includes("Another agent / identity.md")'), 'new agent file preview')
  await click('Active agent')
  await evaluate(`document.querySelector('[role=menuitemradio][data-agent-id=${JSON.stringify(seeded.agent.id)}]').click()`)
  await wait(() => evaluate(`document.querySelector('.agent-dropdown-trigger')?.dataset.agentId === ${JSON.stringify(seeded.agent.id)} && !document.querySelector('.agent-dropdown-trigger').disabled`), 'agent switched')
  await click('Settings')
  await wait(() => evaluate('Boolean(document.querySelector(".settings-main"))'), 'settings reachable')
  await click('New chat')
  await selectLocation('Planning')

  const screenshot = process.argv.find(argument => argument.startsWith('--screenshot='))?.slice('--screenshot='.length)
  if (screenshot) {
    const captured = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
    await writeFile(screenshot, Buffer.from(captured.data, 'base64'))
    await desktop.rpc('Emulation.setDeviceMetricsOverride', { width: 760, height: 640, deviceScaleFactor: 1, mobile: false })
    await evaluate(`document.querySelector('.tree-file[title="memory.md"]').click()`)
    await wait(() => evaluate('document.querySelector(".file-preview")?.getAttribute("aria-busy") === "false"'), 'narrow file preview')
    await click('Edit')
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
    assert.equal(await evaluate('document.querySelector(".file-editor").getBoundingClientRect().height > 400'), true)
    const narrow = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
    await writeFile(screenshot.replace(/\.png$/, '-editor.png'), Buffer.from(narrow.data, 'base64'))
    await click('Cancel')
  }
  await selectLocation('Private')
  assert.equal(await evaluate('document.querySelector(".composer textarea").disabled'), true)
  await click('New chat')
  assert.deepEqual(await breadcrumb(), ['General', 'New chat'])
  assert.equal((await chats()).length, 3)
  console.log('PASS: full-row hover/selection highlights and chat-only selection, explorer navigation, Markdown preview/edit/save and conflicts, note renaming/collision protection, creation, sorting/reload persistence, agent switching, unsaved chats and moves; three simulated model calls, no real model used.')
} finally {
  await desktop.quit()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
