import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { repositoryAccess } from '../src/backend/repositories/access.ts'
import { RepositoryPaths } from '../src/backend/repositories/paths.ts'
import { scanTree } from '../src/backend/repositories/changes.ts'
import { RepositorySession, StaleRepositoryEdit } from '../src/backend/repositories/session.ts'
import { repositoryTools } from '../src/backend/harness/tools/repository.ts'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'granite-repository-test-'))
  const data = join(directory, 'profile'), root = join(directory, 'repo')
  await mkdir(root)
  const runtime = await AgentRuntime.open(data)
  const canonicalData = await (await import('node:fs/promises')).realpath(data)
  const canonicalRoot = await (await import('node:fs/promises')).realpath(root)
  const agent = await runtime.createAgent('Repo fixture')
  const section = await runtime.createSection(agent.id, 'Shared', 'shared')
  const project = await runtime.createProject(agent.id, section.id, 'Repository')
  await runtime.attachRepository(agent.id, project.id, root)
  const chat = await runtime.createConversation(agent.id, { sectionId: section.id, projectId: project.id })
  const record = { runId: 'fixture', agentId: agent.id, conversationId: chat.id, projectId: project.id, root: canonicalRoot,
    baseline: await scanTree(new RepositoryPaths(canonicalRoot, canonicalData)), touched: [],
    report: { runId: 'fixture', projectId: project.id, name: project.name, state: 'active' as const, changes: [], preExisting: 0 } }
  runtime.repositories.save(record)
  const controller = new AbortController()
  const session = new RepositorySession(record, runtime.repositories, controller.signal, () => {})
  return { runtime, directory, root: canonicalRoot, data: canonicalData, agent, section, project, chat, session, controller,
    async close() { await runtime.stopAll(); runtime.close(); await rm(directory, { recursive: true, force: true }) } }
}

test('repository file tools preserve stale content, binary files, renames and run-local diffs', async () => {
  const f = await fixture()
  try {
    await f.session.write('src/example.ts', Buffer.from('one\ntwo\n'), null)
    let current = await f.session.read('src/example.ts')
    await f.session.edit('src/example.ts', 'two', 'three', false, current.revision)
    current = await f.session.read('src/example.ts')
    await f.session.patch('src/example.ts', '@@ -1,2 +1,2 @@\n one\n-three\n+four', current.revision)
    current = await f.session.read('src/example.ts')
    await f.session.move('src/example.ts', 'src/renamed.ts', current.revision)
    assert.equal(await readFile(join(f.root,'src/renamed.ts'),'utf8'),'one\nfour\n')
    const binary = Buffer.from([0, 1, 255])
    await f.session.write('image.bin', binary, null)
    const b = await f.session.read('image.bin')
    assert.equal(b.binary,true)
    await f.session.write('image.bin', Buffer.from([0,2,255]), b.revision)
    current = await f.session.read('src/renamed.ts')
    await writeFile(join(f.root,'src/renamed.ts'),'external change\n')
    await assert.rejects(f.session.write('src/renamed.ts',Buffer.from('overwrite'),current.revision),StaleRepositoryEdit)
    assert.equal(await readFile(join(f.root,'src/renamed.ts'),'utf8'),'external change\n')
    const fresh=await f.session.read('src/renamed.ts')
    await f.session.remove('src/renamed.ts',fresh.revision)
    assert.equal(f.session.record.report.changes.find(change=>change.path==='image.bin')?.binary,true)
    assert.equal(f.session.record.report.changes.some(change=>change.path==='src/example.ts'||change.path==='src/renamed.ts'),false,'create then delete leaves no final change')
    await assert.rejects(f.session.write('../escape',Buffer.from('bad'),null))
    await assert.rejects(f.session.write('.git/config',Buffer.from('bad'),null))
    await symlink(f.directory,join(f.root,'escape'))
    await assert.rejects(f.session.write('escape/nope',Buffer.from('bad'),null))
    await symlink(join(f.root,'image.bin'),join(f.root,'alias'))
    await assert.rejects(f.session.read('alias'))
  } finally { await f.close() }
})

test('repository access is agent/section/member scoped and outside tools expose no mutations', async () => {
  const f=await fixture()
  try {
    const closed=await f.runtime.createSection(f.agent.id,'Closed','closed')
    const privateProject=await f.runtime.createProject(f.agent.id,closed.id,'Private repo')
    const privateRoot=join(f.directory,'private-repo');await mkdir(privateRoot)
    await f.runtime.attachRepository(f.agent.id,privateProject.id,privateRoot)
    const general=await f.runtime.createConversation(f.agent.id)
    const closedChat=await f.runtime.createConversation(f.agent.id,{sectionId:closed.id,projectId:null})
    const second=await f.runtime.createAgent('Other')
    const otherChat=await f.runtime.createConversation(second.id)
    assert.deepEqual(repositoryAccess(f.runtime.store,f.data,second.id,otherChat.id),[])
    const publicAccess=repositoryAccess(f.runtime.store,f.data,f.agent.id,general.id)
    assert.equal(publicAccess.length,1);assert.equal(publicAccess[0].writable,false)
    assert.equal(repositoryAccess(f.runtime.store,f.data,f.agent.id,closedChat.id).length,2)
    assert.equal(repositoryAccess(f.runtime.store,f.data,f.agent.id,f.chat.id)[0].writable,true)
    const tools=repositoryTools({signal:f.controller.signal,access:()=>publicAccess,userMessages:()=>[],requestEntry:()=>{}})
    assert.ok(!tools.some(tool=>['repo_write','repo_edit','repo_patch','repo_rename','repo_delete','repo_command'].includes(tool.name)))
    assert.ok(!JSON.stringify(tools.find(tool=>tool.name==='repo_git')!.parameters).includes('commit'))
    await assert.rejects(tools.find(tool=>tool.name==='repo_read')!.run({project_id:privateProject.id,path:'secret'}),/unavailable/)
    await assert.rejects(f.runtime.attachRepository(f.agent.id,privateProject.id,f.data))
  }finally{await f.close()}
})

