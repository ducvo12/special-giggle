import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { chat, listModels, safely } from '../backend/model-api'
import type { Connection, Message } from '../shared/chat'

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
  if (!app.isPackaged) {
    app.setPath('userData', join(app.getPath('appData'), 'Granite Development'))
  }
  ipcMain.handle('model:list', (event, connection: Connection) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid sender')
    return safely(() => listModels(connection))
  })
  ipcMain.handle('model:chat', (event, connection: Connection, messages: Message[]) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid sender')
    return safely(() => chat(connection, messages))
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
