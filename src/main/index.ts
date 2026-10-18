import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { listModels, safely } from '../backend/model-api'
import { ConnectionStore } from '../backend/connections'
import { AtlasClient } from './atlas-client'
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
  const atlas = new AtlasClient(app.getPath('userData'), delta => {
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
  for (const action of ['list', 'create', 'get', 'entries', 'read']) {
    ipcMain.handle(`atlas:${action}`, (event, arg?: string) => {
      trusted(event)
      if (['get', 'entries', 'read'].includes(action) && (typeof arg !== 'string' || arg.length > 1024)) return { ok: false, error: 'Invalid request.' }
      return atlas.call(action, ...(arg === undefined ? [] : [arg]))
    })
  }
  ipcMain.handle('model:stream', (event, requestId: string, conversationId: string, connectionId: string, text: string) => {
    trusted(event)
    return (async () => {
      if (typeof requestId !== 'string' || !requestId || requestId.length > 100 || active.size || typeof conversationId !== 'string') return { ok: false, error: 'Atlas is already working or the request is invalid.' }
      const request = { id: requestId, stopped: false }
      active.set(event.sender.id, request)
      const destroyed = () => { request.stopped = true; void atlas.call('stop', requestId) }
      event.sender.once('destroyed', destroyed)
      try {
        const connection = await store.resolve(connectionId)
        if (request.stopped) return { ok: true, value: { stopped: true } }
        return await atlas.call('run', requestId, conversationId, connection, text)
      } catch { return { ok: false, error: 'Could not load the selected connection.' } }
      finally { event.sender.removeListener('destroyed', destroyed); active.delete(event.sender.id) }
    })()
  })
  ipcMain.handle('model:stop', async (event, requestId: string) => {
    trusted(event)
    const request = active.get(event.sender.id)
    if (request?.id === requestId) { request.stopped = true; await atlas.call('stop', requestId) }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
