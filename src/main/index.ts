import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { listModels, safely } from '../backend/model-api'
import { ConnectionStore } from '../backend/connections'
import { AgentClient } from './agent-client'
import type { ConnectionDraft } from '../shared/chat'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: 'Granite',
    backgroundColor: '#141715',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  // Keep development conversations and workspaces separate from packaged builds.
  if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', join(app.getPath('appData'), 'Granite Development'))
  }
  const store = new ConnectionStore(app.getPath('userData'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: text => safeStorage.encryptString(text),
    decrypt: data => safeStorage.decryptString(data)
  })
  const active = new Map<number, { id: string; stopped: boolean }>()
  const agents = new AgentClient(app.getPath('userData'), delta => {
    for (const [senderId, request] of active) {
      if (delta.requestId !== request.id) continue
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.id === senderId)
      window?.webContents.send('model:delta', delta)
    }
  })
  function trusted(event: Electron.IpcMainInvokeEvent) {
    if (event.senderFrame !== event.sender.mainFrame || !BrowserWindow.fromWebContents(event.sender)) throw new Error('Invalid sender')
  }
  ipcMain.handle('connections:list', event => { trusted(event); return safely(() => store.list()) })
  ipcMain.handle('connections:save', (event, draft: ConnectionDraft) => { trusted(event); return safely(() => store.save(draft)) })
  ipcMain.handle('connections:delete', (event, id: string) => { trusted(event); return safely(() => store.delete(id)) })
  ipcMain.handle('model:list', (event, draft: ConnectionDraft) => {
    trusted(event)
    return safely(async () => listModels(await store.resolveDraft(draft)))
  })
  const routes: Record<string, { action: string; limits: number[] }> = {
    'agents:list': { action: 'agents:list', limits: [] },
    'agents:create': { action: 'agents:create', limits: [80] },
    'agents:saveIdentity': { action: 'agents:saveIdentity', limits: [64, 32_000, 100_000] },
    'conversations:list': { action: 'list', limits: [64] },
    'conversations:create': { action: 'create', limits: [64] },
    'conversations:get': { action: 'get', limits: [64, 100] },
    'workspace:entries': { action: 'entries', limits: [64, 1024] },
    'workspace:read': { action: 'read', limits: [64, 1024] }
  }
  for (const [channel, { action, limits }] of Object.entries(routes)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      trusted(event)
      if (args.length !== limits.length || args.some((arg, i) => typeof arg !== 'string' || arg.length > limits[i])) return { ok: false, error: 'Invalid request.' }
      return agents.call(action, ...args)
    })
  }
  ipcMain.handle('model:stream', (event, requestId: string, agentId: string, conversationId: string, connectionId: string, text: string) => {
    trusted(event)
    return (async () => {
      if (typeof requestId !== 'string' || !requestId || requestId.length > 100 || active.size || typeof conversationId !== 'string' || typeof agentId !== 'string' || agentId.length > 64) return { ok: false, error: 'An agent is already working or the request is invalid.' }
      const request = { id: requestId, stopped: false }
      active.set(event.sender.id, request)
      const destroyed = () => { request.stopped = true; void agents.call('stop', requestId) }
      event.sender.once('destroyed', destroyed)
      try {
        const connection = await store.resolve(connectionId)
        if (request.stopped) return { ok: true, value: { stopped: true } }
        return await agents.call('run', requestId, agentId, conversationId, connection, text)
      } catch { return { ok: false, error: 'Could not load the selected connection.' } }
      finally { event.sender.removeListener('destroyed', destroyed); active.delete(event.sender.id) }
    })()
  })
  ipcMain.handle('model:stop', async (event, requestId: string) => {
    trusted(event)
    const request = active.get(event.sender.id)
    if (request?.id === requestId) { request.stopped = true; await agents.call('stop', requestId) }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
