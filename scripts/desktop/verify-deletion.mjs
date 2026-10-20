import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

function databaseCounts(directory) {
  // Use Electron's Node runtime to match the native SQLite module's ABI.
  const reader = spawnSync(
    require('electron'),
    [
      '-e',
      `
    const Database = require('better-sqlite3');
    const database = new Database(process.argv[1], { readonly: true });
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const counts = Object.fromEntries(tables.map(({ name }) => [name, database.prepare('SELECT count(*) AS count FROM "' + name + '"').get().count]));
    console.log(JSON.stringify(counts));
    database.close();
  `,
      join(directory, 'atlas.sqlite')
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }
  )

  assert.equal(reader.status, 0, reader.stderr)

  return JSON.parse(reader.stdout)
}

export async function verifyDeletion({
  directory,
  launch,
  quit,
  evaluate,
  click,
  fill,
  wait,
  rpc
}) {
  await launch()
  assert.deepEqual((await evaluate('window.granite.agents.list()')).value, [])
  assert.ok(Object.values(databaseCounts(directory)).every(count => count === 0))
  assert.deepEqual(await readdir(join(directory, 'agents')), [])

  await click('Create agent')
  await fill('input[aria-label="Agent name"]', 'Offline test')
  await click('Create agent')
  await wait(
    () => evaluate('document.querySelector(".identity-editor")?.value.includes("# Offline test")'),
    'agent created offline'
  )
  const id = await evaluate('document.querySelector(".agent-dropdown-trigger").dataset.agentId')
  const identityPath = join(directory, 'agents', id, 'identity.md')
  assert.equal(await readFile(identityPath, 'utf8'), '', 'New identities start blank on disk')
  const preset = await evaluate('document.querySelector(".identity-editor").value')
  assert.ok(preset.includes('# Offline test'))
  assert.equal(
    await evaluate('document.querySelector(".connection-editor button[type=submit]").disabled'),
    false,
    'The unchanged preset can be saved immediately'
  )
  await click('Save and continue')
  await wait(() => evaluate('Boolean(document.querySelector(".chat-main"))'), 'preset saved and continued to chat')
  assert.equal(await readFile(identityPath, 'utf8'), preset)

  await click('◇ Identity')
  await wait(() => evaluate('document.querySelector(".identity-editor")?.disabled === false'), 'saved identity reopened')
  assert.equal(await evaluate('document.querySelector(".identity-editor").value'), preset)
  assert.equal(
    await evaluate('document.querySelector(".connection-editor button[type=submit]").disabled'),
    true,
    'Existing unchanged identities remain clean'
  )
  await click('Back to chat')

  // A blank conversation exercises real database deletion without a model.
  const chat = await evaluate(`window.granite.conversations.create(${JSON.stringify(id)})`)
  assert.ok(chat.ok)
  assert.equal(databaseCounts(directory).conversations, 1)
  await evaluate('document.querySelector(".agent-dropdown-trigger").click()')
  await evaluate('document.querySelector(".agent-menu-delete").click()')
  await click('Cancel')
  assert.equal((await evaluate('window.granite.agents.list()')).value.length, 1)
  assert.equal(databaseCounts(directory).conversations, 1)

  await evaluate('document.querySelector(".agent-menu-delete").click()')
  await click('Delete agent')
  await wait(
    () =>
      evaluate(
        'document.querySelector(".empty-chat button")?.textContent.trim() === "Create agent"'
      ),
    'last agent deleted'
  )
  assert.deepEqual((await evaluate('window.granite.agents.list()')).value, [])
  await assert.rejects(access(join(directory, 'agents', id)), { code: 'ENOENT' })
  assert.ok(Object.values(databaseCounts(directory)).every(count => count === 0))
  assert.equal(await evaluate('localStorage.getItem("granite.agent")'), null)

  await quit()
  await launch()
  assert.deepEqual((await evaluate('window.granite.agents.list()')).value, [])
  assert.deepEqual(await readdir(join(directory, 'agents')), [])
  assert.ok(Object.values(databaseCounts(directory)).every(count => count === 0))

  // Exercise the menu's keyboard and outside-click behavior in the empty state.
  await evaluate('document.querySelector(".agent-dropdown-trigger").focus()')
  await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' })
  await wait(
    () => evaluate('document.activeElement?.getAttribute("aria-label") === "Create agent"'),
    'keyboard menu focus'
  )
  await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  assert.equal(await evaluate('document.querySelector("[role=menu]") === null'), true)
  assert.equal(await evaluate('document.activeElement?.getAttribute("aria-label")'), 'Active agent')

  await evaluate('document.querySelector(".agent-dropdown-trigger").click()')
  await evaluate(
    'document.querySelector(".messages").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))'
  )
  await wait(
    () => evaluate('document.querySelector("[role=menu]") === null'),
    'outside click closes menu'
  )

  // Creating from the custom dropdown must also work with no existing agent.
  await evaluate('document.querySelector(".agent-dropdown-trigger").click()')
  await evaluate('document.querySelector(".agent-menu-create").click()')
  await fill('input[aria-label="Agent name"]', 'Menu test')
  await click('Create agent')
  await wait(
    () => evaluate('document.querySelector(".identity-editor")?.value.includes("# Menu test")'),
    'agent created from dropdown'
  )
  const menuId = await evaluate('document.querySelector(".agent-dropdown-trigger").dataset.agentId')
  await click('Save and continue')
  await wait(() => evaluate('Boolean(document.querySelector(".chat-main"))'), 'menu agent setup saved')
  await evaluate('document.querySelector(".agent-dropdown-trigger").click()')
  await evaluate('document.querySelector(".agent-menu-create").click()')
  await fill('input[aria-label="Agent name"]', 'Second agent')
  await click('Create agent')
  await wait(
    () => evaluate('document.querySelector(".identity-editor")?.value.includes("# Second agent")'),
    'second agent created'
  )
  await click('Save and continue')
  await wait(() => evaluate('Boolean(document.querySelector(".chat-main"))'), 'second agent setup saved')
  await evaluate('document.querySelector(".agent-dropdown-trigger").click()')
  await evaluate(
    `document.querySelector('[role="menuitemradio"][data-agent-id="${menuId}"]').click()`
  )
  await wait(
    () =>
      evaluate(
        `document.querySelector('.agent-dropdown-trigger').dataset.agentId === ${JSON.stringify(menuId)} && !document.querySelector('.agent-dropdown-trigger').disabled`
      ),
    'agent switched'
  )

  await evaluate('document.querySelector(".agent-dropdown-trigger").click()')
  await evaluate('document.querySelector(\'[aria-label="Delete agent Second agent"]\').click()')
  await click('Delete agent')
  await wait(
    () => evaluate('(async () => (await window.granite.agents.list()).value.length === 1)()'),
    'inactive agent deleted'
  )
  assert.equal(
    await evaluate('document.querySelector(".agent-dropdown-trigger").dataset.agentId'),
    menuId
  )

  await evaluate('document.querySelector(".agent-dropdown-trigger").click()')
  const screenshot = await rpc('Page.captureScreenshot', { format: 'png' })
  await writeFile('/tmp/granite-agent-dropdown.png', Buffer.from(screenshot.data, 'base64'))
  await evaluate('document.querySelector(".agent-menu-delete").click()')
  await click('Delete agent')
  await wait(
    () =>
      evaluate(
        'document.querySelector(".empty-chat button")?.textContent.trim() === "Create agent"'
      ),
    'menu agent removed'
  )
  assert.deepEqual(await readdir(join(directory, 'agents')), [])

  const counts = databaseCounts(directory)
  assert.ok(
    Object.values(counts).every(count => count === 0),
    JSON.stringify(counts)
  )
  console.log(
    'PASS offline: save an unchanged identity preset and continue; existing identity stays clean; delete → 0 folders and 0 rows; cancel, keyboard, outside click, and restart verified.',
    counts
  )
}
