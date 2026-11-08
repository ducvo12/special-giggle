import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
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
    // FTS shadow tables retain internal bookkeeping rows even with no documents.
    // Keep virtual tables themselves in the check so indexed content still counts.
    const tables = database.prepare("SELECT name FROM pragma_table_list WHERE schema = 'main' AND type IN ('table', 'virtual') AND name NOT LIKE 'sqlite_%'").all();
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

async function verifyDeletionRecovery({ directory, launch, quit, evaluate, click, wait }) {
  const agents = await evaluate(`(async () => {
    const agents = [];
    for (const name of ['Restore staged', 'Committed deletion', 'Conflicted deletion', 'Unaffected agent']) {
      const result = await window.granite.agents.create(name);
      if (!result.ok) throw new Error(result.error);
      agents.push(result.value);
    }
    return agents;
  })()`)
  const [restored, committed, conflicted, survivor] = agents
  await quit()
  const staging = join(directory, 'agent-deletions')
  await mkdir(staging, { recursive: true })
  for (const agent of [restored, committed, conflicted]) {
    await rename(join(directory, 'agents', agent.id), join(staging, agent.id))
  }
  const liveConflict = join(directory, 'agents', conflicted.id)
  await mkdir(liveConflict)
  await writeFile(join(liveConflict, 'preserved.txt'), 'Preserve conflicting live data')
  // Simulate a crash after committed deletion but before its staged folder purge.
  // This fixture has no chats/projects: the only owned database row is General.
  const marker = spawnSync(require('electron'), ['-e', `
    const Database = require('better-sqlite3');
    const db = new Database(process.argv[1]);
    db.transaction(() => {
      db.prepare('DELETE FROM sections WHERE agentId=?').run(process.argv[2]);
      db.prepare('INSERT INTO agent_deletions VALUES (?)').run(process.argv[2]);
    })();
    db.close();
  `, join(directory, 'atlas.sqlite'), committed.id], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  assert.equal(marker.status, 0, marker.stderr)

  await launch()
  await wait(() => evaluate('Boolean(document.querySelector(".recovery-dialog"))'), 'deletion recovery notice')
  assert.ok(await evaluate(`document.querySelector('.recovery-dialog').textContent.includes(${JSON.stringify(conflicted.id)})`))
  const available = await evaluate('window.granite.agents.list()')
  assert.ok(available.ok)
  assert.deepEqual(available.value.map(agent => agent.id).sort(), [restored.id, survivor.id].sort())
  await access(join(directory, 'agents', restored.id, 'identity.md'))
  await assert.rejects(access(join(staging, committed.id)), { code: 'ENOENT' })
  await access(join(staging, conflicted.id, 'identity.md'))
  assert.equal(await readFile(join(liveConflict, 'preserved.txt'), 'utf8'), 'Preserve conflicting live data')
  assert.equal((await evaluate(`window.granite.workspace.read(${JSON.stringify(conflicted.id)}, '/identity.md')`)).ok, false)
  assert.ok((await evaluate(`window.granite.workspace.save(${JSON.stringify(survivor.id)}, '/notes/usable.md', 'Still usable', null)`)).ok)
  await click('OK')
  for (const agent of [restored, survivor]) {
    const result = await evaluate(`window.granite.agents.delete(${JSON.stringify(agent.id)})`)
    assert.deepEqual(result, { ok: true, value: { cleanupPending: false } })
  }

  await quit()
  // Explicitly resolve this synthetic conflict, after verifying both copies survived.
  await rm(liveConflict, { recursive: true })
  await launch()
  assert.deepEqual((await evaluate('window.granite.agents.list()')).value, [conflicted])
  assert.ok((await evaluate(`window.granite.agents.delete(${JSON.stringify(conflicted.id)})`)).ok)
  assert.deepEqual(await readdir(join(directory, 'agents')), [])
  assert.ok(Object.values(databaseCounts(directory)).every(count => count === 0))
  console.log('PASS recovery: uncommitted deletion restored, committed deletion purged, conflicting folders preserved, only the affected agent blocked, and unrelated agents usable.')
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
  await evaluate('document.querySelector(".connection-editor button").click()')
  await wait(
    () => evaluate('document.querySelector(".file-preview[aria-busy=false]")?.textContent.includes("This file is empty.")'),
    'agent created offline'
  )
  const id = await evaluate('document.querySelector(".agent-dropdown-trigger").dataset.agentId')
  const identityPath = join(directory, 'agents', id, 'identity.md')
  assert.equal(await readFile(identityPath, 'utf8'), '', 'New identities start blank on disk')
  await click('Edit')
  assert.equal(await evaluate('document.querySelector(".file-editor").value'), '')
  assert.equal(await evaluate('[...document.querySelectorAll(".file-actions button")].find(button => button.textContent === "Save").disabled'), true, 'Blank unchanged identity is clean')
  const identity = '# Offline test\nDeletion verification identity.\n'
  await fill('textarea[aria-label="Edit identity.md"]', identity, 'textarea')
  await wait(() => evaluate('document.querySelector(".agent-dropdown-trigger").disabled && Boolean(document.querySelector(".file-dirty"))'), 'dirty identity protects navigation')
  await click('Save')
  await wait(() => evaluate('Boolean(document.querySelector(".file-preview[aria-busy=false]")) && !document.querySelector(".file-dirty") && !document.querySelector(".agent-dropdown-trigger").disabled'), 'identity saved and clean')
  assert.equal(await readFile(identityPath, 'utf8'), identity)
  await click('New chat')
  await evaluate(`document.querySelector('button[title="identity.md"]').click()`)
  await wait(() => evaluate('document.querySelector(".file-preview[aria-busy=false]")?.textContent.includes("Deletion verification identity.")'), 'saved identity reopened')
  await click('Edit')
  assert.equal(await evaluate('document.querySelector(".file-editor").value'), identity)
  assert.equal(await evaluate('[...document.querySelectorAll(".file-actions button")].find(button => button.textContent === "Save").disabled'), true, 'Existing unchanged identity remains clean')
  await fill('textarea[aria-label="Edit identity.md"]', identity + 'Unsaved draft', 'textarea')
  await click('Cancel')
  assert.equal(await readFile(identityPath, 'utf8'), identity, 'Cancel preserves saved identity')
  await wait(() => evaluate('!document.querySelector(".file-dirty") && !document.querySelector(".agent-dropdown-trigger").disabled'), 'cancel clears dirty state')
  await click('New chat')

  // A blank conversation exercises real database deletion without a model.
  const chat = await evaluate(`window.granite.conversations.create(${JSON.stringify(id)})`)
  assert.ok(chat.ok)
  assert.ok((await evaluate(`window.granite.conversations.get(${JSON.stringify(id)}, ${JSON.stringify(chat.value.id)})`)).ok)
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
  assert.equal((await evaluate(`window.granite.workspace.read(${JSON.stringify(id)}, '/identity.md')`)).ok, false, 'Deleted identity cannot be read')
  assert.equal((await evaluate(`window.granite.conversations.get(${JSON.stringify(id)}, ${JSON.stringify(chat.value.id)})`)).ok, false, 'Deleted conversation cannot be retrieved')
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
  await evaluate('document.querySelector(".connection-editor button").click()')
  await wait(
    () => evaluate('document.querySelector(".file-preview[aria-busy=false]")?.textContent.includes("This file is empty.")'),
    'agent created from dropdown'
  )
  const menuId = await evaluate('document.querySelector(".agent-dropdown-trigger").dataset.agentId')
  await click('New chat')
  await evaluate('document.querySelector(".agent-dropdown-trigger").click()')
  await evaluate('document.querySelector(".agent-menu-create").click()')
  await fill('input[aria-label="Agent name"]', 'Second agent')
  await evaluate('document.querySelector(".connection-editor button").click()')
  await wait(
    () => evaluate('document.querySelector(".file-preview[aria-busy=false]")?.textContent.includes("This file is empty.")'),
    'second agent created'
  )
  await click('New chat')
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
    'PASS offline: blank identity, edit/save/reopen cleanliness and cancel; deleted files and conversations inaccessible; delete → 0 folders and 0 content rows (excluding SQLite/FTS bookkeeping); keyboard, outside click, and restart verified.',
    counts
  )
  await verifyDeletionRecovery({ directory, launch, quit, evaluate, click, wait })
}
