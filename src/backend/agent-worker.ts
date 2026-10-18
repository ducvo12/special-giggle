import { AtlasRuntime } from './atlas-runtime.ts'
import type { Connection, StreamDelta } from '../shared/chat.ts'

type Request = { id: string; action: string; args: unknown[] }
const port = process.parentPort!
let runtime: Promise<AtlasRuntime> | undefined
const stopped = new Set<string>()
port.on('message', async ({ data }: { data: Request }) => {
  const { id, action, args } = data
  try {
    if (action === 'init') runtime = AtlasRuntime.open(args[0] as string)
    const atlas = await runtime
    if (!atlas) throw new Error('Atlas is not ready.')
    let value: unknown
    switch (action) {
      case 'init': value = true; break
      case 'list': value = atlas.store.list(); break
      case 'create': value = atlas.store.create(); break
      case 'get': value = atlas.store.get(args[0] as string); break
      case 'entries': value = await atlas.entries(args[0] as string); break
      case 'read': value = await atlas.read(args[0] as string); break
      case 'stop':
        stopped.add(args[0] as string); atlas.stop(args[0] as string)
        if (stopped.size > 100) stopped.delete(stopped.values().next().value!)
        break
      case 'run':
        if (stopped.delete(args[0] as string)) value = { stopped: true }
        else {
          try { value = await atlas.run(args[0] as string, args[1] as string, args[2] as Connection, args[3] as string, (delta: StreamDelta) => port.postMessage({ delta })) }
          finally { stopped.delete(args[0] as string) }
        }
        break
      default: throw new Error('Unknown Atlas request.')
    }
    port.postMessage({ id, result: { ok: true, value } })
  } catch (error) { port.postMessage({ id, result: { ok: false, error: error instanceof Error ? error.message : 'Atlas request failed.' } }) }
})