test('repository diffs exclude unchanged pre-existing edits and survive reopening', async()=>{
  const f=await fixture()
  try{
    await writeFile(join(f.root,'preexisting.txt'),'already dirty\n')
    await writeFile(join(f.root,'edit.txt'),'starting dirty\n')
    f.session.record.baseline=await scanTree(f.session.paths)
    const read=await f.session.read('edit.txt')
    await f.session.edit('edit.txt','starting','finished',false,read.revision)
    assert.equal(f.session.record.report.changes.length,1)
    assert.equal(f.session.record.report.changes[0].path,'edit.txt')
    assert.equal(f.session.record.report.changes[0].added,1)
    assert.equal(f.session.record.report.changes[0].removed,1)
    await f.runtime.repositories.recover(f.session.record)
    assert.equal(f.session.record.report.state,'settled')
    assert.equal(await readFile(join(f.root,'edit.txt'),'utf8'),'finished dirty\n')
  }finally{await f.close()}
})

test('sandboxed repository commands track changes, protect Git/private paths and settle on Stop', {skip:process.platform!=='darwin',timeout:20000}, async()=>{
  const f=await fixture()
  try{
    execFileSync('/usr/bin/git',['init','-q',f.root])
    const result=await f.session.command('/bin/sh',['-c','printf hello > built.txt; printf done'])
    assert.equal(result.exitCode,0,JSON.stringify(result));assert.equal(result.output,'done')
    assert.equal(f.session.record.report.changes[0].path,'built.txt')
    const denied=await f.session.command('/bin/sh',['-c',`printf bad > .git/config; cat '${f.data}/atlas.sqlite'`])
    assert.notEqual(denied.exitCode,0)
    assert.ok(!((await readFile(join(f.root,'.git/config'),'utf8')).startsWith('bad')))
    const detach=await f.session.command('/usr/bin/perl',['-MPOSIX','-e','my $id=POSIX::setsid(); print defined($id)?$id:"denied";'])
    assert.equal(detach.exitCode,0,'A detached subprocess is confined to the temporary copy')
    const active=f.session.command('/bin/sh',['-c','printf started > started.txt; sleep 20; printf late > late.txt'])
    for(let i=0;i<100&&!f.session.record.pending?.process;i++)await new Promise(r=>setTimeout(r,20))
    await new Promise(r=>setTimeout(r,50))
    f.controller.abort()
    await assert.rejects(active)
    await assert.rejects(lstat(join(f.root,'late.txt')),{code:'ENOENT'})
    assert.equal(await readFile(join(f.root,'built.txt'),'utf8'),'hello')
  }finally{await f.close()}
})

test('authorized Git mutations publish metadata without running hooks or exposing mutations outside the project', {skip:process.platform!=='darwin'}, async()=>{
 const f=await fixture()
 try{
  const tools=repositoryTools({signal:f.controller.signal,owner:f.session,access:()=>repositoryAccess(f.runtime.store,f.data,f.agent.id,f.chat.id),userMessages:()=>['commit the work'],requestEntry:()=>{}})
  const git=tools.find(tool=>tool.name==='repo_git')!
  const args=(operation:string,extra:Record<string,unknown>={})=>({project_id:f.project.id,operation,paths:[],remote:'origin',...extra})
  assert.ok(await git.approval!(args('init')),'initialization needs explicit authorization')
  assert.equal((await git.run(args('init')) as any).exitCode,0)
  execFileSync('/usr/bin/git',['-C',f.root,'config','user.name','Fixture'])
  execFileSync('/usr/bin/git',['-C',f.root,'config','user.email','fixture@example.test'])
  await writeFile(join(f.root,'main.txt'),'commit me\n')
  await writeFile(join(f.root,'.git/hooks/pre-commit'),'#!/bin/sh\nprintf unsafe > hook-ran\n',{mode:0o755})
  assert.equal(await git.approval!(args('add',{paths:['main.txt']})),null,'a requested commit permits necessary staging')
  assert.equal((await git.run(args('add',{paths:['main.txt']})) as any).exitCode,0)
  assert.equal(await git.approval!(args('commit',{message:'Fixture commit'})),null)
  const committed=await git.run(args('commit',{message:'Fixture commit'})) as any
  assert.equal(committed.exitCode,0,JSON.stringify(committed))
  assert.match(execFileSync('/usr/bin/git',['-C',f.root,'log','-1','--oneline'],{encoding:'utf8'}),/Fixture commit/)
  await assert.rejects(lstat(join(f.root,'hook-ran')),{code:'ENOENT'})
  assert.equal(f.session.record.report.gitChanged,true)
 }finally{await f.close()}
})

