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
  conversations: {
    list: () => ipcRenderer.invoke('atlas:list'),
    create: () => ipcRenderer.invoke('atlas:create'),
    get: id => ipcRenderer.invoke('atlas:get', id)
  },
  workspace: {
    entries: path => ipcRenderer.invoke('atlas:entries', path),
    read: path => ipcRenderer.invoke('atlas:read', path)
  },
  stream: (requestId, conversationId, connectionId, text) => ipcRenderer.invoke('model:stream', requestId, conversationId, connectionId, text),
  stop: (requestId) => ipcRenderer.invoke('model:stop', requestId),
  onDelta: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, delta: StreamDelta) => callback(delta)
    ipcRenderer.on('model:delta', listener)
    return () => ipcRenderer.removeListener('model:delta', listener)
  }
} satisfies GraniteBridge)
