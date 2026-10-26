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
    saveResponseDuration: (agentId, id, messageId, durationMs) => ipcRenderer.invoke('conversations:responseDuration', agentId, id, messageId, durationMs),
    list: agentId => ipcRenderer.invoke('conversations:list', agentId),
    create: (agentId, location) => ipcRenderer.invoke('conversations:create', agentId, location),
    move: (agentId, id, location) => ipcRenderer.invoke('conversations:move', agentId, id, location),
    rename: (agentId, id, title) => ipcRenderer.invoke('conversations:rename', agentId, id, title),
    delete: (agentId, id) => ipcRenderer.invoke('conversations:delete', agentId, id),
    get: (agentId, id) => ipcRenderer.invoke('conversations:get', agentId, id)
  },
  organization: {
    get: agentId => ipcRenderer.invoke('organization:get', agentId),
    createSection: (agentId, name, mode) => ipcRenderer.invoke('organization:createSection', agentId, name, mode),
    renameSection: (agentId, id, name) => ipcRenderer.invoke('organization:renameSection', agentId, id, name),
    shareSection: (agentId, id) => ipcRenderer.invoke('organization:shareSection', agentId, id),
    createProject: (agentId, sectionId, name, repositoryPath, createRepository) => ipcRenderer.invoke('organization:createProject', agentId, sectionId, name, repositoryPath, createRepository),
    pickRepositoryFolder: () => ipcRenderer.invoke('organization:pickRepositoryFolder'),
    renameProject: (agentId, id, name) => ipcRenderer.invoke('organization:renameProject', agentId, id, name),
    createRepository: (agentId, projectId) => ipcRenderer.invoke('organization:createRepository', agentId, projectId),
    chooseRepository: (agentId, projectId) => ipcRenderer.invoke('organization:chooseRepository', agentId, projectId)
  },
  workspace: {
    entries: (agentId, path) => ipcRenderer.invoke('workspace:entries', agentId, path),
    read: (agentId, path) => ipcRenderer.invoke('workspace:read', agentId, path),
    save: (agentId, path, content, expected) => ipcRenderer.invoke('workspace:save', agentId, path, content, expected),
    renameNote: (agentId, path, name) => ipcRenderer.invoke('workspace:renameNote', agentId, path, name)
  },
  repositories: {
    editors: () => ipcRenderer.invoke('repositories:editors'),
    open: (agentId, projectId, editorId) => ipcRenderer.invoke('repositories:open', agentId, projectId, editorId),
    chooseEditor: (agentId, projectId) => ipcRenderer.invoke('repositories:chooseEditor', agentId, projectId),
    reports: (agentId, id) => ipcRenderer.invoke('repositories:reports', agentId, id),
    review: (agentId, id, runId, acknowledge) => ipcRenderer.invoke('repositories:review', agentId, id, runId, acknowledge)
  },
  runs: {
    list: () => ipcRenderer.invoke('runs:list'),
    recovery: () => ipcRenderer.invoke('runs:recovery'),
    dismissRecovery: () => ipcRenderer.invoke('runs:dismissRecovery'),
    cancelPending: (agentId, id) => ipcRenderer.invoke('runs:cancelPending', agentId, id)
  },
  stream: (requestId, agentId, conversationId, connectionId, text, model, effort, intent) =>
    ipcRenderer.invoke('model:stream', requestId, agentId, conversationId, connectionId, text, model, effort, intent),
  stop: requestId => ipcRenderer.invoke('model:stop', requestId),
  onDelta: callback => {
    const listener = (_event: Electron.IpcRendererEvent, delta: StreamDelta) => callback(delta)
    ipcRenderer.on('model:delta', listener)

    return () => ipcRenderer.removeListener('model:delta', listener)
  }
} satisfies GraniteBridge)
