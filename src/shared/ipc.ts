import type { Connection, GraniteBridge, Result, StreamDelta } from './chat.ts'
import type { RunIntent } from './run.ts'

type Method = (...args: any[]) => Promise<unknown>
type RequestFor<Fn extends Method> = { args: Parameters<Fn>; value: Awaited<ReturnType<Fn>> extends Result<infer Value> ? Value : never }
type Group<Prefix extends string, Methods> = {
  [Key in keyof Methods as Methods[Key] extends Method ? `${Prefix}:${Key & string}` : never]: Methods[Key]
}

export type IpcCalls = Group<'agents', GraniteBridge['agents']> &
  Group<'connections', GraniteBridge['connections']> & Group<'chatgpt', GraniteBridge['chatgpt']> &
  Group<'harness', GraniteBridge['harness']> & Group<'conversations', Omit<GraniteBridge['conversations'], 'saveResponseDuration'>> &
  Group<'organization', GraniteBridge['organization']> & Group<'context', GraniteBridge['context']> &
  Group<'workspace', GraniteBridge['workspace']> & Group<'setup', GraniteBridge['setup']> &
  Group<'previews', GraniteBridge['previews']> & Group<'repositories', GraniteBridge['repositories']> &
  Group<'runs', GraniteBridge['runs']> & {
    'conversations:responseDuration': GraniteBridge['conversations']['saveResponseDuration']
    'model:list': GraniteBridge['models']
    'model:stream': GraniteBridge['stream']
    'model:stop': GraniteBridge['stop']
  }

type WorkerChannels = Exclude<keyof IpcCalls,
  `connections:${string}` | `chatgpt:${string}` | `model:${string}` | `conversations:${string}` |
  `workspace:${string}` | 'organization:pickRepositoryFolder' | 'organization:chooseRepository' |
  'repositories:editors' | 'repositories:open' | 'repositories:chooseEditor' | 'previews:open'>

export type WorkerActions = { [Key in WorkerChannels]: RequestFor<IpcCalls[Key]> } & {
  init: { args: [directory: string]; value: true }
  shutdown: { args: []; value: true }
  list: RequestFor<GraniteBridge['conversations']['list']>
  create: RequestFor<GraniteBridge['conversations']['create']>
  keep: RequestFor<GraniteBridge['conversations']['keep']>
  move: RequestFor<GraniteBridge['conversations']['move']>
  rename: RequestFor<GraniteBridge['conversations']['rename']>
  delete: RequestFor<GraniteBridge['conversations']['delete']>
  get: RequestFor<GraniteBridge['conversations']['get']>
  responseDuration: RequestFor<GraniteBridge['conversations']['saveResponseDuration']>
  entries: RequestFor<GraniteBridge['workspace']['entries']>
  read: RequestFor<GraniteBridge['workspace']['read']>
  'workspace:save': RequestFor<GraniteBridge['workspace']['save']>
  'workspace:renameNote': RequestFor<GraniteBridge['workspace']['renameNote']>
  'organization:attachRepository': { args: [agentId: string, projectId: string, path: string]; value: import('./organization.ts').Project }
  run: { args: [requestId: string, agentId: string, conversationId: string, connection: Connection, text: string, intent?: RunIntent]; value: { stopped: boolean; steered?: boolean; runId?: string } }
  stop: { args: [requestId: string]; value: void }
}

export type WorkerAction = keyof WorkerActions
export type WorkerArgs<Key extends WorkerAction> = WorkerActions[Key]['args']
export type WorkerValue<Key extends WorkerAction> = WorkerActions[Key]['value']
export type WorkerRequest = { [Key in WorkerAction]: { id: string; action: Key; args: WorkerArgs<Key> } }[WorkerAction]
export type WorkerReply = { delta: StreamDelta } | { id: string; result: Result<unknown> }
