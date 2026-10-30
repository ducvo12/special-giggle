import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopSession } from './desktop/session.mjs'

const directory = await mkdtemp(join(tmpdir(), 'granite-pass4-desktop-'))
const repository = join(directory, 'code')
await mkdir(join(repository, 'src'), { recursive: true })
await writeFile(join(repository, 'src', 'main.ts'), 'export const fixture = true;\n')
const requests = []
let originalSourceId
const server = createServer(async (request, response) => {
  if (request.url === '/v1/models') { response.setHeader('Content-Type','application/json'); return response.end(JSON.stringify({ data:[{ id:'context-fixture', context_window:65536, max_output_tokens:4096 }] })) }
  let raw=''; for await (const part of request) raw+=part
  const body=JSON.parse(raw); requests.push(body)
  response.setHeader('Content-Type','text/event-stream')
  const event = delta => response.write(`data: ${JSON.stringify(delta)}\n\n`)
  const answer = content => { event({ choices:[{ delta:{content},finish_reason:null }] }); event({ choices:[{delta:{},finish_reason:'stop'}] }); response.end('data: [DONE]\n\n') }
  const call = (name,args) => { event({choices:[{delta:{tool_calls:[{index:0,id:`call-${requests.length}`,function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]}); event({choices:[{delta:{},finish_reason:'tool_calls'}]});response.end('data: [DONE]\n\n') }
  const system=body.messages[0].content, last=body.messages.at(-1)
  if (system.includes('"mode":"closed"')) {
    assert.ok(!JSON.stringify(body).includes('Krypton'))
    const names=body.tools.map(tool=>tool.function.name)
    assert.ok(!names.includes('read_file')&&!names.includes('update_memory'))
    return answer('Closed scope confirmed.')
  }
  const user=body.messages.findLast(item=>item.role==='user')?.content ?? ''
  if (user === 'Search the sample repository') {
    if (last.role !== 'tool') {
      assert.ok(!body.tools.some(tool => tool.function.name === 'repo_write'))
      return call('list_repositories', {})
    }
    const result = JSON.parse(last.content)
    if (Array.isArray(result)) return call('repo_search', { project_id: result[0].projectId, path: 'src', glob: '**/*.ts', text: 'fixture', limit: 5 })
    assert.equal(result.results?.[0]?.path, 'src/main.ts')
    return answer('Search found src/main.ts using packaged ripgrep.')
  }
  if (user.startsWith('The Krypton')) return answer('Understood: the Krypton project chose SQLite.')
  if (last.role !== 'tool') return call('search_context',{query:'Krypton'})
  const data=JSON.parse(last.content)
  if (data.sources) {
    const source=data.sources.find(source=>source.kind==='message'&&source.excerpt.includes('The Krypton'))
    assert.ok(source,'original user message retrieved')
    originalSourceId = source.id
    return call('read_context',{source_id:source.id})
  }
  assert.ok(data.content.includes('SQLite'))
  answer('The Krypton project chose SQLite, according to your earlier message.')
})
const desktop=desktopSession(join(directory,'profile'),9494,{ELECTRON_RENDERER_URL:''},'.',process.env.GRANITE_TEST_APP)
const {evaluate,click,fill,wait}=desktop
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  await desktop.launch()
  const seeded=await evaluate(`(async()=>{const get=r=>{if(!r.ok)throw new Error(r.error);return r.value};const agent=get(await window.granite.agents.create('Context check'));const closed=get(await window.granite.organization.createSection(agent.id,'Private','closed'));get(await window.granite.connections.save({name:'Local fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',model:'context-fixture',apiKey:''}));const shared=get(await window.granite.organization.createSection(agent.id,'Code','shared'));get(await window.granite.organization.createProject(agent.id,shared.id,'Sample repository',${JSON.stringify(repository)}));localStorage.setItem('granite.agent',agent.id);return {agent,closed}})()`)
  await desktop.rpc('Page.reload')
  await wait(()=>evaluate('document.querySelectorAll(".organization-location").length===4 && !document.querySelector(".new-chat-button").disabled'),'profile ready')
  async function send(text,answer) {
    await fill('textarea[aria-label="Message"]',text,'textarea')
    await wait(()=>evaluate('document.querySelector(".send-button")?.disabled===false'),'send enabled')
    await click('Send message')
    await wait(()=>evaluate(`!document.querySelector('.stop-button')&&document.querySelector('.messages')?.textContent.includes(${JSON.stringify(answer)})`),'completed reply')
  }
  await send('The Krypton project chose SQLite for storage.','Understood: the Krypton')
  await click('New chat')
  await send('Which database did we choose for Krypton?','according to your earlier message')
  const chatResult=await evaluate(`window.granite.conversations.list(${JSON.stringify(seeded.agent.id)})`)
  assert.equal(chatResult.ok,true);assert.equal(chatResult.value.length,2)
  await evaluate(`document.querySelector('.message.assistant .context-sources').open=true`)
  await wait(()=>evaluate(`Array.from(document.querySelectorAll('.context-source-links button')).some(button=>button.textContent.startsWith('message'))`),'source buttons visible')
  assert.ok(originalSourceId)
  await evaluate(`Array.from(document.querySelectorAll('.context-source-links button')).find(button=>button.dataset.sourceId===${JSON.stringify(originalSourceId)}).click()`)
  await wait(()=>evaluate(`document.querySelector('.context-source-reader pre')?.textContent.includes('The Krypton project chose SQLite')`),'original saved message opens')
  assert.ok(await evaluate(`getComputedStyle(document.querySelector('.context-source-reader pre')).whiteSpace==='pre-wrap'`))
  const screenshot=await desktop.rpc('Page.captureScreenshot',{format:'png'})
  await writeFile(join(directory,'source-reader.png'),Buffer.from(screenshot.data,'base64'))
  const status=await evaluate(`window.granite.runs.list()`)
  assert.equal(status.ok,true);assert.equal(status.value.at(-1).context.window,65536)
  await evaluate(`Array.from(document.querySelectorAll('.organization-location')).find(button=>button.firstElementChild.textContent==='Private/').click()`)
  await wait(()=>evaluate('document.querySelector(".chat-breadcrumb")?.textContent.includes("Private")'),'Closed draft')
  await send('Please confirm this private scope.','Closed scope confirmed.')
  await click('New chat')
  await evaluate(`Array.from(document.querySelectorAll('.organization-location')).find(button=>button.firstElementChild.textContent==='General/').click()`)
  await send('Search the sample repository','using packaged ripgrep')
  await writeFile(join(directory,'result.json'),JSON.stringify({passed:true,checks:['cross-chat search/read','original source reader','provider context metadata','Closed UI run and tool isolation','read-only repository search via packaged binary'],requests:requests.length},null,2))
  console.log(`Pass 4 desktop checks passed. Evidence: ${directory}`)
} catch (error) {
  await writeFile(join(directory,'failure.json'),JSON.stringify({error:String(error),state:await evaluate('document.body.innerText').catch(()=>''),requests:requests.length},null,2))
  console.error(`Evidence: ${directory}`)
  throw error
} finally {
  await desktop.quit();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
}
