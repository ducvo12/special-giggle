import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { createWindow } from './window'

void app.whenReady().then(() => {
  // Keep development conversations and workspaces separate from packaged builds.
  if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', join(app.getPath('appData'), 'Granite Development'))
  }

  registerIpc(app.getPath('userData'))

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
