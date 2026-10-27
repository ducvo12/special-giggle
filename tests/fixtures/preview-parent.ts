import { mkdir, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentRuntime } from '../../src/backend/agents/runtime.ts'
const directory=await realpath(process.argv[2]),runtime=await AgentRuntime.open(join(directory,'profile'))
const agent=await runtime.createAgent('Preview crash'),section=await runtime.createSection(agent.id,'Code','shared'),project=await runtime.createProject(agent.id,section.id,'App')
const root=join(directory,'repository');await mkdir(root);await writeFile(join(root,'app.txt'),'original')
await runtime.attachRepository(agent.id,project.id,root)
const chat=await runtime.createConversation(agent.id,{sectionId:section.id,projectId:project.id})
let state=await runtime.previews.start({runId:'crash-preview',agentId:agent.id,conversationId:chat.id,projectId:project.id,root,baseline:{},touched:[],report:{runId:'crash-preview',projectId:project.id,name:'App',state:'settled',changes:[],preExisting:0}},'node -e \'require("node:http").createServer((q,r)=>r.end("live")).listen(Number(process.env.PORT),process.env.HOST)\'','',0,new AbortController().signal)
while(state.status==='starting')state=await runtime.previews.read(agent.id,chat.id,state.id,100)
if(state.status!=='ready')throw new Error(JSON.stringify(state))
console.log(JSON.stringify({agentId:agent.id,chatId:chat.id,preview:state}))
setInterval(()=>{},1000)
