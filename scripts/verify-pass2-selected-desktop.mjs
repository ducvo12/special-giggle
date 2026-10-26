import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { desktopSession } from './desktop/session.mjs'

// Selected Pass 2 acceptance checks. No real provider, recovery, permission-change,
// invalid-response, repository or personal-profile tests. Retains evidence in /tmp.
const root = await mkdtemp(join(tmpdir(), 'granite-pass2-selected-'))
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const diff = execFileSync('git', ['diff', '--binary'], { maxBuffer: 20_000_000 })
await writeFile(join(root, 'build.json'), JSON.stringify({ revision, trackedDiffSha256: createHash('sha256').update(diff).digest('hex'), at: new Date().toISOString() }, null, 2))
const results = []
console.log(`Evidence: ${root}`)

for (const [protocolIndex, protocol] of ['chat-completions', 'responses'].entries()) {
  const directory = join(root, protocol)
  await mkdir(directory)
  const requests = [], events = []
  let handler = entry => entry.answer('Default fixture answer')
  let sequence = 0
  const servers = []
  for (let host = 0; host < 3; host++) {
    const server = createServer(async (req, res) => {
      if (req.url === '/v1/models') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ data: [{ id: 'selected-fixture' }] })); return
      }
      let raw = ''
      for await (const data of req) raw += data
      const body = JSON.parse(raw), id = ++sequence
      const input = body.messages ?? body.input
      const entry = { id, host, body, input, res, text: '', closed: false,
        users: input.filter(x => x.role === 'user').map(x => typeof x.content === 'string' ? x.content : x.content.map(p => p.text ?? '').join('')) }
      requests.push(entry)
      res.on('close', () => { entry.closed = true })
      const event = value => {
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify(value)}\n\n`)
      }
      entry.delta = text => {
        entry.text += text
        event(protocol === 'responses' ? { type: 'response.output_text.delta', delta: text } : { choices: [{ delta: { content: text }, finish_reason: null }] })
      }
      entry.finish = (fallback = '') => {
        if (protocol === 'responses') {
          const output = [{ type: 'message', id: `msg-${id}`, role: 'assistant', content: [{ type: 'output_text', text: entry.text || fallback }] }]
          event({ type: 'response.completed', response: { status: 'completed', output } }); res.end()
        } else {
          event({ choices: [{ delta: {}, finish_reason: 'stop' }] }); res.end('data: [DONE]\n\n')
        }
      }
      entry.answer = text => { entry.delta(text); entry.finish() }
      entry.calls = (calls, text = '') => {
        if (text) entry.delta(text)
        if (protocol === 'responses') {
          const output = calls.map((call, i) => ({ type: 'function_call', id: `item-${id}-${i}`, call_id: `call-${id}-${i}`, namespace: 'granite', name: call.name, arguments: JSON.stringify(call.args) }))
          if (text) output.unshift({ type: 'message', id: `msg-${id}`, role: 'assistant', content: [{ type: 'output_text', text }] })
          for (const [output_index, item] of output.entries()) event({ type: 'response.output_item.done', output_index, item })
          event({ type: 'response.completed', response: { status: 'completed', output } }); res.end()
        } else {
          event({ choices: [{ delta: { tool_calls: calls.map((call, index) => ({ index, id: `call-${id}-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) }, finish_reason: null }] })
          event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }); res.end('data: [DONE]\n\n')
        }
      }
      entry.http = (status, code) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Retry-After': '0.1' }); res.end(JSON.stringify({ error: { code } })) }
      try { await handler(entry) } catch (error) { console.error('FIXTURE', error); res.destroy() }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    servers.push(server)
  }
  const desktop = desktopSession(join(directory, 'profile'), 9480 + protocolIndex, { ELECTRON_RENDERER_URL: '' })
  const { evaluate, wait, fill } = desktop
  async function click(text) {
    const expression = `(() => {
      const element=[...document.querySelectorAll('button,[role="option"]')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(text)} || e.textContent.trim().replace(/^[■▤▱]\\s*/, '').replace(/✓$/, '').trim()===${JSON.stringify(text)});
      if(!element || element.disabled || element.getAttribute('aria-disabled')==='true')return false;
      element.click();return true;
    })()`;
    await wait(()=>evaluate(expression),`button ${text}`)
  }
  let agents, connections, activeAgent
  const bridge = (expression) => evaluate(`(async()=>{const r=await (${expression});if(r==null)return;if(!r.ok)throw new Error(r.error);return r.value})()`)
  const runs = () => bridge('window.granite.runs.list()')
  const chat = id => bridge(`window.granite.conversations.get(${JSON.stringify(activeAgent.id)},${JSON.stringify(id)})`)
  const latest = async id => (await runs()).filter(x => x.conversationId === id).sort((a,b) => b.createdAt-a.createdAt)[0]
  const settled = async (id, phase = 'complete') => wait(async () => (await latest(id))?.phase === phase, `${id} ${phase}`)
  const selected = () => evaluate('document.querySelector(".conversation-choice.selected")?.getAttribute("aria-label")')
  async function selectAgent(agent) {
    if ((await evaluate('document.querySelector(".agent-dropdown-trigger").dataset.agentId')) !== agent.id) {
      await click('Active agent'); await click(agent.name)
      await wait(() => evaluate(`document.querySelector('.agent-dropdown-trigger')?.dataset.agentId === ${JSON.stringify(agent.id)}`), 'agent switched')
    }
    activeAgent = agent
    await wait(() => evaluate('document.querySelector(".new-chat-button")?.disabled === false'), 'agent controls')
  }
  async function draft(connection = connections[0]) {
    if (await evaluate(`Boolean(document.querySelector('button[aria-label="Dismiss error"]'))`)) await click('Dismiss error')
    await click('New chat')
    await wait(() => evaluate('document.querySelector(".chat-heading-status")?.textContent === "Unsaved draft"'), 'draft')
    const current = await evaluate(`document.querySelector('[aria-label="Active connection"]')?.textContent`)
    if (!current?.includes(connection.name)) { await click('Active connection'); await click(connection.name) }
    await wait(() => evaluate('document.querySelector(".send-button") && !document.querySelector("textarea[aria-label=Message]").disabled'), 'draft ready')
  }
  async function send(text, update = false) {
    await fill('textarea[aria-label=Message]', text, 'textarea')
    await wait(() => evaluate('!document.querySelector(".send-button").disabled'), 'send ready')
    await click(update ? 'Send update' : 'Send message')
    await wait(() => evaluate('document.querySelector("textarea[aria-label=Message]")?.value === ""'), 'submitted')
    let id
    await wait(async()=>{const title=await selected();id=(await bridge(`window.granite.conversations.list(${JSON.stringify(activeAgent.id)})`)).find(x=>x.title===title)?.id;return Boolean(id)},'selected saved chat')
    return id
  }
  async function open(title) { await wait(()=>evaluate(`(()=>{const e=[...document.querySelectorAll('.conversation-choice')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(title)});if(!e||e.disabled)return false;e.click();return true})()`),'chat button'); await wait(() => evaluate(`document.querySelector('.conversation-choice.selected')?.getAttribute('aria-label')===${JSON.stringify(title)}`), 'chat opened') }
  async function screenshot(name) {
    const shot = await desktop.rpc('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(directory, `${name}.png`), Buffer.from(shot.data, 'base64'))
  }
  async function record(name, action) {
    const start = requests.length
    try {
      await selectAgent(agents[0])
      await action()
      await wait(()=>evaluate(`document.querySelector('.messages')?.getAttribute('aria-busy')==='false' && [...document.querySelectorAll('.response-duration')].every(e=>!e.textContent.startsWith('Responding'))`),'desktop completion rendered')
      const selectedTitle=await selected()
      if(selectedTitle){
        const saved=(await bridge(`window.granite.conversations.list(${JSON.stringify(activeAgent.id)})`)).find(c=>c.title===selectedTitle)
        if(saved){
          const last=(await chat(saved.id)).messages.filter(m=>m.role==='assistant').at(-1)
          if(last?.content) await wait(()=>evaluate(`([...document.querySelectorAll('.message.assistant .formatted-response')].at(-1)?.textContent??'').replace(/\\s+/g,' ').trim()===${JSON.stringify(last.content.replace(/\s+/g,' ').trim())}`),'full saved answer visible')
        }
      }
      results.push({ protocol, name, result: 'Pass', requests: requests.length - start })
      console.log(`PASS ${protocol}: ${name}`)
    } catch (error) {
      results.push({ protocol, name, result: 'Fail', error: String(error), requests: requests.length - start })
      console.error(`FAIL ${protocol}: ${name}: ${error}`)
    }
    await screenshot(name.replace(/[^a-zA-Z0-9-]/g, '_'))
    const state = { runs: await runs(), chats: [] }
    for (const agent of agents) for (const c of await bridge(`window.granite.conversations.list(${JSON.stringify(agent.id)})`)) {
      state.chats.push(await bridge(`window.granite.conversations.get(${JSON.stringify(agent.id)},${JSON.stringify(c.id)})`))
    }
    await writeFile(join(directory, `${name.replace(/[^a-zA-Z0-9-]/g, '_')}.json`), JSON.stringify(state, null, 2))
    for (const r of await runs()) if (!['complete','error','stopped','interrupted','not_started'].includes(r.phase)) await bridge(`window.granite.stop(${JSON.stringify(r.id)})`)
    await wait(async () => (await runs()).every(r => ['complete','error','stopped','interrupted','not_started'].includes(r.phase)), 'case cleanup')
    await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2))
  }
  try {
    await desktop.launch()
    const seeded = await evaluate(`(async()=>{
      const u=r=>{if(r==null)return;if(!r.ok)throw new Error(r.error);return r.value};
      const a=u(await window.granite.agents.create('Selected primary'));
      const b=u(await window.granite.agents.create('Selected approval'));
      u(await window.granite.harness.save(a.id,{instructions:'',terminal:true,approveWrites:false,skills:true,mcpServers:[]}));
      u(await window.granite.harness.save(b.id,{instructions:'',terminal:false,approveWrites:true,skills:true,mcpServers:[]}));
      const connections=[];
      for(const d of ${JSON.stringify(servers.map((s,i)=>({name:`Fixture ${i+1}`,apiKey:'',baseUrl:`http://127.0.0.1:${s.address().port}/v1`,model:'selected-fixture',protocol,...(i ? {maxConcurrentRequests:i===1?2:1}: {})})))}) connections.push(u(await window.granite.connections.save(d)));
      localStorage.setItem('granite.agent',a.id);localStorage.setItem('granite.connection',connections[0].id);
      return {agents:[a,b],connections};
    })()`)
    ;({ agents, connections } = seeded); activeAgent = agents[0]
    await desktop.rpc('Page.reload') // Initial fixture setup only, not a recovery test.
    await wait(() => evaluate('document.querySelector("textarea[aria-label=Message]")?.disabled === false'), 'initial composer')
    // Capture approval identifiers and messages through the public preload subscription.
    await evaluate('window.__evidence=[]; window.granite.onDelta(d=>window.__evidence.push(d))')

    await record('A1-drafts-blank-double-send', async () => {
      handler = e => e.answer('One answer')
      const before = (await bridge(`window.granite.conversations.list(${JSON.stringify(activeAgent.id)})`)).length
      await draft(); await fill('textarea[aria-label=Message]', '   ', 'textarea')
      assert.equal(await evaluate('document.querySelector(".send-button").disabled'), true)
      await draft()
      assert.equal((await bridge(`window.granite.conversations.list(${JSON.stringify(activeAgent.id)})`)).length, before)
      await fill('textarea[aria-label=Message]', 'A1 unique submission', 'textarea')
      const n = requests.length
      await evaluate('document.querySelector(".send-button").click();document.querySelector(".send-button").click()')
      await wait(async()=>requests.length>n,'double submit accepted')
      const id=(await runs()).at(-1).conversationId
      await settled(id)
      assert.equal(requests.length,n+1)
      assert.equal((await chat(id)).messages.filter(m=>m.role==='user').length,1)
      const r=await latest(id)
      const duplicate=await evaluate(`window.granite.stream(${JSON.stringify(r.id)},${JSON.stringify(activeAgent.id)},${JSON.stringify(id)},${JSON.stringify(connections[0].id)},'A1 unique submission')`)
      assert.equal(duplicate.ok,false)
      assert.equal(requests.length,n+1)
    })

    await record('A2-A4-streaming-saved-reopen', async () => {
      let held; handler=e=>{held=e;e.delta('First chunk ')}
      await draft(); const id=await send('A2 held reply')
      await wait(()=>Boolean(held),'held reply'); await wait(()=>evaluate('document.querySelector(".messages").textContent.includes("First chunk")'),'provisional visible')
      assert.equal((await latest(id)).phase,'streaming')
      held.delta('second chunk.'); held.finish(); await settled(id)
      assert.equal((await chat(id)).messages.at(-1).content,'First chunk second chunk.')
      const n=requests.length; await draft(); await open('A2 held reply')
      await wait(()=>evaluate('document.querySelector(".messages").textContent.includes("First chunk second chunk.")'),'saved answer visible')
      assert.equal(requests.length,n)
      handler=e=>e.answer('Follow-up complete')
      await send('A2 follow-up'); await settled(id)
      assert.ok(JSON.stringify(requests.at(-1).input).includes('First chunk second chunk.'))
      if(protocol==='responses') {
        handler=e=>e.finish('Completed without deltas')
        await draft();const fallback=await send('A2 fallback');await settled(fallback)
        assert.equal((await chat(fallback)).messages.at(-1).content,'Completed without deltas')
      }
    })

    await record('A3-text-tool-final', async () => {
      handler=e=>e.input.some(x=>x.role==='tool'||x.type==='function_call_output')?e.answer('Tool final answer'):e.calls([{name:'write_file',args:{file_path:'/notes/a3.md',content:'A3 receipt'}}],'Checking the note. ')
      await draft();const id=await send('A3 tool loop');await settled(id)
      const m=(await chat(id)).messages.at(-1)
      assert.equal(m.tools.length,1);assert.equal(m.tools[0].status,'complete')
      assert.match(m.content,/Checking the note.[\s\S]*Tool final answer/)
      assert.equal(await bridge(`window.granite.workspace.read(${JSON.stringify(activeAgent.id)},'/notes/a3.md')`),'A3 receipt')
      assert.ok(JSON.stringify(requests.at(-1).input).includes('call-'))
    })

    await record('A5-navigation-isolation', async () => {
      let held;handler=e=>{held=e;e.delta('A5 isolated output')}
      await draft();const id=await send('A5 background reply');await wait(()=>Boolean(held),'background')
      await draft();assert.equal(await evaluate('document.querySelector(".messages").textContent.includes("A5 isolated output")'),false)
      await selectAgent(agents[1]);assert.equal(await evaluate('document.querySelector(".messages").textContent.includes("A5 isolated output")'),false)
      await selectAgent(agents[0]);await click('memory.md');held.delta(' finished');held.finish();await settled(id)
      await open('A5 background reply');await wait(()=>evaluate('document.querySelector(".messages").textContent.includes("A5 isolated output finished")'),'background saved')
    })

    await record('B1-B2-steering-burst-and-order', async () => {
      const held=[];handler=e=>{held.push(e);e.delta(`Provisional ${held.length}`)}
      await draft();const id=await send('Make the button blue');await wait(()=>held.length===1,'original request')
      const runId=(await latest(id)).id
      await send('Actually make it green',true)
      await send('And make it round',true)
      await send('Use a small size',true)
      await wait(()=>held.at(-1).users.includes('Use a small size'),'all directions')
      const last=held.at(-1)
      assert.deepEqual(last.users,['Make the button blue','Actually make it green','And make it round','Use a small size'])
      assert.equal((await latest(id)).id,runId)
      // An obsolete stream may still emit; it must not influence saved output.
      if(!held[0].closed) held[0].delta('OBSOLETE LATE TEXT')
      last.delta(' Final green round small.');last.finish();await settled(id)
      const detail=await chat(id)
      assert.equal(detail.messages.at(-2).content,'Use a small size')
      assert.match(detail.messages.at(-1).content,/Final green round small/)
      assert.ok(!JSON.stringify(detail).includes('OBSOLETE LATE TEXT'))
      assert.equal(detail.messages.filter(m=>m.role==='assistant'&&m.status==='complete').length,1)
    })

    await record('B3-steer-executing-tool-and-skip-batch', async () => {
      const agentRoot=join(directory,'profile','agents',activeAgent.id)
      handler=e=>e.users.at(-1)==='B3 unrelated question'?e.answer('B3 parallel finished'):e.input.some(x=>x.role==='tool'||x.type==='function_call_output')?e.answer('B3 revised answer'):e.calls([
        {name:'terminal',args:{command:'printf started > notes/b3-started; while [ ! -f notes/b3-release ]; do sleep 0.05; done; printf done > notes/b3-done; printf B3-completed'}},
        {name:'write_file',args:{file_path:'/notes/b3-must-not-exist.md',content:'obsolete'}}])
      await draft();const id=await send('B3 controlled action');await wait(()=>evaluate('Boolean(document.querySelector(".approval-panel"))'),'terminal approval')
      await click('Allow once')
      await wait(async()=>{try{return(await readFile(join(agentRoot,'notes/b3-started'),'utf8'))==='started'}catch{return false}},'terminal began')
      await draft();const other=await send('B3 unrelated question');await settled(other)
      assert.equal((await latest(id)).phase,'tools')
      await open('B3 controlled action')
      await send('B3 answer only; skip remaining actions',true)
      await writeFile(join(agentRoot,'notes/b3-release'),'release')
      await settled(id)
      assert.equal(await readFile(join(agentRoot,'notes/b3-done'),'utf8'),'done')
      await assert.rejects(readFile(join(agentRoot,'notes/b3-must-not-exist.md')),{code:'ENOENT'})
      const native=JSON.stringify(requests.at(-1).input)
      assert.match(native,/B3-completed/);assert.match(native,/superseded by new direction/)
      assert.match((await chat(id)).messages.at(-1).content,/B3 revised answer/)
    })

    await record('B4-C5-steer-approval-release-capacity', async () => {
      await selectAgent(agents[1])
      handler=e=>e.users.at(-1)==='B4 pending write'?e.calls([{name:'write_file',args:{file_path:'/notes/b4-obsolete.md',content:'obsolete'}}]):e.answer('B4 revised answer')
      await draft();const id=await send('B4 pending write')
      await wait(()=>evaluate('Boolean(document.querySelector(".approval-panel"))'),'write approval')
      await screenshot('B4-pending-approval')
      const approval=await evaluate('[...window.__evidence].reverse().find(x=>x.approval)?.approval')
      await draft();const other=await send('B4 other chat while approval waits');await settled(other)
      assert.equal((await latest(id)).phase,'approval')
      await open('B4 pending write');await send('B4 skip the write',true);await settled(id)
      assert.equal(await evaluate('Boolean(document.querySelector(".approval-panel"))'),false)
      const stale=await evaluate(`window.granite.harness.approve(${JSON.stringify(approval.requestId)},${JSON.stringify(approval.id)},true)`)
      assert.equal(stale.ok,false)
      assert.equal((await evaluate(`window.granite.workspace.read(${JSON.stringify(activeAgent.id)},'/notes/b4-obsolete.md')`)).ok,false)
    })

    await record('B5-finalization-before-and-after', async () => {
      let held;handler=e=>{held=e;e.delta('B5 provisional')}
      await draft();const id=await send('B5 original');await wait(()=>Boolean(held),'first request')
      const first=(await latest(id)).id
      handler=e=>e.answer('B5 correction accepted')
      await send('B5 before completion',true);await settled(id)
      assert.equal((await latest(id)).id,first)
      await send('B5 after completion');await settled(id)
      assert.notEqual((await latest(id)).id,first)
      assert.equal((await chat(id)).messages.filter(m=>m.role==='user').length,3)
    })

    await record('C1-C2-queue-order-cancel-and-append', async () => {
      const held=[];handler=e=>{held.push(e);e.delta('Queue fixture held')}
      await draft();const a=await send('C1 active');await wait(()=>held.length===1,'queue active')
      await draft();const b=await send('C1 cancel queued');await wait(async()=>(await latest(b))?.queue?.position===1,'B queue1')
      await draft();const c=await send('C1 queued original');await wait(async()=>(await latest(c))?.queue?.position===2,'C queue2')
      await wait(()=>evaluate('document.querySelector(".run-status-bar").textContent.includes("position 2")'),'visible queue2')
      await screenshot('C1-queue-position-2')
      const cRun=(await latest(c)).id
      await send('C1 queued second prompt',true)
      assert.equal((await latest(c)).id,cRun);assert.equal(requests.at(-1),held[0])
      await open('C1 cancel queued');await click('Cancel queued');await settled(b,'stopped')
      assert.ok((await chat(b)).messages.every(m=>m.delivery==='cancelled'))
      await open('C1 queued original');await wait(()=>evaluate('document.querySelector(".run-status-bar").textContent.includes("position 1")'),'visible queue1')
      held[0].finish();await settled(a);await wait(()=>held.length===2,'C dispatch')
      assert.deepEqual(held[1].users,['C1 queued original','C1 queued second prompt'])
      held[1].finish();await settled(c)
      assert.ok(!requests.some(e=>e.users.includes('C1 cancel queued')))
    })

    await record('C3-capacity-two-cross-agent-independent-host', async () => {
      const held=[];handler=e=>{held.push(e);e.delta('C3 held')}
      await draft(connections[1]);const a=await send('C3 first');await wait(()=>held.length===1,'first')
      await selectAgent(agents[1]);await draft(connections[1]);const b=await send('C3 second');await wait(()=>held.length===2,'second simultaneous')
      await draft(connections[1]);const c=await send('C3 third');await wait(async()=>(await latest(c))?.queue?.position===1,'third queues')
      assert.equal(held.filter(e=>e.host===1&&!e.closed).length,2)
      await draft(connections[2]);const d=await send('C3 independent');await wait(()=>held.length===3,'independent endpoint runs')
      assert.equal(held[2].host,2)
      held[0].finish();await wait(()=>held.length===4,'third starts after release')
      assert.equal(held[3].users.at(-1),'C3 third')
      for(const e of held.slice(1))e.finish()
      await settled(a);await settled(b);await settled(c);await settled(d)
    })


    await record('B2-C5-D1-steering-and-stop-at-later-model-wait', async () => {
      let first, blocker, final
      handler=e=>{
        if(e.users[0]==='Later wait original') {
          if(!e.input.some(x=>x.role==='tool'||x.type==='function_call_output'))first=e
          else {final=e;e.delta('Later wait revised')}
        } else {blocker=e;e.delta('Later wait blocker')}
      }
      await draft();const a=await send('Later wait original');await wait(()=>Boolean(first),'initial held request')
      const runId=(await latest(a)).id
      await draft();const b=await send('Later wait blocker');await wait(async()=>(await latest(b))?.queue?.position===1,'blocker queued')
      first.calls([{name:'read_file',args:{file_path:'/memory.md'}}])
      await wait(()=>Boolean(blocker),'blocker granted after tool response')
      await wait(async()=>(await latest(a))?.phase==='queued','started run waits again')
      assert.notEqual((await latest(a)).startedAt,null)
      await open('Later wait original');await send('Later wait first correction',true);await send('Later wait second correction',true)
      assert.equal((await latest(a)).id,runId)
      blocker.finish();await settled(b);await wait(()=>Boolean(final),'revised request after queue')
      assert.deepEqual(final.users,['Later wait original','Later wait first correction','Later wait second correction'])
      final.finish();await settled(a)
      // Repeat the later-request wait, this time Stop it before capacity returns.
      first=blocker=final=undefined
      await draft();const c=await send('Later wait original');await wait(()=>Boolean(first),'second initial request')
      await draft();const d=await send('Later wait blocker');await wait(async()=>(await latest(d))?.queue?.position===1,'second blocker queued')
      first.calls([{name:'read_file',args:{file_path:'/memory.md'}}])
      await wait(()=>Boolean(blocker),'second blocker starts')
      await wait(async()=>(await latest(c))?.phase==='queued','second later wait')
      await open('Later wait original');await click('Stop');await settled(c,'stopped')
      const n=requests.length;blocker.finish();await settled(d)
      assert.equal(requests.length,n)
      assert.equal(final,undefined)
    })

    await record('C6-host-busy-and-D4-single-retry', async () => {
      let attempts=0
      handler=e=>++attempts===1?e.http(503,'server_busy'):e.answer('Host capacity available')
      await draft();const id=await send('C6 host busy')
      await wait(()=>evaluate('document.querySelector(".run-status-bar")?.textContent.includes("position unavailable")'),'unknown host rank')
      await settled(id);assert.equal(attempts,2)
      attempts=0;handler=e=>++attempts===1?e.http(503,'temporary_failure'):e.answer('Retry succeeded')
      await draft();const retry=await send('D4 retry once');await settled(retry);assert.equal(attempts,2)
      attempts=0;handler=e=>{attempts++;e.http(503,'temporary_failure')}
      await draft();const fail=await send('D4 second failure');await settled(fail,'error');assert.equal(attempts,2)
      await wait(()=>evaluate('[...document.querySelectorAll("button")].some(x=>x.textContent==="Continue")'),'continue after retry exhausted')
    })

    await record('D1-stop-stream-and-continue-new-run', async () => {
      let held;handler=e=>{held=e;e.delta('D1 preserved partial')}
      await draft();const id=await send('D1 original task');await wait(()=>Boolean(held),'stream')
      const old=(await latest(id)).id;await click('Stop');await settled(id,'stopped')
      await screenshot('D1-stopped-before-continue')
      const n=requests.length
      if(!held.closed)held.delta('OBSOLETE AFTER STOP')
      assert.match((await chat(id)).messages.at(-1).content,/D1 preserved partial/)
      handler=e=>e.answer('D1 continuation finished')
      await click('Continue');await settled(id)
      assert.notEqual((await latest(id)).id,old);assert.equal(requests.length,n+1)
      assert.match(JSON.stringify(requests.at(-1).input),/D1 original task/)
      assert.match(JSON.stringify(requests.at(-1).input),/Interrupted/)
      assert.ok(!JSON.stringify(await chat(id)).includes('OBSOLETE AFTER STOP'))
    })

    await record('D1-stop-retry-and-approval', async () => {
      let attempts=0;handler=e=>{attempts++;e.http(503,'temporary_failure')}
      await draft();const id=await send('D1 stop reconnecting')
      await wait(async()=>(await latest(id))?.phase==='reconnecting','retry delay');await click('Stop');await settled(id,'stopped')
      assert.equal(attempts,1)
      await selectAgent(agents[1]);handler=e=>e.calls([{name:'write_file',args:{file_path:'/notes/d1-not-created.md',content:'never'}}])
      await draft();const approval=await send('D1 stop approval');await wait(()=>evaluate('Boolean(document.querySelector(".approval-panel"))'),'approval')
      const n=requests.length;await click('Stop agent');await settled(approval,'stopped')
      assert.equal(requests.length,n)
      assert.equal((await evaluate(`window.granite.workspace.read(${JSON.stringify(activeAgent.id)},'/notes/d1-not-created.md')`)).ok,false)
    })

    await record('D3-D5-completed-edit-survives-continue-no-replay', async () => {
      let held;handler=e=>e.input.some(x=>x.role==='tool'||x.type==='function_call_output')?(held=e,e.delta('After saved edit')):e.calls([{name:'write_file',args:{file_path:'/notes/d3.md',content:'Saved exactly once'}}])
      await draft();const id=await send('D3 save then hold');await wait(()=>Boolean(held),'after tool')
      await click('Stop');await settled(id,'stopped')
      assert.equal(await bridge(`window.granite.workspace.read(${JSON.stringify(activeAgent.id)},'/notes/d3.md')`),'Saved exactly once')
      handler=e=>e.answer('D3 continued without repeating the write')
      await click('Continue');await settled(id)
      const detail=await chat(id)
      assert.equal(detail.messages.flatMap(m=>m.tools??[]).filter(t=>t.name==='write_file').length,1)
      assert.match(JSON.stringify(requests.at(-1).input),/Saved exactly once/)
      assert.match(JSON.stringify(requests.at(-1).input),/do not replay/)
    })


    await record('D4-D5-disconnect-after-action-and-continue', async () => {
      let attempts=0
      handler=e=>{
        attempts++
        if(e.input.some(x=>x.role==='tool'||x.type==='function_call_output')) {e.delta('D5 network partial');e.res.end()}
        else e.calls([{name:'write_file',args:{file_path:'/notes/d5-network.md',content:'D5 saved receipt'}}])
      }
      await draft();const id=await send('D5 disconnect task');await settled(id,'error')
      assert.equal(attempts,2,'no automatic replay after response data')
      assert.equal(await bridge(`window.granite.workspace.read(${JSON.stringify(activeAgent.id)},'/notes/d5-network.md')`),'D5 saved receipt')
      handler=e=>{attempts++;e.answer('D5 network continuation complete')}
      await click('Continue');await settled(id)
      assert.equal(attempts,3)
      assert.match(JSON.stringify(requests.at(-1).input),/D5 disconnect task/)
      assert.match(JSON.stringify(requests.at(-1).input),/D5 saved receipt/)
      assert.equal((await chat(id)).messages.flatMap(m=>m.tools??[]).filter(t=>t.name==='write_file').length,1)
    })

    await record('D2-steer-stop-and-new-prompt-during-cleanup', async () => {
      let held;handler=e=>{held=e;e.delta('D2 old partial')}
      await draft();const id=await send('D2 original');await wait(()=>Boolean(held),'D2 stream')
      const old=(await latest(id)).id
      await send('D2 correction before stop',true)
      // One renderer event turn: initiate Stop, then submit a new prompt without
      // waiting for old worker cleanup. The public bridge exposes this boundary.
      handler=e=>e.answer('D2 new prompt finished')
      const result=await evaluate(`(async()=>{
        const stopped=window.granite.stop(${JSON.stringify(old)});
        const next=window.granite.stream('d2-new-${protocol}',${JSON.stringify(activeAgent.id)},${JSON.stringify(id)},${JSON.stringify(connections[0].id)},'D2 new prompt during cleanup');
        return await Promise.all([stopped,next]);
      })()`)
      assert.equal(result[1]?.ok,true,JSON.stringify(result))
      await settled(id)
      const history=(await runs()).filter(r=>r.conversationId===id)
      assert.ok((await chat(id)).messages.some(m=>m.runId===old&&m.status==='stopped'))
      assert.equal(history.find(r=>r.id===`d2-new-${protocol}`).phase,'complete')
      assert.match(JSON.stringify(requests.at(-1).input),/D2 new prompt during cleanup/)
    })
  } finally {
    await writeFile(join(directory,'requests.json'),JSON.stringify(requests.map(({id,host,body,closed})=>({id,host,body,closed})),null,2))
    try { events.push(...await evaluate('window.__evidence??[]')) } catch {}
    await writeFile(join(directory,'events.json'),JSON.stringify(events,null,2))
    await desktop.quit()
    for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  }
}
console.log(JSON.stringify({root,passed:results.filter(x=>x.result==='Pass').length,failed:results.filter(x=>x.result==='Fail').length},null,2))
process.exitCode=results.some(x=>x.result==='Fail')?1:0
