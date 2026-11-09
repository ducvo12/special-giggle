import { app, BrowserWindow, ipcMain as main, safeStorage, shell } from 'electron'
import type { IpcCalls } from '../shared/ipc.ts'
import type { ConnectionDraft } from '../shared/chat'
import { listModels, listModelCatalog, safely } from '../backend/models/api'
import { ConnectionStore } from '../backend/connections/store'
import { ChatGPTAccounts } from '../backend/auth/chatgpt'
import { AccountModelCatalog } from '../backend/models/account-catalog'

export function registerIpc(directory: string) {
  const ipcMain = {
    handle<Key extends keyof IpcCalls>(channel: Key, listener: (event: Electron.IpcMainInvokeEvent, ...args: Parameters<IpcCalls[Key]>) => Promise<Awaited<ReturnType<IpcCalls[Key]>>> | Awaited<ReturnType<IpcCalls[Key]>>) {
      main.handle(channel, listener)
    }
  }
  const protection = {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (text: string) => safeStorage.encryptString(text),
    decrypt: (data: Buffer) => safeStorage.decryptString(data)
  }
  const store = new ConnectionStore(directory, protection)
  const chatgpt = new ChatGPTAccounts(directory, protection)
  const modelCatalog = new AccountModelCatalog(chatgpt)
  app.on('before-quit', () => chatgpt.cancel())

  function trusted(event: Electron.IpcMainInvokeEvent) {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !BrowserWindow.fromWebContents(event.sender)
    ) {
      throw new Error('Invalid sender')
    }
  }

  // Apply only to the requesting window; account for native frame dimensions.
  ipcMain.handle('window:setMinimumSize', (event, width, height) => {
    trusted(event)
    return safely(async () => {
      if (![width, height].every(value => Number.isInteger(value) && value > 0 && value < 2 ** 31)) {
        throw new Error('Invalid window minimum size.')
      }
      const window = BrowserWindow.fromWebContents(event.sender)!
      const outer = window.getBounds()
      const content = window.getContentBounds()
      window.setMinimumSize(Math.max(720, width + outer.width - content.width), Math.max(520, height + outer.height - content.height))
    })
  })

  ipcMain.handle('connections:list', event => {
    trusted(event)

    return safely(() => store.list())
  })

  ipcMain.handle('connections:save', (event, draft: ConnectionDraft) => {
    trusted(event)

    return safely(() => store.save(draft))
  })

  ipcMain.handle('connections:delete', (event, id: string) => {
    trusted(event)

    return safely(() => store.delete(id))
  })

  ipcMain.handle('connections:models', (event, id: string, refresh = false) => {
    trusted(event)

    return safely(async () => {
      if (typeof id !== 'string' || id.length > 100 || typeof refresh !== 'boolean') {
        throw new Error('Choose a saved connection first.')
      }

      const connection = await store.resolve(id)

      if (connection.provider !== 'chatgpt') {
        return listModelCatalog(connection)
      }

      return modelCatalog.get(connection.accountId ?? '', refresh)
    })
  })

  ipcMain.handle('model:list', (event, draft: ConnectionDraft) => {
    trusted(event)

    return safely(async () => {
      const connection = await store.resolveDraft(draft)

      if (connection.provider === 'chatgpt') {
        return (await modelCatalog.get(connection.accountId ?? '', true)).map(model => model.id)
      }

      return listModels(connection)
    })
  })

  ipcMain.handle('chatgpt:accounts', event => {
    trusted(event)

    return safely(() => chatgpt.list())
  })
  ipcMain.handle('chatgpt:login', (event, accountId?: string) => {
    trusted(event)

    if (accountId !== undefined && (typeof accountId !== 'string' || accountId.length > 100)) {
      return { ok: false, error: 'Invalid account.' }
    }

    return safely(async () => {
      const account = await chatgpt.login(url => shell.openExternal(url), accountId)
      modelCatalog.invalidate(account.id)
      void modelCatalog.get(account.id).catch(() => {})
      return account
    })
  })
  ipcMain.handle('chatgpt:cancelLogin', event => {
    trusted(event)
    chatgpt.cancel()

    return { ok: true, value: undefined }
  })
  ipcMain.handle('chatgpt:signOut', (event, id: string) => {
    trusted(event)

    return safely(async () => {
      const result = await chatgpt.signOut(id)
      modelCatalog.invalidate(id)
      return result
    })
  })
}
