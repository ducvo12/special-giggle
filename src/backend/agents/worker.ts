import { AgentRuntime } from './runtime.ts'
import type { Connection, StreamDelta } from '../../shared/chat.ts'
import type { RunIntent } from '../../shared/run.ts'
import type { HarnessSettings } from '../../shared/harness.ts'
import type { ConversationLocation, SectionMode } from '../../shared/organization.ts'
import { ModelAccessError } from '../harness/types.ts'

type Request = { id: string; action: string; args: unknown[] }

const port = process.parentPort!

let runtime: Promise<AgentRuntime> | undefined

const stopped = new Set<string>()

port.on('message', async ({ data }: { data: Request }) => {
  const { id, action, args } = data

  try {
    if (action === 'init') {
      runtime = AgentRuntime.open(args[0] as string)
    }

    const agent = await runtime

    if (!agent) {
      throw new Error('Agents are not ready.')
    }

    let value: unknown

    switch (action) {
      case 'init':
        value = true
        break
      case 'setup:grants':
        value = agent.authorization.list(args[0] as string, args[1] as string)
        break
      case 'setup:revoke':
        value = agent.authorization.revoke(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'previews:list':
        value = agent.previews.list(args[0] as string, args[1] as string)
        break
      case 'previews:stop':
        value = await agent.previews.stop(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'previews:restart':
        value = await agent.restartPreview(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'repositories:reports':
        value = agent.repositories.reports(args[0] as string, args[1] as string)
        break
      case 'repositories:review':
        value = await agent.repositories.review(args[0] as string, args[1] as string, args[2] as string, args[3] as boolean)
        break
      case 'organization:createRepository':
        value = await agent.createRepository(args[0] as string, args[1] as string)
        break
      case 'runs:list':
        value = agent.listRuns()
        break
      case 'runs:recovery':
        value = agent.recovery()
        break
      case 'runs:dismissRecovery':
        agent.previews.dismissRecovery()
        value = agent.store.runs.dismissRecovery()
        break
      case 'runs:cancelPending':
        value = agent.cancelPending(args[0] as string, args[1] as string)
        break
      case 'shutdown':
        await agent.stopAll()
        value = true
        break
      case 'agents:list':
        value = await agent.registry.list()
        break
      case 'agents:create':
        value = await agent.createAgent(args[0] as string)
        break
      case 'agents:delete':
        value = await agent.deleteAgent(args[0] as string)
        break
      case 'agents:saveIdentity':
        value = await agent.saveIdentity(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'harness:get':
        value = await agent.settings(args[0] as string)
        break
      case 'harness:save':
        value = await agent.saveSettings(args[0] as string, args[1] as HarnessSettings)
        break
      case 'harness:skills':
        value = await agent.skills(args[0] as string)
        break
      case 'harness:saveSkill':
        value = await agent.saveSkill(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'harness:answer':
        value = agent.answerQuestion(args[0] as string, args[1] as string, args[2] as string[])
        break
      case 'harness:rejectQuestion':
        value = agent.rejectQuestion(args[0] as string, args[1] as string)
        break
      case 'harness:approve':
        agent.approvals.answer(args[0] as string, args[1] as string, args[2] as boolean)
        break
      case 'list':
        await agent.registry.get(args[0] as string)
        value = agent.store.list(args[0] as string)
        break
      case 'create':
        value = await agent.createConversation(args[0] as string, args[1] as Partial<ConversationLocation> | undefined)
        break
      case 'move':
        value = await agent.moveConversation(args[0] as string, args[1] as string, args[2] as ConversationLocation)
        break
      case 'organization:get':
        value = await agent.organization(args[0] as string)
        break
      case 'organization:createSection':
        value = await agent.createSection(args[0] as string, args[1] as string, args[2] as SectionMode)
        break
      case 'organization:renameSection':
        value = await agent.renameSection(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'organization:shareSection':
        value = await agent.shareSection(args[0] as string, args[1] as string)
        break
      case 'organization:createProject':
        value = await agent.createProject(args[0] as string, args[1] as string, args[2] as string, args[3] as string | null | undefined, args[4] as boolean | undefined)
        break
      case 'organization:renameProject':
        value = await agent.renameProject(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'organization:attachRepository':
        value = await agent.attachRepository(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'rename':
        value = await agent.renameConversation(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'delete':
        value = await agent.deleteConversation(args[0] as string, args[1] as string)
        break
      case 'get':
        value = agent.store.get(args[0] as string, args[1] as string)
        break
      case 'responseDuration':
        value = agent.store.saveResponseDuration(args[0] as string, args[1] as string, args[2] as string, args[3] as number)
        break
      case 'entries':
        value = await agent.entries(args[0] as string, args[1] as string)
        break
      case 'read':
        value = await agent.read(args[0] as string, args[1] as string)
        break
      case 'workspace:save':
        value = await agent.saveMarkdown(args[0] as string, args[1] as string, args[2] as string, args[3] as string | null)
        break
      case 'workspace:renameNote':
        value = await agent.renameNote(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'stop':
        stopped.add(args[0] as string)
        agent.stop(args[0] as string)
        if (stopped.size > 100) {
          stopped.delete(stopped.values().next().value!)
        }
        break
      case 'run':
        if (stopped.delete(args[0] as string)) {
          value = { stopped: true }
        } else {
          try {
            value = await agent.run(
              args[0] as string,
              args[1] as string,
              args[2] as string,
              args[3] as Connection,
              args[4] as string,
              (delta: StreamDelta) => port.postMessage({ delta }),
              args[5] as RunIntent | undefined
            )
          } finally {
            stopped.delete(args[0] as string)
          }
        }
        break
      default:
        throw new Error('Unknown agent request.')
    }

    port.postMessage({ id, result: { ok: true, value } })
  } catch (error) {
    port.postMessage({
      id,
      result: { ok: false, error: error instanceof Error ? error.message : 'Agent request failed.',
        ...(error instanceof ModelAccessError ? { code: 'model_access' } : {}) }
    })
  }
})
