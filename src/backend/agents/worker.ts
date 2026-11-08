import { AgentRuntime } from './runtime.ts'
import type { StreamDelta } from '../../shared/chat.ts'
import { ModelAccessError } from '../harness/types.ts'

import type { WorkerRequest } from '../../shared/ipc.ts'
type Request = WorkerRequest

const port = process.parentPort!

let runtime: Promise<AgentRuntime> | undefined

const stopped = new Set<string>()
const unscoped = new Set(['init', 'shutdown', 'agents:list', 'agents:create', 'runs:list', 'runs:recovery', 'runs:dismissRecovery', 'stop', 'run', 'harness:answer', 'harness:approve', 'harness:rejectQuestion'])

port.on('message', async ({ data }: { data: Request }) => {
  const { id, action, args } = data

  try {
    if (action === 'init') {
      runtime = AgentRuntime.open(args[0])
    }

    const agent = await runtime

    if (!agent) {
      throw new Error('Agents are not ready.')
    }

    let value: unknown
    if (!unscoped.has(action)) agent.deletions.assertAvailable(args[0] as string)

    switch (action) {
      case 'init':
        value = true
        break
      case 'setup:grants':
        value = agent.authorization.list(...args)
        break
      case 'setup:revoke':
        value = agent.authorization.revoke(...args)
        break
      case 'previews:list':
        value = agent.previews.list(...args)
        break
      case 'previews:stop':
        value = await agent.previews.stop(...args)
        break
      case 'previews:restart':
        value = await agent.restartPreview(...args)
        break
      case 'repositories:reports':
        value = agent.repositories.reports(...args)
        break
      case 'repositories:review':
        value = await agent.repositories.review(...args)
        break
      case 'organization:createRepository':
        value = await agent.createRepository(...args)
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
        value = agent.cancelPending(...args)
        break
      case 'shutdown':
        await agent.stopAll()
        value = true
        break
      case 'agents:list':
        value = await agent.registry.list()
        break
      case 'agents:create':
        value = await agent.createAgent(...args)
        break
      case 'agents:delete':
        value = await agent.deleteAgent(...args)
        break
      case 'agents:saveIdentity':
        value = await agent.saveIdentity(...args)
        break
      case 'context:read':
        await agent.context.sync(args[0])
        value = { ...agent.context.get(...args),
          ...(args[2].endsWith(':/memory.md') ? { items: agent.context.memoryItems(args[0]) } : {}) }
        break
      case 'harness:get':
        value = await agent.settings(...args)
        break
      case 'harness:save':
        value = await agent.saveSettings(...args)
        break
      case 'harness:skills':
        value = await agent.skills(...args)
        break
      case 'harness:saveSkill':
        value = await agent.saveSkill(...args)
        break
      case 'harness:answer':
        value = agent.answerQuestion(...args)
        break
      case 'harness:rejectQuestion':
        value = agent.rejectQuestion(...args)
        break
      case 'harness:approve':
        agent.approvals.answer(...args)
        break
      case 'list':
        await agent.registry.get(args[0])
        value = agent.store.list(...args)
        break
      case 'create':
        value = await agent.createConversation(...args)
        break
      case 'move':
        value = await agent.moveConversation(...args)
        break
      case 'organization:get':
        value = await agent.organization(...args)
        break
      case 'organization:createSection':
        value = await agent.createSection(...args)
        break
      case 'organization:renameSection':
        value = await agent.renameSection(...args)
        break
      case 'organization:shareSection':
        value = await agent.shareSection(...args)
        break
      case 'organization:createProject':
        value = await agent.createProject(...args)
        break
      case 'organization:renameProject':
        value = await agent.renameProject(...args)
        break
      case 'organization:attachRepository':
        value = await agent.attachRepository(...args)
        break
      case 'rename':
        value = await agent.renameConversation(...args)
        break
      case 'delete':
        value = await agent.deleteConversation(...args)
        break
      case 'get':
        value = agent.store.get(...args)
        break
      case 'responseDuration':
        value = agent.store.saveResponseDuration(...args)
        break
      case 'entries':
        value = await agent.entries(...args)
        break
      case 'read':
        value = await agent.read(...args)
        break
      case 'workspace:save':
        value = await agent.saveMarkdown(...args)
        break
      case 'workspace:renameNote':
        value = await agent.renameNote(...args)
        break
      case 'stop':
        stopped.add(args[0])
        agent.stop(...args)
        if (stopped.size > 100) {
          stopped.delete(stopped.values().next().value!)
        }
        break
      case 'run':
        if (stopped.delete(args[0])) {
          value = { stopped: true }
        } else {
          try {
            value = await agent.run(
              args[0],
              args[1],
              args[2],
              args[3],
              args[4],
              (delta: StreamDelta) => port.postMessage({ delta }),
              args[5]
            )
          } finally {
            stopped.delete(args[0])
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
