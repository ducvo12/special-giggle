import { contextBridge, ipcRenderer as renderer } from 'electron'
import type { IpcCalls } from '../shared/ipc.ts'
import type { GraniteBridge } from '../shared/chat'

const ipcRenderer = {
  invoke<Key extends keyof IpcCalls>(channel: Key, ...args: Parameters<IpcCalls[Key]>): ReturnType<IpcCalls[Key]> {
    return renderer.invoke(channel, ...args) as ReturnType<IpcCalls[Key]>
  }
}

contextBridge.exposeInMainWorld('granite', {
  platform: process.platform,
  window: {
    setMinimumSize: (width, height) => ipcRenderer.invoke('window:setMinimumSize', width, height)
  },
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: draft => ipcRenderer.invoke('connections:save', draft),
    delete: id => ipcRenderer.invoke('connections:delete', id),
    models: (id, refresh) => ipcRenderer.invoke('connections:models', id, refresh)
  },
  models: draft => ipcRenderer.invoke('model:list', draft),
  chatgpt: {
    accounts: () => ipcRenderer.invoke('chatgpt:accounts'),
    login: accountId => ipcRenderer.invoke('chatgpt:login', accountId),
    cancelLogin: () => ipcRenderer.invoke('chatgpt:cancelLogin'),
    signOut: id => ipcRenderer.invoke('chatgpt:signOut', id)
  }
} satisfies GraniteBridge)
