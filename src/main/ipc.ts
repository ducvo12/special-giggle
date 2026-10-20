import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { listModels, safely } from '../backend/models/api'
import { ConnectionStore } from '../backend/connections/store'
import { AgentClient } from './agent-client'
import type { ConnectionDraft } from '../shared/chat'
import { ChatGPTAccounts } from '../backend/auth/chatgpt'
import type { HarnessSettings } from '../shared/harness'

export function registerIpc(directory: string) {
  const protection = {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (text: string) => safeStorage.encryptString(text),
    decrypt: (data: Buffer) => safeStorage.decryptString(data)
  }
  const store = new ConnectionStore(directory, protection)
  const chatgpt = new ChatGPTAccounts(directory, protection)
  app.on('before-quit', () => chatgpt.cancel())
  const active = new Map<number, { id: string; stopped: boolean }>()
  const agents = new AgentClient(directory, delta => {
    for (const [senderId, request] of active) {
      if (delta.requestId !== request.id) {
        continue
      }

      const window = BrowserWindow.getAllWindows().find(
        window => window.webContents.id === senderId
      )
      window?.webContents.send('model:delta', delta)
    }
  })

  function trusted(event: Electron.IpcMainInvokeEvent) {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !BrowserWindow.fromWebContents(event.sender)
    ) {
      throw new Error('Invalid sender')
    }
  }

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

  ipcMain.handle('connections:models', (event, id: string) => {
    trusted(event)

    return safely(async () => {
      if (typeof id !== 'string' || id.length > 100) {
        throw new Error('Choose a saved connection first.')
      }

      const connection = await store.resolve(id)

      if (connection.provider !== 'chatgpt') {
        throw new Error('Choose a ChatGPT account connection to load its models.')
      }

      return chatgpt.modelCatalog(connection.accountId ?? '')
    })
  })

  ipcMain.handle('model:list', (event, draft: ConnectionDraft) => {
    trusted(event)

    return safely(async () => {
      const connection = await store.resolveDraft(draft)

      if (connection.provider === 'chatgpt') {
        return chatgpt.models(connection.accountId ?? '')
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

    return safely(() => chatgpt.login(url => shell.openExternal(url), accountId))
  })
  ipcMain.handle('chatgpt:cancelLogin', event => {
    trusted(event)
    chatgpt.cancel()

    return { ok: true, value: undefined }
  })
  ipcMain.handle('chatgpt:signOut', (event, id: string) => {
    trusted(event)

    return safely(async () => {
      if (active.size) {
        throw new Error('Stop the current run before signing out.')
      }

      return chatgpt.signOut(id)
    })
  })
  ipcMain.handle('harness:save', (event, agentId: string, settings: HarnessSettings) => {
    trusted(event)

    if (
      typeof agentId !== 'string' ||
      agentId.length > 64 ||
      !settings ||
      JSON.stringify(settings).length > 100_000
    ) {
      return { ok: false, error: 'Invalid agent settings.' }
    }

    return agents.call('harness:save', agentId, settings)
  })
  ipcMain.handle(
    'harness:approve',
    (event, requestId: string, approvalId: string, allow: boolean) => {
      trusted(event)

      if (
        active.get(event.sender.id)?.id !== requestId ||
        typeof approvalId !== 'string' ||
        approvalId.length > 100 ||
        typeof allow !== 'boolean'
      ) {
        return { ok: false, error: 'This approval is no longer pending.' }
      }

      return agents.call('harness:approve', requestId, approvalId, allow)
    }
  )

  const routes: Record<string, { action: string; limits: number[] }> = {
    'harness:get': { action: 'harness:get', limits: [64] },
    'harness:skills': { action: 'harness:skills', limits: [64] },
    'harness:saveSkill': { action: 'harness:saveSkill', limits: [64, 64, 32_000] },
    'agents:list': { action: 'agents:list', limits: [] },
    'agents:create': { action: 'agents:create', limits: [80] },
    'agents:delete': { action: 'agents:delete', limits: [64] },
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

      if (
        args.length !== limits.length ||
        args.some((arg, i) => typeof arg !== 'string' || arg.length > limits[i])
      ) {
        return { ok: false, error: 'Invalid request.' }
      }

      return agents.call(action, ...args)
    })
  }

  ipcMain.handle(
    'model:stream',
    (
      event,
      requestId: string,
      agentId: string,
      conversationId: string,
      connectionId: string,
      text: string,
      model?: string
    ) => {
      trusted(event)

      return (async () => {
        if (
          typeof requestId !== 'string' ||
          !requestId ||
          requestId.length > 100 ||
          active.size ||
          typeof conversationId !== 'string' ||
          typeof agentId !== 'string' ||
          agentId.length > 64
        ) {
          return { ok: false, error: 'An agent is already working or the request is invalid.' }
        }

        const request = { id: requestId, stopped: false }
        active.set(event.sender.id, request)
        const destroyed = () => {
          request.stopped = true
          void agents.call('stop', requestId)
        }
        event.sender.once('destroyed', destroyed)

        try {
          const connection = await store.resolve(connectionId, model)

          if (connection.provider === 'chatgpt') {
            const catalog = await chatgpt.modelCatalog(connection.accountId ?? '')
            connection.model ||= catalog[0]?.id ?? ''

            if (!catalog.some(item => item.id === connection.model)) {
              throw new Error(
                'This model is no longer available. Refresh the model list and choose another model.'
              )
            }

            connection.baseUrl = 'https://api.openai.com/v1'
            connection.protocol = 'responses'
            connection.apiKey = await chatgpt.resolve(connection.accountId ?? '')
          }

          if (request.stopped) {
            return { ok: true, value: { stopped: true } }
          }

          return await agents.call('run', requestId, agentId, conversationId, connection, text)
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error ? error.message : 'Could not load the selected connection.'
          }
        } finally {
          event.sender.removeListener('destroyed', destroyed)
          active.delete(event.sender.id)
        }
      })()
    }
  )

  ipcMain.handle('model:stop', async (event, requestId: string) => {
    trusted(event)
    const request = active.get(event.sender.id)

    if (request?.id === requestId) {
      request.stopped = true
      await agents.call('stop', requestId)
    }
  })
}
