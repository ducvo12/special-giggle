import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { externalWebUrl } from './web-links'

export function createWindow(): void {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: 'Granite',
    ...(process.platform === 'darwin' && {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 15 }
    }),
    backgroundColor: '#181818',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = externalWebUrl(url)
    if (target) void shell.openExternal(target).catch(() => {
      void dialog.showMessageBox(window, {
        type: 'error', message: 'Could not open this link in your browser.',
        detail: target, buttons: ['OK']
      })
    })
    // Web content stays in the user's browser, outside Granite's renderer.
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', event => event.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
