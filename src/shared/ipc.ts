import type { GraniteBridge } from './chat.ts'

type Method = (...args: any[]) => Promise<unknown>
type Group<Prefix extends string, Methods> = {
  [Key in keyof Methods as Methods[Key] extends Method ? `${Prefix}:${Key & string}` : never]: Methods[Key]
}

export type IpcCalls = Group<'connections', GraniteBridge['connections']> &
  Group<'window', GraniteBridge['window']> & Group<'chatgpt', GraniteBridge['chatgpt']> & {
    'model:list': GraniteBridge['models']
  }
