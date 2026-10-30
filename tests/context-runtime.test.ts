import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { revision } from '../src/backend/context/store.ts'
import { ContextSession } from '../src/backend/context/session.ts'
import { defaultHarnessSettings } from '../src/shared/harness.ts'
import { createToolRegistry } from '../src/backend/harness/tools/registry.ts'

function event(res: ServerResponse, data: any) { res.write(`data: ${JSON.stringify(data)}\n\n`) }
function reply(res: ServerResponse, text: string) { event(res, { choices: [{ delta: { content: text }, finish_reason: null }] }); event(res, { choices: [{ delta: {}, finish_reason: 'stop' }] }); res.end('data: [DONE]\n\n') }
function call(res: ServerResponse, name: string, args: any, id: string) { event(res, { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] }); event(res, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }); res.end('data: [DONE]\n\n') }
async function fixture(handler: (body: any, res: ServerResponse, n: number) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'granite-context-runtime-')), runtime = await AgentRuntime.open(directory)
  const agent = await runtime.createAgent('Recall fixture'), requests: any[] = []
  const server = createServer(async (req, res) => { let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw); requests.push(body); res.setHeader('Content-Type','text/event-stream'); handler(body, res, requests.length) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { runtime, directory, agent, requests, connection: { baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'fixture', apiKey: '', contextWindow: 65536 },
    close: async () => { await runtime.stopAll(); runtime.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }) } }
}

test('Shared retrieval opens original evidence; Closed requests exclude global and foreign context across real run plumbing', async () => {
  const f = await fixture((body, res, n) => {
    const last = body.messages.at(-1)
    const closed = body.messages[0].content.includes('"mode":"closed"')
    if (closed) { assert.ok(!JSON.stringify(body).includes('secret-global-preference')); return reply(res, 'Closed reply') }
    if (last.role !== 'tool') return call(res, 'search_context', { query: 'cobalt' }, `search-${n}`)
    const found = JSON.parse(last.content)
    reply(res, found.sources[0].excerpt)
  })
  try {
    const source = await f.runtime.createConversation(f.agent.id)
    f.runtime.store.saveMessage(source.id, { id: 'cobalt', role: 'user', content: 'The cobalt project uses SQLite.' })
    const root = (await f.runtime.registry.workspace(f.agent.id)).root
    await writeFile(join(root, 'memory.md'), 'secret-global-preference')
    const chat = await f.runtime.createConversation(f.agent.id)
    await f.runtime.run('recall', f.agent.id, chat.id, f.connection, 'What database did we choose?', () => {})
    const answer = f.runtime.store.get(f.agent.id, chat.id).messages.at(-1)!
    assert.match(answer.content, /SQLite/); assert.ok(answer.sources?.some(s => s.messageId === 'cobalt'))
    const closed = await f.runtime.createSection(f.agent.id, 'Private', 'closed'), privateChat = await f.runtime.createConversation(f.agent.id, { sectionId: closed.id })
    await f.runtime.run('closed', f.agent.id, privateChat.id, f.connection, 'Hello', () => {})
    assert.equal(f.runtime.store.get(f.agent.id, privateChat.id).messages.at(-1)!.content, 'Closed reply')
  } finally { await f.close() }
})

test('identity approval binds exact replacement/revision, denial and stale proposals do not write', async () => {
  const f = await fixture((_body, res) => reply(res, 'Done'))
  try {
    const chat = await f.runtime.createConversation(f.agent.id), root = (await f.runtime.registry.workspace(f.agent.id)).root
    const original = await readFile(join(root,'identity.md'),'utf8')
    const session = new ContextSession(f.runtime.context, f.agent.id, chat.id, new AbortController().signal, () => {})
    const approvals: string[] = []; let allowed = false, changeDuringApproval = false
    const registry = await createToolRegistry({ workspace: await f.runtime.registry.workspace(f.agent.id), context: session,
      settings: defaultHarnessSettings, signal: session.signal, onTool: () => {}, approve: async (_kind, _title, detail) => { approvals.push(detail); if (changeDuringApproval) await writeFile(join(root,'identity.md'), 'Human edit'); return allowed } })
    const args = { content: 'New exact personality', expected_revision: revision(original), reason: 'User requested personality adjustment' }
    try {
      const denied = await registry.execute({ id: 'deny', name: 'propose_identity_change', arguments: JSON.stringify(args) })
      assert.equal(denied.success,false); assert.equal(await readFile(join(root,'identity.md'),'utf8'),original)
      allowed = true; changeDuringApproval = true
      const stale = await registry.execute({ id:'stale',name:'propose_identity_change',arguments:JSON.stringify(args) })
      assert.equal(stale.success,false); assert.equal(await readFile(join(root,'identity.md'),'utf8'),'Human edit')
      changeDuringApproval=false; args.expected_revision=revision('Human edit')
      const saved = await registry.execute({ id:'save',name:'propose_identity_change',arguments:JSON.stringify(args) })
      assert.equal(saved.success,true); assert.match(saved.output,/next run/); assert.equal(await readFile(join(root,'identity.md'),'utf8'),args.content)
      assert.ok(approvals.every(preview => preview.includes('Exact replacement:\nNew exact personality')))
    } finally { await registry.close() }
  } finally { await f.close() }
})

