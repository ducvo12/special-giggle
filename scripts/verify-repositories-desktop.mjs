import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { desktopSession } from './desktop/session.mjs'

const directory = await mkdtemp(join(tmpdir(), 'granite-repository-ui-'))
const profile = join(directory, 'profile')
const desktop = desktopSession(profile, 9491, { ELECTRON_RENDERER_URL: '' }, process.argv[2] ?? '.')
const { evaluate, fill, wait } = desktop
let project, agent, sequence = 0
const requests = []
const server = createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'repo-ui'}]}));return}
 let raw='';for await(const chunk of req)raw+=chunk
 const body=JSON.parse(raw);requests.push(body)
 res.setHeader('Content-Type','text/event-stream')
 const event=value=>res.write(`data: ${JSON.stringify(value)}\n\n`)
 const text=content=>event({choices:[{delta:{content},finish_reason:null}]})
 const answer=content=>{text(content);event({choices:[{delta:{},finish_reason:'stop'}]});res.end('data: [DONE]\n\n')}
 const call=(name,args)=>{event({choices:[{delta:{tool_calls:[{index:0,id:`ui-${++sequence}`,function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]});event({choices:[{delta:{},finish_reason:'tool_calls'}]});res.end('data: [DONE]\n\n')}
 const latestUser=body.messages.findLastIndex(m=>m.role==='user'), user=body.messages[latestUser].content
 const outputs=body.messages.slice(latestUser+1).filter(m=>m.role==='tool')
 if(user==='Question setup'){call('ask_user',{questions:[{title:'Which styling should this project use?',options:['Plain CSS','Tailwind']}]});return}
 if(user.startsWith('User answer to question')){answer('I will use your selected styling.');return}
 if(user==='Check the app'){
  if(!outputs.length)call('repo_preview_start',{command:'node -e \'require("node:http").createServer((q,r)=>{console.log("request:"+q.url);r.end("preview works")}).listen(Number(process.env.PORT),process.env.HOST)\''})
  else {const state=JSON.parse(outputs.at(-1).content);if(state.status==='ready')answer(`The local preview is ready. [Open the app](${state.url}/manual-link-check)`);else call('repo_preview_read',{preview_id:state.id,wait_ms:100})}
  return
 }
 if(user==='Hold repository'){text('Holding project reservation');return}
 if(user==='Outside edit'){
  if(!outputs.length)call('request_repository_edit',{project_id:project.id})
  else answer('Move this chat into Website to edit its files.')
 }else if(user==='Interactive command'){
  if(!outputs.length)call('repo_command_start',{command:'printf "Project name? "; read name; printf "%s" "$name" > interactive.txt',interactive:true})
  else {
   const state=JSON.parse(outputs.at(-1).content)
   if(state.status==='complete')answer('The interactive command completed and its changes were applied.')
   else if(state.inputRevision===0&&state.output.includes('Project name?'))call('repo_command_input',{session_id:state.id,input_revision:0,data:'demo-project\r'})
   else call('repo_command_read',{session_id:state.id,offset:0,wait_ms:100})
  }
 }else if(user==='Command check'){
  if(!outputs.length)call('repo_command',{command:'printf generated > generated.txt'})
  else answer('The check completed and generated.txt was created.')
 }else if(user==='Edit repository'||user==='Crash repository'){
  if(!outputs.length)call('repo_read',{project_id:project.id,path:'app.txt'})
  else if(outputs.length===1)call('repo_edit',{path:'app.txt',revision:JSON.parse(outputs[0].content).revision,old_string:user==='Crash repository'?'updated':'original',new_string:user==='Crash repository'?'changed before crash':'updated'})
  else if(user==='Crash repository')call('repo_command',{command:'printf staging > command-only.txt; sleep 20; printf late > never.txt'})
  else answer('Updated app.txt.')
 }else answer('Queued work finished.')
})
const bridge=expression=>evaluate(`(async()=>{const r=await(${expression});if(r==null)return;if(!r.ok)throw new Error(r.error);return r.value})()`)
async function click(label){await wait(()=>evaluate(`(()=>{const b=[...document.querySelectorAll('button,[role="option"]')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim().replace(/^■\\s*/,'')===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true})()`),`button ${label}`)}
async function send(text){await fill('textarea[aria-label=Message]',text,'textarea');await click('Send message');await wait(()=>evaluate(`document.querySelector('textarea[aria-label=Message]')?.value==='' && [...document.querySelectorAll('.messages article.user')].at(-1)?.textContent.includes(${JSON.stringify(text)})`),'submitted')}
const idle=(expectAnswer=true)=>wait(()=>evaluate(`document.querySelector('.messages')?.getAttribute('aria-busy')==='false' && !document.querySelector('.stop-button') && (${!expectAnswer} || [...document.querySelectorAll('.messages article.message')].at(-1)?.classList.contains('assistant'))`),'reply complete')
async function shot(name){const image=await desktop.rpc('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,`${name}.png`),Buffer.from(image.data,'base64'))}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 await desktop.launch()
 const seed=await evaluate(`(async()=>{const u=r=>{if(!r.ok)throw new Error(r.error);return r.value};const agent=u(await window.granite.agents.create('Repository demo'));const section=u(await window.granite.organization.createSection(agent.id,'Development','shared'));const project=u(await window.granite.organization.createProject(agent.id,section.id,'Website'));u(await window.granite.organization.createRepository(agent.id,project.id));u(await window.granite.harness.save(agent.id,{instructions:'',terminal:true,approveWrites:true,skills:true,mcpServers:[]}));const connection=u(await window.granite.connections.save({name:'Fixture',apiKey:'',baseUrl:'http://127.0.0.1:${server.address().port}/v1',model:'repo-ui',maxConcurrentRequests:2}));localStorage.setItem('granite.agent',agent.id);localStorage.setItem('granite.connection',connection.id);return {agent,section,project:u(await window.granite.organization.get(agent.id)).projects.find(p=>p.id===project.id)}})()`)
 ;({project,agent}=seed)
 await writeFile(join(project.repositoryPath,'app.txt'),'original\n')
 await desktop.rpc('Page.reload')
 await wait(()=>evaluate('document.querySelector("textarea[aria-label=Message]")?.disabled===false'),'composer')
 await click('New chat in Website');await send('Edit repository');await idle()
 await wait(()=>evaluate('document.querySelector(".repository-changes")?.textContent.includes("1 changed file")'),'change summary')
 assert.equal(await readFile(join(project.repositoryPath,'app.txt'),'utf8'),'updated\n')
 assert.equal(await evaluate('Boolean(document.querySelector(".approval-panel"))'),false)
 await evaluate('document.querySelector(".repository-changes > summary").click()')
 await evaluate('document.querySelector(".repository-file-change > summary").click()')
 await wait(()=>evaluate('document.querySelector(".repository-file-change pre")?.textContent.includes("-original")'),'inspectable diff')
 await shot('edit-and-diff')
 console.log('PASS: project reply, implicit editing grant, real file edit and visible +1/−1 diff')
 await click('New chat');await send('Outside edit');await idle()
 await click('Move into Website…');await click('Confirm permanent move')
 await wait(()=>evaluate('document.querySelector(".chat-breadcrumb")?.textContent.includes("Website")'),'permanent project entry')
 assert.ok(!requests.find(r=>r.messages.some(m=>m.content==='Outside edit')).tools.some(t=>t.function.name==='repo_write'))
 await send('Command check');await idle()
 assert.equal(await readFile(join(project.repositoryPath,'generated.txt'),'utf8'),'generated')
 await shot('project-entry-and-command')
 console.log('PASS: outside write unavailable, explicit permanent project entry, automatic confined command and imported output')
 await send('Interactive command');await idle()
 await wait(()=>evaluate(`document.querySelector('.messages')?.textContent.includes('The interactive command completed and its changes were applied.')`),'fully revealed interactive reply')
 assert.equal(await readFile(join(project.repositoryPath,'interactive.txt'),'utf8'),'demo-project')
 await evaluate('document.querySelector(".repository-changes > summary").click()')
 await wait(()=>evaluate('document.querySelector(".repository-change-panel")?.textContent.includes("Command · complete · changes applied")'),'command publication status')
 const commandText=await evaluate('document.querySelector(".repository-change-panel")?.textContent')
 assert.ok(commandText.includes('Project name?'))
 await evaluate(`[...document.querySelectorAll('.repository-change-panel .repository-file-change > summary')].find(summary=>summary.textContent.startsWith('Command ·')).click()`)
 await wait(()=>evaluate(`document.querySelector('.repository-change-panel pre[aria-label="Command output"]')?.getBoundingClientRect().height>0`),'visible command output')
 await shot('interactive-command-output')
 console.log('PASS: real PTY start/input/publication through model, worker, IPC and renderer; visible sanitized command output/status')
 await send('Question setup')
 await wait(()=>evaluate('Boolean(document.querySelector(".question-panel"))'),'pending question panel')
 await shot('question-pending')
 await click('Tailwind');await click('Send answer');await idle()
 await wait(()=>evaluate('document.querySelector(".messages")?.textContent.includes("I will use your selected styling.")'),'question answer resumed')
 assert.equal(await evaluate('Boolean(document.querySelector(".question-panel"))'),false)
 await send('Check the app');await idle()
 await wait(()=>evaluate('document.querySelector(".project-activity")?.textContent.includes("Local preview · ready")'),'agent-chosen ready preview without approval')
 assert.equal(await evaluate('Boolean(document.querySelector(".approval-panel"))'),false)
 await evaluate(`[...document.querySelectorAll('.preview-card > summary')][0].click()`)
 await shot('managed-preview')
 await wait(()=>evaluate(`Boolean([...document.querySelectorAll('.formatted-response a')].find(link=>link.textContent==='Open the app'))`),'chat preview link')
 const previewChatId=await evaluate('localStorage.getItem("granite.conversation."+localStorage.getItem("granite.agent"))')
 const pageUrl=await evaluate('window.location.href')
 await evaluate(`[...document.querySelectorAll('.formatted-response a')].find(link=>link.textContent==='Open the app').click()`)
 await wait(async()=>{
  const previews=await bridge(`window.granite.previews.list(${JSON.stringify(agent.id)},${JSON.stringify(previewChatId)})`)
  return previews?.some(preview=>preview.output.includes('request:/manual-link-check'))
 },'chat link opened in system browser')
 assert.equal(await evaluate('window.location.href'),pageUrl,'link never navigates Granite to external content')
 console.log('PASS: the Markdown preview link opens the system browser and reaches the preview route; Granite stays on its own page')
 await click('Stop preview')
 await wait(()=>evaluate('document.querySelector(".project-activity")?.textContent.includes("Local preview · stopped")'),'explicit preview stop')
 console.log('PASS: question options/free-text UI resumes the same task; ready local preview survives reply and explicit Stop cleans it')
 await click('New chat in Website');await send('Hold repository')
 await wait(()=>evaluate('document.querySelector(".messages")?.textContent.includes("Holding project")'),'active reservation')
 await click('New chat in Website');await send('Queued repository')
 await wait(()=>evaluate('document.querySelector(".run-status-bar")?.textContent.includes("Queued for repository project")'),'project queue')
 await shot('project-queue')
 await click('Hold repository');await click('Stop');await idle(false)
 await click('Queued repository');await idle()
 console.log('PASS: project queue is visible and starts after Stop releases the reservation')
 await click('New chat in Website');await send('Crash repository')
 const electron='./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
 let pending
 await wait(()=>{
  const raw=execFileSync(electron,['-e',`const Database=require('better-sqlite3');const db=new Database(process.argv[1],{readonly:true});const row=db.prepare('SELECT data FROM repository_runs ORDER BY rowid DESC LIMIT 1').get();console.log(row?.data??'null');db.close()`,join(profile,'atlas.sqlite')],{encoding:'utf8',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','ignore']})
  pending=JSON.parse(raw)?.pending
  return Boolean(pending?.process && pending?.workspace)
 },'durable command process')
 assert.equal(await readFile(join(project.repositoryPath,'app.txt'),'utf8'),'changed before crash\n')
 const worker=Number(execFileSync('/bin/ps',['-p',String(pending.process.pid),'-o','ppid='],{encoding:'utf8'}).trim())
 assert.ok(worker>1&&worker!==process.pid)
 const command=execFileSync('/bin/ps',['-p',String(worker),'-o','command='],{encoding:'utf8'})
 assert.match(command,/Granite|Electron|Helper/)
 const count=requests.length
 process.kill(worker,'SIGKILL')
 await wait(()=>evaluate('Boolean(document.querySelector(".recovery-dialog"))'),'worker crash recovery popup')
 assert.equal(requests.length,count,'recovery does not dispatch another model request')
 await click('OK')
 assert.equal(await readFile(join(project.repositoryPath,'app.txt'),'utf8'),'changed before crash\n')
 await assert.rejects(lstat(join(project.repositoryPath,'command-only.txt')),{code:'ENOENT'})
 await assert.rejects(lstat(join(project.repositoryPath,'never.txt')),{code:'ENOENT'})
 await shot('recovered-kept-changes')
 console.log('PASS: real worker crash, owned command settlement, recovery popup, completed native edit kept, unfinished command copy not imported, no replay')
 await writeFile(join(directory,'requests.json'),JSON.stringify(requests,null,2))
 console.log(`Evidence: ${directory}`)
}finally{
 await desktop.quit();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
}
