import { contextBridge, ipcRenderer } from 'electron'
import type { GraniteBridge, StreamDelta } from '../shared/chat'

contextBridge.exposeInMainWorld('granite', {
  platform: process.platform,
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: (draft) => ipcRenderer.invoke('connections:save', draft),
    delete: (id) => ipcRenderer.invoke('connections:delete', id)
  },
  models: (draft) => ipcRenderer.invoke('model:list', draft),
  stream: (requestId, connectionId, messages) => ipcRenderer.invoke('model:stream', requestId, connectionId, messages),
  stop: (requestId) => ipcRenderer.invoke('model:stop', requestId),
  onDelta: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, delta: StreamDelta) => callback(delta)
    ipcRenderer.on('model:delta', listener)
    return () => ipcRenderer.removeListener('model:delta', listener)
  }
} satisfies GraniteBridge)
