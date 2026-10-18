import { AgentRuntime } from '../src/backend/agent-runtime.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const baseUrl = process.env.GRANITE_MODEL_BASE_URL
const model = process.env.GRANITE_MODEL_ID
if (!baseUrl || !model) throw new Error('Set GRANITE_MODEL_BASE_URL and GRANITE_MODEL_ID. This test uses only an isolated temporary workspace.')
const connection = { baseUrl, model, apiKey: process.env.GRANITE_MODEL_API_KEY ?? '' }
const dir = await mkdtemp(join(tmpdir(), 'atlas-live-'))
let atlas = await AgentRuntime.open(dir)
const results: any[] = []
async function run(label: string, id: string, prompt: string) {
 const start = Date.now(); let first = 0, reasoning = 0; const tools: string[] = []
 console.log('START',label)
 await atlas.run(label, 'atlas',id,connection,prompt, delta => {
   if(delta.text && !first) first=Date.now()-start
   reasoning=delta.activity?.reasoningCharacters ?? reasoning
   if(delta.tool?.status === 'running') { tools.push(delta.tool.name); console.log('TOOL',label,delta.tool.name) }
 })
 const message=atlas.store.get('atlas', id).messages.at(-1)!
 const result={label,elapsedMs:Date.now()-start,firstAnswerMs:first,reasoningCharacters:reasoning,tools,status:message.status,notice:message.notice,answer:message.content}
 results.push(result); console.log('RESULT',JSON.stringify(result));return message
}
try {
 const chat=atlas.store.create('atlas')
 const quote=await run('quote',chat.id,'Write one original inspirational quote in one sentence.')
 assert.ok(quote.content.trim())
 await run('save-note',chat.id,'Create /notes/weekend.md containing exactly: Weekend plan: visit the botanical garden on Saturday. Use the file tool, then confirm briefly.')
 assert.match(await atlas.read('atlas', '/notes/weekend.md'),/botanical garden/)
 await run('read-note',chat.id,'Read /notes/weekend.md using a tool and tell me the plan.')
 await run('update-note',chat.id,'Update /notes/weekend.md: change Saturday to Sunday. Keep the rest. Use the edit tool.')
 assert.match(await atlas.read('atlas', '/notes/weekend.md'),/Sunday/)
 await run('save-memory',chat.id,'Please remember for future conversations: I prefer concise answers and my favorite drink is jasmine tea. Save this in /memory.md.')
 assert.match(await atlas.read('atlas', '/memory.md'),/jasmine/i)
 const recall=atlas.store.create('atlas')
 const recalled=await run('new-conversation-recall',recall.id,'What is my favorite drink, and what answer style do I prefer?')
 assert.match(recalled.content,/jasmine/i)
 let stopped=false
 console.log('START stop')
 const stop=atlas.run('stop', 'atlas',recall.id,connection,'Write a long essay about the history of gardens.',delta=>{
  if(!stopped && (delta.text || delta.activity?.reasoningCharacters)) { stopped=true; atlas.stop('stop') }
 })
 assert.deepEqual(await stop,{stopped:true})
 assert.equal(atlas.store.get('atlas', recall.id).messages.at(-1)!.status,'stopped')
 console.log('PASS Stop')
 atlas.close();atlas=await AgentRuntime.open(dir)
 assert.match(await atlas.read('atlas', '/notes/weekend.md'),/Sunday/)
 assert.match(await atlas.read('atlas', '/memory.md'),/jasmine/i)
 await run('restart-recovery',recall.id,'What is my favorite drink? Answer briefly.')
 console.log('PASS restart recovery')
 console.log('PASS all live checks', JSON.stringify(results))
} finally { atlas.close();await rm(dir,{recursive:true,force:true}) }
