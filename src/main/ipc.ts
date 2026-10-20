import { BrowserWindow, ipcMain, safeStorage } from 'electron'
import { listModels, safely } from '../backend/models/api'
import { ConnectionStore } from '../backend/connections/store'
import { AgentClient } from './agent-client'
import type { ConnectionDraft } from '../shared/chat'

export function registerIpc(directory: string) {
  const store = new ConnectionStore(directory, {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: text => safeStorage.encryptString(text),
    decrypt: data => safeStorage.decryptString(data)
  })
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

  ipcMain.handle('model:list', (event, draft: ConnectionDraft) => {
    trusted(event)

    return safely(async () => listModels(await store.resolveDraft(draft)))
  })

  const routes: Record<string, { action: string; limits: number[] }> = {
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
      text: string
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
          const connection = await store.resolve(connectionId)

          if (request.stopped) {
            return { ok: true, value: { stopped: true } }
          }

          return await agents.call('run', requestId, agentId, conversationId, connection, text)
        } catch {
          return { ok: false, error: 'Could not load the selected connection.' }
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