test('compaction stays internal, preserves current direction/history and persists a bounded native continuation', async () => {
  let maintenance = 0
  const f = await fixture((body, res) => {
    const policy = body.messages[0].content
    if (policy.startsWith('Summarize this historical conversation')) { maintenance++; return reply(res, 'Past task used SQLite; implementation remains unfinished.') }
    assert.ok(body.messages.some((m: any) => m.role === 'user' && m.content.includes('Current task: green button')))
    reply(res, 'The button is green.')
  })
  try {
    const chat = await f.runtime.createConversation(f.agent.id)
    for (let i = 0; i < 40; i++) f.runtime.store.saveMessage(chat.id, { id: `old-${i}`, role: i % 2 ? 'assistant' : 'user', content: `Historical ${i}: ` + 'Details for earlier work. '.repeat(70) })
    const emitted: string[] = [], phases: string[] = []
    await f.runtime.run('compact', f.agent.id, chat.id, { ...f.connection, contextWindow: 32768 }, 'Current task: green button', delta => { if (delta.text) emitted.push(delta.text); if (delta.run) phases.push(delta.run.phase) })
    assert.equal(maintenance,1); assert.ok(phases.includes('compacting')); assert.equal(emitted.join(''),'The button is green.')
    assert.equal(f.runtime.store.get(f.agent.id,chat.id).messages.length,42)
    assert.ok(f.runtime.context.db.prepare('SELECT * FROM context_compactions WHERE conversationId=?').get(chat.id))
    assert.equal(f.runtime.listRuns().find(run => run.id === 'compact')?.context?.compactions,1)
  } finally { await f.close() }
})

test('staged continuity never becomes shared before a successful final answer', async () => {
  const f = await fixture((body, res, n) => {
    const orientation = JSON.parse(body.messages[0].content.match(/<permitted_context>\n(.*?)\n<\/permitted_context>/s)![1])
    if (body.messages.at(-1).role !== 'tool') return call(res, 'update_chat_summary', { summary:'A confirmed useful decision.', through_message_id:orientation.latest_user_message_id, expected_revision:null, source_ids:orientation.current_message_sources }, `summary-${n}`)
    assert.equal(f.runtime.context.db.prepare("SELECT count(*) AS n FROM context_documents WHERE kind='summary'").get().n,0)
    reply(res,'Decision saved.')
  })
  try {
    const chat = await f.runtime.createConversation(f.agent.id)
    await f.runtime.run('summarize',f.agent.id,chat.id,f.connection,'Use SQLite for this project.',()=>{})
    assert.equal(f.runtime.context.get(f.agent.id,chat.id,`summary:${chat.id}`).content,'A confirmed useful decision.')
    const row = f.runtime.context.db.prepare('SELECT sources FROM context_summaries WHERE conversationId=?').get(chat.id) as { sources: string }
    assert.equal(JSON.parse(row.sources).length,2)
  } finally { await f.close() }
})

const waitFor = async (ready: () => boolean) => {
  for (let i = 0; i < 500; i++) { if (ready()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('Fixture boundary did not arrive.')
}
function protocolReply(body: any, res: ServerResponse, text: string) {
  if (body.input) {
    event(res, { type: 'response.output_text.delta', delta: text })
    event(res, { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] } })
    res.end()
  } else reply(res, text)
}
function seedLongHistory(runtime: AgentRuntime, chat: string) {
  for (let i = 0; i < 40; i++) runtime.store.saveMessage(chat, { id: `${chat}-history-${i}`, role: i % 2 ? 'assistant' : 'user', content: `Old task ${i}: ` + 'Earlier implementation detail. '.repeat(65) })
}

