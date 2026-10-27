import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import type { RepositoryRecord } from '../src/backend/repositories/store.ts'
const mac={skip:process.platform!=='darwin'}
async function fixture(){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'granite-preview-test-'))),runtime=await AgentRuntime.open(join(directory,'profile'))
 const agent=await runtime.createAgent('Developer'),section=await runtime.createSection(agent.id,'Code','shared'),project=await runtime.createProject(agent.id,section.id,'App')
 const root=join(directory,'repository');await mkdir(root);await writeFile(join(root,'app.txt'),'original')
 await runtime.attachRepository(agent.id,project.id,root)
 const chat=await runtime.createConversation(agent.id,{sectionId:section.id,projectId:project.id})
 const source:RepositoryRecord={runId:'preview-source',agentId:agent.id,conversationId:chat.id,projectId:project.id,root,baseline:{},touched:[],report:{runId:'preview-source',projectId:project.id,name:'App',state:'settled',changes:[],preExisting:0}}
 return {runtime,root,agent,section,project,chat,source,async close(){await runtime.stopAll();runtime.close();await rm(directory,{recursive:true,force:true})}}
}
const command=`node -e 'const fs=require("node:fs"),http=require("node:http");fs.writeFileSync("server-only.txt","staged");http.createServer((q,r)=>r.end(fs.readFileSync("app.txt"))).listen(Number(process.env.PORT),process.env.HOST,()=>console.log("listening"))'`
async function ready(f:Awaited<ReturnType<typeof fixture>>,id:string){
 for(let i=0;i<100;i++){const state=await f.runtime.previews.read(f.agent.id,f.chat.id,id,100);if(state.status==='ready')return state;if(state.status==='failed')throw new Error(JSON.stringify(state))}throw new Error('Preview readiness timed out')
}

test('managed preview verifies real readiness, isolates writes, labels stale code and refreshes from latest snapshot',mac,async()=>{
 const f=await fixture()
 try{
  const started=await f.runtime.previews.start(f.source,command,'',0,new AbortController().signal)
  const state=await ready(f,started.id)
  assert.equal(await (await fetch(state.url)).text(),'original')
  await assert.rejects(lstat(join(f.root,'server-only.txt')),{code:'ENOENT'})
  const other=await f.runtime.createConversation(f.agent.id,{sectionId:f.section.id,projectId:f.project.id})
  await assert.rejects(f.runtime.previews.read(f.agent.id,other.id,state.id),/unavailable/)
  await writeFile(join(f.root,'app.txt'),'newer')
  const stale=await f.runtime.previews.read(f.agent.id,f.chat.id,state.id)
  assert.equal(stale.stale,true);assert.equal(await (await fetch(state.url)).text(),'original')
  const refreshed=await f.runtime.previews.restart(f.agent.id,f.chat.id,state.id,new AbortController().signal)
  const current=await ready(f,refreshed.id)
  assert.notEqual(current.revision,state.revision);assert.equal(current.stale,false)
  assert.equal(await(await fetch(current.url)).text(),'newer')
  await f.runtime.previews.stop(f.agent.id,f.chat.id,current.id)
  await assert.rejects(fetch(current.url))
  assert.equal(await readFile(join(f.root,'app.txt'),'utf8'),'newer')
 }finally{await f.close()}
})

test('local-preview scope rejects nonloopback listening and public outbound traffic',mac,async()=>{
 const f=await fixture()
 try{
  const isolated=`node -e 'const net=require("node:net"),http=require("node:http");const bad=net.createServer();bad.on("error",e=>console.log("public-bind:"+e.code));bad.listen(Number(process.env.PORT)+1,"0.0.0.0");const s=net.connect({host:"1.1.1.1",port:80});s.on("error",e=>console.log("public-outbound:"+e.code));s.setTimeout(1000,()=>s.destroy());http.createServer((q,r)=>r.end("ok")).listen(Number(process.env.PORT),process.env.HOST)'`
  const started=await f.runtime.previews.start(f.source,isolated,'',0,new AbortController().signal)
  const state=await ready(f,started.id)
  assert.match(state.output,/public-bind:EPERM/)
  assert.match(state.output,/public-outbound:EPERM/)
 }finally{await f.close()}
})


test('owner process death interrupts a real ready preview; reopening settles storage without replay',mac,async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'granite-preview-crash-')))
 const {spawn}=await import('node:child_process')
 const child=spawn(process.execPath,['--experimental-strip-types','tests/fixtures/preview-parent.ts',directory],{stdio:['ignore','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}})
 let runtime:AgentRuntime|undefined
 try{
  const info=await new Promise<any>((resolve,reject)=>{let text='',errors='';child.stdout.on('data',chunk=>{text+=chunk.toString();const line=text.split('\n').find(line=>line.startsWith('{'));if(line)resolve(JSON.parse(line))});child.stderr.on('data',chunk=>errors+=chunk.toString());child.once('exit',()=>reject(new Error(errors)));setTimeout(()=>reject(new Error('Preview owner did not start: '+errors)),10000).unref()})
  assert.equal(await(await fetch(info.preview.url)).text(),'live')
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited
  runtime=await AgentRuntime.open(join(directory,'profile'))
  await assert.rejects(fetch(info.preview.url))
  const preview=runtime.previews.list(info.agentId,info.chatId)[0]
  assert.equal(preview.status,'interrupted',JSON.stringify(preview))
  assert.match(preview.error!,/Restart/)
  assert.equal(runtime.recovery().previews,1)
  runtime.previews.dismissRecovery()
  assert.equal(runtime.recovery().previews,0,'dismissed known interruptions do not show the restart popup forever')
  assert.equal(runtime.previews.list(info.agentId,info.chatId)[0].status,'interrupted','dismissal never restarts the server')
  const records=runtime.store.saver.db.prepare('SELECT data FROM repository_previews').all()as{data:string}[]
  const record=JSON.parse(records[0].data)
  assert.equal(record.process,undefined);assert.equal(record.workspace,undefined);assert.equal(record.home,undefined)
 }finally{child.kill('SIGKILL');await runtime?.stopAll();runtime?.close();await rm(directory,{recursive:true,force:true})}
})

test('Stop fences a pending preview start before it can escape shutdown tracking',mac,async()=>{
 const f=await fixture()
 try{
  const pending=f.runtime.previews.start(f.source,command,'',0,new AbortController().signal)
  void pending.catch(()=>{})
  assert.throws(()=>f.runtime.previews.start(f.source,command,'',0,new AbortController().signal),/already being prepared/)
  await f.runtime.previews.stopAll()
  await pending.catch(()=>{})
  assert.equal(f.runtime.previews.hasActive(),false)
  assert.ok(f.runtime.previews.list(f.agent.id,f.chat.id).every(preview=>!['ready','starting'].includes(preview.status)))
 }finally{await f.close()}
})
