import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, rm, link, truncate } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { defaultHarnessSettings } from '../src/shared/harness.ts'

const chunk=(res:ServerResponse,delta:unknown,finish_reason:string|null=null)=>res.write(`data: ${JSON.stringify({choices:[{delta,finish_reason}]})}\n\n`)
const answer=(res:ServerResponse,text='Done')=>{chunk(res,{content:text});chunk(res,{},'stop');res.end('data: [DONE]\n\n')}
let sequence=0
const call=(res:ServerResponse,name:string,args:unknown)=>{chunk(res,{tool_calls:[{index:0,id:`repo-call-${++sequence}`,function:{name,arguments:JSON.stringify(args)}}]});chunk(res,{},'tool_calls');res.end('data: [DONE]\n\n')}
async function until(check:()=>boolean|Promise<boolean>){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,10))}throw new Error('Fixture boundary timed out')}
async function fixture(handler:(body:any,res:ServerResponse)=>void){
 const directory=await mkdtemp(join(tmpdir(),'granite-repo-runtime-'))
 const runtime=await AgentRuntime.open(join(directory,'profile'))
 const agent=await runtime.createAgent('Developer'),section=await runtime.createSection(agent.id,'Code','shared')
 const project=await runtime.createProject(agent.id,section.id,'Website')
 const root=join(directory,'repo');await mkdir(root);await writeFile(join(root,'app.txt'),'original\n')
 await runtime.attachRepository(agent.id,project.id,root)
 const chat=await runtime.createConversation(agent.id,{sectionId:section.id,projectId:project.id})
 const requests:any[]=[]
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);res.setHeader('Content-Type','text/event-stream');handler(body,res)})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 const connection={baseUrl:`http://127.0.0.1:${(server.address()as any).port}/v1`,apiKey:'',model:'repo-fixture',maxConcurrentRequests:2}
 return {runtime,directory,agent,section,project,root,chat,requests,connection,async close(){await runtime.stopAll();runtime.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(directory,{recursive:true,force:true})}}
}

test('a repository run reads then edits without per-edit approval and publishes an inspectable run diff',async()=>{
 let projectId=''
 const f=await fixture((body,res)=>{
  const result=body.messages.filter((m:any)=>m.role==='tool').at(-1)
  if(!result)call(res,'repo_read',{project_id:projectId,path:'app.txt'})
  else if(body.messages.filter((m:any)=>m.role==='tool').length===1){const read=JSON.parse(result.content);call(res,'repo_edit',{path:'app.txt',revision:read.revision,old_string:'original',new_string:'updated'})}
  else answer(res,'Updated the app')
 })
 projectId=f.project.id
 try{
  await f.runtime.saveSettings(f.agent.id,{...defaultHarnessSettings,approveWrites:true})
  let approvals=0
  await f.runtime.run('edit',f.agent.id,f.chat.id,f.connection,'Update app.txt',delta=>{if(delta.approval)approvals++})
  assert.equal(approvals,0)
  assert.equal(await readFile(join(f.root,'app.txt'),'utf8'),'updated\n')
  const report=f.runtime.repositories.reports(f.agent.id,f.chat.id)[0]
  assert.equal(report.state,'settled');assert.equal(report.changes.length,1)
  assert.equal(report.changes[0].added,1);assert.equal(report.changes[0].removed,1)
  assert.match(report.changes[0].diff,/-original\n\+updated/)
  assert.equal(f.runtime.listRuns()[0].repository?.files,1)
 }finally{await f.close()}
})

test('repository chats reply and edit source without scanning large or hard-linked installed dependencies',async()=>{
 let projectId=''
 const f=await fixture((body,res)=>{
  const user=body.messages.filter((m:any)=>m.role==='user').at(-1).content
  if(user==='Hello'){answer(res,'Hello from the project');return}
  const tools=body.messages.filter((m:any)=>m.role==='tool')
  if(!tools.length)call(res,'repo_read',{project_id:projectId,path:'app.txt'})
  else if(tools.length===1)call(res,'repo_edit',{path:'app.txt',revision:JSON.parse(tools[0].content).revision,old_string:'original',new_string:'updated'})
  else answer(res,'Source updated')
 })
 projectId=f.project.id
 try{
  const dependencies=join(f.root,'node_modules','esbuild','bin')
  await mkdir(dependencies,{recursive:true})
  await writeFile(join(dependencies,'esbuild'),'dependency executable')
  await link(join(dependencies,'esbuild'),join(dependencies,'esbuild-alias'))
  const large=join(f.root,'node_modules','large-cache')
  await writeFile(large,'');await truncate(large,140_000_000)
  await writeFile(join(f.root,'.gitignore'),'node_modules/\n')
  execFileSync('/usr/bin/git',['init','-q',f.root])
  await f.runtime.run('hello-dependencies',f.agent.id,f.chat.id,f.connection,'Hello',()=>{})
  assert.equal(f.runtime.listRuns().find(r=>r.id==='hello-dependencies')?.phase,'complete')
  assert.equal(f.runtime.store.get(f.agent.id,f.chat.id).messages.at(-1)?.content,'Hello from the project')
  const editing=await f.runtime.createConversation(f.agent.id,{sectionId:f.section.id,projectId:f.project.id})
  await f.runtime.run('edit-dependencies',f.agent.id,editing.id,f.connection,'Update app.txt',()=>{})
  assert.equal(await readFile(join(f.root,'app.txt'),'utf8'),'updated\n')
  const report=f.runtime.repositories.reports(f.agent.id,editing.id)[0]
  assert.equal(report.state,'settled')
  assert.deepEqual(report.changes.map(change=>change.path),['app.txt'])
  assert.match(report.changes[0].diff,/-original\n\+updated/)
  assert.equal(await readFile(join(dependencies,'esbuild'),'utf8'),'dependency executable')
  assert.equal(f.runtime.repositories.records().find(r=>r.runId==='hello-dependencies')?.touched.length,0)
 }finally{await f.close()}
})

