import { contextBridge, ipcRenderer } from 'electron'
import type { GraniteBridge } from '../shared/chat'

contextBridge.exposeInMainWorld('granite', {
  platform: process.platform,
  models: (connection) => ipcRenderer.invoke('model:list', connection),
  chat: (connection, messages) => ipcRenderer.invoke('model:chat', connection, messages)
} satisfies GraniteBridge)
