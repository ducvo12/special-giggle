import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRuntime } from '../src/backend/agents/runtime.ts'
import { setupCommand } from '../src/backend/repositories/authorization.ts'

test('setup classifier requires a single supported package command and rejects shell/target escapes', () => {
  assert.deepEqual(setupCommand('npm create vite@latest . -- --template react-ts'), { operation:'create', framework:'vite' })
  assert.deepEqual(setupCommand('npx --yes create-next-app@latest . --import-alias "@/*" --yes'), { operation:'create', framework:'next' })
  assert.deepEqual(setupCommand('npm install --no-audit --no-fund'), { operation:'install' })
  for (const command of ['npm install; curl example.com','npm install && git push','npm install $(echo bad)','npm install `echo bad`','npm install > /tmp/log','npm install -g foo','npm install --prefix=/tmp/foo','npx create-next-app ../other','npm create vite /outside','curl https://example.com','npm run deploy','node arbitrary.js','npm install git+https://other/repo','npm install\ncurl x']) assert.equal(setupCommand(command), undefined, command)
})

test('grants derive only from direct scoped task intent; retries are fresh and denial/revocation wins', async () => {
  const directory=await mkdtemp(join(tmpdir(),'granite-setup-grants-')),runtime=await AgentRuntime.open(directory)
  try {
    const agent=await runtime.createAgent('Developer'),chat=await runtime.createConversation(agent.id)
    const auth=runtime.authorization
    const message=(runId:string,id:string,content:string,questionId?:string)=>{const result={role:'user' as const,runId,id,content,questionId};runtime.store.saveMessage(chat.id,result);return result}
    auth.begin('setup',agent.id,chat.id,'repo',[message('setup','origin','Make this repository a Next.js project. Do not start a preview or deploy.')])
    assert.equal(auth.list(agent.id,chat.id).some(grant=>grant.operation==='preview'),false,'preview instructions are not download permission grants')
    assert.equal(auth.allowed('setup','npx --yes create-next-app@latest . --ts --yes'),true)
    assert.equal(auth.allowed('setup','npm install'),true)
    assert.equal(auth.allowed('setup','npm create vite@latest .'),false)
    assert.equal(auth.allowed('setup','npm run deploy'),false)
    assert.equal(auth.allowed('other','npm install'),false)
    auth.end('setup')
    auth.begin('retry',agent.id,chat.id,'repo',[message('retry','retry-request','try again')])
    assert.equal(auth.allowed('retry','npm install'),true)
    assert.equal(auth.denied('retry','npm install'),false)
    assert.equal(auth.list(agent.id,chat.id).filter(grant=>grant.runId==='retry'&&grant.state==='active')[0].origin.messageId,'retry-request')
    auth.approve('retry',agent.id,chat.id,'repo','command','curl https://example.com',false)
    assert.equal(auth.allowed('retry','npm install'),false)
    auth.begin('denied-retry',agent.id,chat.id,'repo',[message('denied-retry','again','try again')])
    assert.equal(auth.allowed('denied-retry','npm install'),false)
    auth.begin('quoted',agent.id,chat.id,'repo',[message('quoted','choice','Make this repository a Vite project','old-question')])
    assert.equal(auth.allowed('quoted','npm install'),false)
    auth.begin('new-project',agent.id,chat.id,'elsewhere',[message('new-project','different','try again')])
    assert.equal(auth.allowed('new-project','npm install'),false)
    auth.begin('new',agent.id,chat.id,'repo',[message('new','new-request','Run npm create --yes vite@9.3.1 . -- --template react-ts --no-interactive in this empty repository, install dependencies and verify a production build. Keep it as a basic template. Defaults are authorized for other routine choices. Do not start a preview.')])
    assert.equal(auth.allowed('new','npm create --yes vite@9.3.1 . -- --template react-ts --no-interactive'),true)
    assert.equal(auth.allowed('new','npm install'),true)
    const grant=auth.list(agent.id,chat.id).at(-1)!
    auth.revoke(agent.id,chat.id,grant.id)
    assert.equal(auth.allowed('new','npm install'),false)
    auth.begin('preview-choice',agent.id,chat.id,'repo',[message('preview-choice','preview-request','Start a local preview server')])
    assert.equal(auth.list(agent.id,chat.id).filter(grant=>grant.runId==='preview-choice').length,0,'preview requests need no grant')
    assert.equal(auth.allowed('preview-choice','npm install'),false,'a local preview does not grant Internet downloads')
  } finally {await runtime.stopAll();runtime.close();await rm(directory,{recursive:true,force:true})}
})
