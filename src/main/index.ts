import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { streamChat, listModels, safely } from '../backend/model-api'
import { ConnectionStore } from '../backend/connections'
import type { ConnectionDraft, Message } from '../shared/chat'

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
  // Development gets its own storage directory before we add persistent agents.
  if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', join(app.getPath('appData'), 'Granite Development'))
  }
  const store = new ConnectionStore(app.getPath('userData'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: text => safeStorage.encryptString(text),
    decrypt: data => safeStorage.decryptString(data)
  })
  const active = new Map<number, { requestId: string; controller: AbortController }>()
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
  ipcMain.handle('model:stream', (event, requestId: string, connectionId: string, messages: Message[]) => {
    trusted(event)
    return safely(async () => {
      if (typeof requestId !== 'string' || requestId.length > 100 || active.has(event.sender.id)) throw new Error('A reply is already running or the request is invalid.')
      const controller = new AbortController()
      active.set(event.sender.id, { requestId, controller })
      const destroyed = () => controller.abort()
      event.sender.once('destroyed', destroyed)
      try {
        const connection = await store.resolve(connectionId)
        await streamChat(connection, messages, controller.signal, text => {
          if (!event.sender.isDestroyed()) event.sender.send('model:delta', { requestId, text })
        })
        return { stopped: controller.signal.aborted }
      } catch (error) {
        if (controller.signal.aborted) return { stopped: true }
        throw error
      } finally {
        event.sender.removeListener('destroyed', destroyed)
        active.delete(event.sender.id)
      }
    })
  })
  ipcMain.handle('model:stop', (event, requestId: string) => {
    trusted(event)
    const run = active.get(event.sender.id)
    if (run?.requestId === requestId) run.controller.abort()
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