for (const protocol of ['chat-completions','responses'] as const) {
  for (const operation of ['stop','steer'] as const) test(`${protocol}: ${operation} cancels compaction without publishing obsolete maintenance`, { timeout: 15000 }, async () => {
    let held: ServerResponse | undefined, maintenance = 0
    const f = await fixture((body, res) => {
      const policy = body.instructions ?? body.messages[0].content
      if (policy.startsWith('Summarize this historical conversation')) {
        maintenance++
        if (maintenance === 1) {
          held = res
          const timer = setInterval(() => res.write(': keepalive\n\n'), 50)
          res.on('close', () => clearInterval(timer))
          return
        }
        return protocolReply(body, res, 'Old work remains unfinished.')
      }
      const serialized = JSON.stringify(body.input ?? body.messages)
      assert.match(serialized, /Make the button blue/)
      if (operation === 'steer') assert.match(serialized, /Actually make it green/)
      protocolReply(body, res, 'Current direction completed.')
    })
    try {
      const chat = await f.runtime.createConversation(f.agent.id); seedLongHistory(f.runtime,chat.id)
      const connection = { ...f.connection, protocol, contextWindow:32768 }
      const text: string[] = []
      const run = f.runtime.run('compaction-race',f.agent.id,chat.id,connection,'Make the button blue',delta => { if (delta.text) text.push(delta.text) })
      await waitFor(() => Boolean(held))
      if (operation === 'stop') f.runtime.stop('compaction-race')
      else await f.runtime.run('steer',f.agent.id,chat.id,connection,'Actually make it green',()=>{})
      await run
      const record = f.runtime.listRuns().find(run => run.id === 'compaction-race')!
      assert.equal(record.phase,operation === 'stop' ? 'stopped' : 'complete')
      assert.equal(text.join(''),operation === 'stop' ? '' : 'Current direction completed.')
      if (operation === 'stop') assert.equal(f.runtime.context.db.prepare('SELECT * FROM context_compactions WHERE conversationId=?').get(chat.id),undefined)
      else assert.equal(maintenance,2)
    } finally { await f.close() }
  })
}

test('deletion during compaction discards its obsolete summary and rebuilds context before continuing', { timeout:15000 }, async () => {
  let held: ServerResponse | undefined, heldBody: any, maintenance = 0
  const f = await fixture((body,res) => {
    if (body.messages[0].content.startsWith('Summarize this historical conversation')) {
      if (++maintenance === 1) { held=res; heldBody=body; return }
      return reply(res,'Valid history summary.')
    }
    assert.ok(!JSON.stringify(body).includes('obsolete-secret-summary'))
    reply(res,'Continued with current sources.')
  })
  try {
    const chat = await f.runtime.createConversation(f.agent.id); seedLongHistory(f.runtime,chat.id)
    const source = await f.runtime.createConversation(f.agent.id)
    f.runtime.store.saveMessage(source.id,{id:'deleted-during-compaction',role:'user',content:'An independent source.'})
    const run = f.runtime.run('deletion-race',f.agent.id,chat.id,{...f.connection,contextWindow:32768},'Continue the task',()=>{})
    await waitFor(()=>Boolean(held))
    await f.runtime.deleteConversation(f.agent.id,source.id)
    protocolReply(heldBody,held!,'obsolete-secret-summary')
    await run
    assert.equal(maintenance,2)
    const saved = f.runtime.context.db.prepare('SELECT summary,boundary FROM context_compactions WHERE conversationId=?').get(chat.id) as {summary:string;boundary:string}
    assert.equal(saved.summary,'Valid history summary.');assert.ok(JSON.parse(saved.boundary).prefixRevision)
  } finally { await f.close() }
})

test('required-input overflow reports a limit without calling the provider or deleting history', async () => {
  const f = await fixture((_body,res)=>reply(res,'Should not run'))
  try {
    const chat = await f.runtime.createConversation(f.agent.id)
    await assert.rejects(f.runtime.run('overflow',f.agent.id,chat.id,{...f.connection,contextWindow:4096},'x'.repeat(30000),()=>{}),/context|budget|compaction/i)
    assert.equal(f.requests.length,0)
    assert.equal(f.runtime.store.get(f.agent.id,chat.id).messages[0].content.length,30000)
  } finally { await f.close() }
})