test('outside requests cannot invoke remembered mutation tools and project entry is only a proposal',async()=>{
 let projectId=''
 const f=await fixture((body,res)=>{
  const last=body.messages.at(-1)
  if(last.role==='user')call(res,'repo_write',{path:'app.txt',content:'forbidden',revision:null})
  else if(body.messages.filter((m:any)=>m.role==='tool').length===1)call(res,'request_repository_edit',{project_id:projectId})
  else answer(res,'Please move this chat into the project first.')
 })
 projectId=f.project.id
 try{
  const outside=await f.runtime.createConversation(f.agent.id)
  await f.runtime.run('outside',f.agent.id,outside.id,f.connection,'Edit the website',()=>{})
  const names=f.requests[0].tools.map((t:any)=>t.function.name)
  assert.ok(!names.includes('repo_write'));assert.ok(names.includes('repo_read'))
  assert.equal(await readFile(join(f.root,'app.txt'),'utf8'),'original\n')
  assert.equal(f.runtime.store.get(f.agent.id,outside.id).projectId,null)
  assert.equal(f.runtime.listRuns().find(r=>r.id==='outside')?.projectEntry?.projectId,f.project.id)
 }finally{await f.close()}
})

test('same-project runs serialize across model requests but separately linked projects can run concurrently',async()=>{
 const held:ServerResponse[]=[]
 const f=await fixture((_body,res)=>{held.push(res);chunk(res,{content:'Working'})})
 try{
  const b=await f.runtime.createConversation(f.agent.id,{sectionId:f.section.id,projectId:f.project.id})
  const other=await f.runtime.createProject(f.agent.id,f.section.id,'Second link')
  await f.runtime.attachRepository(f.agent.id,other.id,f.root)
  const c=await f.runtime.createConversation(f.agent.id,{sectionId:f.section.id,projectId:other.id})
  const aRun=f.runtime.run('first',f.agent.id,f.chat.id,f.connection,'First',()=>{})
  await until(()=>held.length===1)
  const bRun=f.runtime.run('second',f.agent.id,b.id,f.connection,'Second',()=>{})
  await until(()=>f.runtime.listRuns().find(r=>r.id==='second')?.queue?.reason==='Queued for repository project')
  const cRun=f.runtime.run('duplicate-project',f.agent.id,c.id,f.connection,'Independent link',()=>{})
  await until(()=>held.length===2)
  assert.equal(f.requests.length,2)
  answer(held[0]);await aRun
  await until(()=>held.length===3)
  assert.equal(f.requests.at(-1).messages.filter((m:any)=>m.role==='user').at(-1).content,'Second')
  answer(held[1]);answer(held[2]);await cRun;await bRun
 }finally{await f.close()}
})

test('stale edits receive one corrected attempt without overwriting external changes',async()=>{
 let projectId='',revision=''
 const f=await fixture((body,res)=>{
  const count=body.messages.filter((m:any)=>m.role==='tool').length
  if(count===0)call(res,'repo_read',{project_id:projectId,path:'app.txt'})
  else if(count===1){revision=JSON.parse(body.messages.at(-1).content).revision;void writeFile(join(f.root,'app.txt'),'external\n').then(()=>call(res,'repo_edit',{path:'app.txt',revision,old_string:'original',new_string:'bad'}))}
  else if(count===2){assert.match(body.messages.at(-1).content,/Stale/);call(res,'repo_read',{project_id:projectId,path:'app.txt'})}
  else if(count===3)call(res,'repo_edit',{path:'app.txt',revision:JSON.parse(body.messages.at(-1).content).revision,old_string:'external',new_string:'corrected'})
  else answer(res)
 })
 projectId=f.project.id
 try{await f.runtime.run('stale',f.agent.id,f.chat.id,f.connection,'Update',()=>{});assert.equal(await readFile(join(f.root,'app.txt'),'utf8'),'corrected\n')}
 finally{await f.close()}
})
