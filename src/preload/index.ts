import { contextBridge, ipcRenderer } from 'electron'
import type { GraniteBridge, StreamDelta } from '../shared/chat'

contextBridge.exposeInMainWorld('granite', {
  platform: process.platform,
  agents: {
    list: () => ipcRenderer.invoke('agents:list'),
    create: name => ipcRenderer.invoke('agents:create', name),
    delete: id => ipcRenderer.invoke('agents:delete', id),
    saveIdentity: (id, identity, expected) =>
      ipcRenderer.invoke('agents:saveIdentity', id, identity, expected)
  },
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: draft => ipcRenderer.invoke('connections:save', draft),
    delete: id => ipcRenderer.invoke('connections:delete', id),
    models: id => ipcRenderer.invoke('connections:models', id)
  },
  models: draft => ipcRenderer.invoke('model:list', draft),
  chatgpt: {
    accounts: () => ipcRenderer.invoke('chatgpt:accounts'),
    login: accountId => ipcRenderer.invoke('chatgpt:login', accountId),
    cancelLogin: () => ipcRenderer.invoke('chatgpt:cancelLogin'),
    signOut: id => ipcRenderer.invoke('chatgpt:signOut', id)
  },
  harness: {
    get: agentId => ipcRenderer.invoke('harness:get', agentId),
    save: (agentId, settings) => ipcRenderer.invoke('harness:save', agentId, settings),
    skills: agentId => ipcRenderer.invoke('harness:skills', agentId),
    saveSkill: (agentId, name, content) =>
      ipcRenderer.invoke('harness:saveSkill', agentId, name, content),
    approve: (requestId, approvalId, allow) =>
      ipcRenderer.invoke('harness:approve', requestId, approvalId, allow)
  },
  conversations: {
    list: agentId => ipcRenderer.invoke('conversations:list', agentId),
    create: agentId => ipcRenderer.invoke('conversations:create', agentId),
    get: (agentId, id) => ipcRenderer.invoke('conversations:get', agentId, id)
  },
  workspace: {
    entries: (agentId, path) => ipcRenderer.invoke('workspace:entries', agentId, path),
    read: (agentId, path) => ipcRenderer.invoke('workspace:read', agentId, path)
  },
  stream: (requestId, agentId, conversationId, connectionId, text, model) =>
    ipcRenderer.invoke('model:stream', requestId, agentId, conversationId, connectionId, text, model),
  stop: requestId => ipcRenderer.invoke('model:stop', requestId),
  onDelta: callback => {
    const listener = (_event: Electron.IpcRendererEvent, delta: StreamDelta) => callback(delta)
    ipcRenderer.on('model:delta', listener)

    return () => ipcRenderer.removeListener('model:delta', listener)
  }
} satisfies GraniteBridge)