test('unfinished external actions remain blocked until an explicit review; recovery never restores edits',async()=>{
 const f=await fixture()
 try{
  await f.session.write('kept.txt',Buffer.from('kept\n'),null)
  f.session.record.pending={kind:'command',external:true}
  f.runtime.repositories.save(f.session.record)
  await f.runtime.repositories.recover(f.session.record)
  assert.equal(f.session.record.report.state,'attention')
  assert.throws(()=>f.runtime.repositories.assertAvailable(f.project.id),/unresolved/)
  const alias=await f.runtime.createProject(f.agent.id,f.section.id,'Alias')
  await f.runtime.attachRepository(f.agent.id,alias.id,f.root)
  assert.throws(()=>f.runtime.repositories.assertAvailable(alias.id),/unresolved/,'genuine unknown outcomes also protect linked aliases')
  await assert.rejects(f.runtime.deleteConversation(f.agent.id,f.chat.id),/recovery records/)
  await f.runtime.repositories.recover(f.session.record,true)
  assert.equal(f.session.record.report.state,'settled')
  assert.equal(await readFile(join(f.root,'kept.txt'),'utf8'),'kept\n')
  await f.runtime.deleteConversation(f.agent.id,f.chat.id)
  assert.equal(f.runtime.repositories.records().length,0)
 }finally{await f.close()}
})

test('command copies reject concurrent live edits before importing any file and detached commands cannot write the live root', {skip:process.platform!=='darwin'}, async()=>{
 const f=await fixture()
 try{
  await writeFile(join(f.root,'existing.txt'),'before\n')
  f.session.record.baseline=await scanTree(f.session.paths)
  const running=f.session.command('/bin/sh',['-c','sleep 0.2; printf command > existing.txt; printf generated > new.txt'])
  for(let i=0;i<100&&!f.session.record.pending?.process;i++)await new Promise(r=>setTimeout(r,10))
  await writeFile(join(f.root,'existing.txt'),'user update\n')
  await assert.rejects(running,StaleRepositoryEdit)
  assert.equal(await readFile(join(f.root,'existing.txt'),'utf8'),'user update\n')
  await assert.rejects(lstat(join(f.root,'new.txt')),{code:'ENOENT'})
  const detached=await f.session.command('/usr/bin/perl',['-MPOSIX','-e',`POSIX::setsid(); open(my $f,">",${JSON.stringify(join(f.root,'escaped.txt'))}) or die "blocked"; print $f "bad";`])
  assert.notEqual(detached.exitCode,0)
  await assert.rejects(lstat(join(f.root,'escaped.txt')),{code:'ENOENT'})
 }finally{await f.close()}
})

test('finished commands preserve executable bits and large generated outputs', {skip:process.platform!=='darwin'},async()=>{
 const f=await fixture()
 try{
  await writeFile(join(f.root,'script.sh'),'#!/bin/sh\nprintf ok\n',{mode:0o644})
  await symlink('script.sh',join(f.root,'script-link.sh'))
  f.session.record.baseline=await scanTree(f.session.paths)
  const result=await f.session.command('/bin/sh',['-c','chmod +x script.sh; ./script-link.sh > link-output.txt; /usr/bin/perl -e \'open(my $f, ">", "bundle.js") or die $!; truncate($f, 129000001) or die $!;\''])
  assert.equal(result.exitCode,0)
  assert.ok((await lstat(join(f.root,'script.sh'))).mode & 0o100)
  assert.equal(await readFile(join(f.root,'link-output.txt'),'utf8'),'ok')
  assert.equal((await lstat(join(f.root,'bundle.js'))).size,129000001)
  assert.equal(f.session.record.report.changes.find(change=>change.path==='script.sh')?.modeChanged,true)
  assert.equal(f.session.record.report.changes.find(change=>change.path==='bundle.js')?.large,true)
 }finally{await f.close()}
})

test('command copies import empty directory changes without deleting concurrent files', {skip:process.platform!=='darwin'},async()=>{
 const f=await fixture()
 try{
  await mkdir(join(f.root,'old-folder'));f.session.record.baseline=await scanTree(f.session.paths)
  assert.equal((await f.session.command('/bin/sh',['-c','rmdir old-folder; mkdir -p new-folder/empty'])).exitCode,0)
  await assert.rejects(lstat(join(f.root,'old-folder')),{code:'ENOENT'})
  assert.equal((await lstat(join(f.root,'new-folder/empty'))).isDirectory(),true)
  assert.equal(f.session.record.report.changes.find(change=>change.path==='old-folder')?.kind,'deleted')
  assert.equal(f.session.record.report.changes.find(change=>change.path==='new-folder/empty')?.directory,true)
 }finally{await f.close()}
})
