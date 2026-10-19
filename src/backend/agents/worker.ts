import { AgentRuntime } from './runtime.ts'
import type { Connection, StreamDelta } from '../../shared/chat.ts'

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
      case 'agents:list':
        value = await agent.registry.list()
        break
      case 'agents:create':
        value = await agent.registry.create(args[0] as string)
        break
      case 'agents:saveIdentity':
        value = await agent.saveIdentity(args[0] as string, args[1] as string, args[2] as string)
        break
      case 'list':
        await agent.registry.get(args[0] as string)
        value = agent.store.list(args[0] as string)
        break
      case 'create':
        await agent.registry.get(args[0] as string)
        value = agent.store.create(args[0] as string)
        break
      case 'get':
        value = agent.store.get(args[0] as string, args[1] as string)
        break
      case 'entries':
        value = await agent.entries(args[0] as string, args[1] as string)
        break
      case 'read':
        value = await agent.read(args[0] as string, args[1] as string)
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
              (delta: StreamDelta) => port.postMessage({ delta })
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
      result: { ok: false, error: error instanceof Error ? error.message : 'Agent request failed.' }
    })
  }
})
