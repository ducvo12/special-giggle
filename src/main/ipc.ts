import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { listModels, listModelCatalog, safely } from '../backend/models/api'
import { ConnectionStore } from '../backend/connections/store'
import { AgentClient } from './agent-client'
import type { ConnectionDraft } from '../shared/chat'
import type { RunIntent } from '../shared/run'
import { ChatGPTAccounts } from '../backend/auth/chatgpt'
import { AccountModelCatalog } from '../backend/models/account-catalog'
import type { HarnessSettings } from '../shared/harness'
import type { ConversationLocation } from '../shared/organization'
import type { AgentOrganization } from '../shared/organization'
import { realpath, stat } from 'node:fs/promises'
import { RepositoryEditors } from './repository-editors'
import { ConnectionUsageStore, type UsageBinding } from '../backend/connections/usage'

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
  const modelCatalog = new AccountModelCatalog(chatgpt)
  const repositoryEditors = new RepositoryEditors(directory)
  // Start discovery before the window opens. Model pickers and messages share
  // this request; later messages use the session's cached result.
  void store.list().then(connections => modelCatalog.warm(connections
    .filter(connection => connection.provider === 'chatgpt' && connection.accountId)
    .map(connection => connection.accountId!))).catch(() => {})
  app.on('before-quit', () => chatgpt.cancel())
  const usage = new ConnectionUsageStore()
  const publishUsage = () => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('connections:usage', usage.list())
  }
  const active = new Map<string, { senderId: number; stopped: boolean; usageBinding?: UsageBinding }>()
  const agents = new AgentClient(directory, delta => {
    const binding = active.get(delta.requestId)?.usageBinding
    if (binding && delta.rateLimits && usage.observe(binding, delta.rateLimits)) publishUsage()
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('model:delta', delta)
  })
  let quitting = false
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void agents.call('shutdown').finally(() => app.quit())
  })

  function trusted(event: Electron.IpcMainInvokeEvent) {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !BrowserWindow.fromWebContents(event.sender)
    ) {
      throw new Error('Invalid sender')
    }
  }

  async function repositoryFolder(agentId: unknown, projectId: unknown) {
    if ([agentId, projectId].some(value => typeof value !== 'string' || !value || value.length > 100)) throw new Error('Choose a repository project.')
    const result = await agents.call('organization:get', agentId)
    if (!result.ok) throw new Error(result.error)
    const project = (result.value as AgentOrganization).projects.find(project => project.id === projectId)
    if (!project?.repositoryPath) throw new Error('This project has no repository folder.')
    try {
      const folder = await realpath(project.repositoryPath)
      if (!(await stat(folder)).isDirectory()) throw new Error('Not a folder')
      return folder
    } catch { throw new Error('The repository folder cannot be found. Check its location in Project settings.') }
  }

  async function chooseRepositoryEditor(event: Electron.IpcMainInvokeEvent, folder: string) {
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
      title: 'Open repository with…', buttonLabel: 'Open repository', properties: ['openFile'],
      ...(process.platform === 'darwin' ? { defaultPath: '/Applications', filters: [{ name: 'Applications', extensions: ['app'] }] }
        : process.platform === 'win32' ? { filters: [{ name: 'Applications', extensions: ['exe'] }] } : {})
    })
    return selected.canceled || !selected.filePaths[0] ? null : repositoryEditors.openApplication(folder, selected.filePaths[0])
  }

  ipcMain.handle('repositories:editors', event => {
    trusted(event)
    return safely(() => repositoryEditors.choices())
  })
  ipcMain.handle('repositories:open', (event, agentId, projectId, editorId) => {
    trusted(event)
    return safely(async () => {
      if (editorId !== undefined && (typeof editorId !== 'string' || editorId.length > 100)) throw new Error('Choose an installed editor.')
      const folder = await repositoryFolder(agentId, projectId)
      if (editorId === undefined && !(await repositoryEditors.choices()).selectedId) return chooseRepositoryEditor(event, folder)
      return repositoryEditors.open(folder, editorId)
    })
  })
  ipcMain.handle('repositories:chooseEditor', (event, agentId, projectId) => {
    trusted(event)
    return safely(async () => chooseRepositoryEditor(event, await repositoryFolder(agentId, projectId)))
  })

  ipcMain.handle('connections:list', event => {
    trusted(event)

    return safely(() => store.list())
  })

  ipcMain.handle('connections:usage', event => {
    trusted(event)

    return { ok: true, value: usage.list() }
  })

  ipcMain.handle('connections:save', (event, draft: ConnectionDraft) => {
    trusted(event)

    return safely(async () => {
      const saved = await store.save(draft)
      usage.invalidate(saved.id)
      publishUsage()
      return saved
    })
  })

  ipcMain.handle('connections:delete', (event, id: string) => {
    trusted(event)

    return safely(async () => {
      await store.delete(id)
      usage.invalidate(id)
      publishUsage()
    })
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
      if (active.size) {
        throw new Error('Stop the current run before signing out.')
      }

      const result = await chatgpt.signOut(id)
      for (const connection of await store.list()) {
        if (connection.accountId === id) usage.invalidate(connection.id)
      }
      publishUsage()
      modelCatalog.invalidate(id)
      return result
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
        typeof requestId !== 'string' || requestId.length > 100 ||
        typeof approvalId !== 'string' ||
        approvalId.length > 100 ||
        typeof allow !== 'boolean'
      ) {
        return { ok: false, error: 'This approval is no longer pending.' }
      }

      return agents.call('harness:approve', requestId, approvalId, allow)
    }
  )

  ipcMain.handle('conversations:responseDuration', (event, agentId, id, messageId, durationMs) => {
    trusted(event)
    if ([agentId, id, messageId].some(value => typeof value !== 'string' || !value || value.length > 100) ||
      !Number.isSafeInteger(durationMs) || durationMs < 0) {
      return { ok: false, error: 'Invalid response timing.' }
    }
    return agents.call('responseDuration', agentId, id, messageId, durationMs)
  })

  ipcMain.handle('workspace:save', (event, agentId, path, content, expected) => {
    trusted(event)
    if (typeof agentId !== 'string' || agentId.length > 64 || typeof path !== 'string' || path.length > 1024 ||
        typeof content !== 'string' || content.length > 100_000 ||
        !(expected === null || typeof expected === 'string' && expected.length <= 100_000)) {
      return { ok: false, error: 'Invalid file edit.' }
    }
    return agents.call('workspace:save', agentId, path, content, expected)
  })

  ipcMain.handle('repositories:review', (event, agentId, id, runId, acknowledge) => {
    trusted(event)
    if ([agentId,id,runId].some(value => typeof value !== 'string' || !value || value.length > 100) || typeof acknowledge !== 'boolean') return { ok: false, error: 'Invalid repository review.' }
    return agents.call('repositories:review', agentId, id, runId, acknowledge)
  })

  const routes: Record<string, { action: string; limits: number[] }> = {
    'repositories:reports': { action: 'repositories:reports', limits: [64, 100] },
    'organization:createRepository': { action: 'organization:createRepository', limits: [64, 100] },
    'runs:list': { action: 'runs:list', limits: [] },
    'runs:recovery': { action: 'runs:recovery', limits: [] },
    'runs:dismissRecovery': { action: 'runs:dismissRecovery', limits: [] },
    'runs:cancelPending': { action: 'runs:cancelPending', limits: [64, 100] },
    'organization:get': { action: 'organization:get', limits: [64] },
    'organization:createSection': { action: 'organization:createSection', limits: [64, 80, 6] },
    'organization:renameSection': { action: 'organization:renameSection', limits: [64, 100, 80] },
    'organization:shareSection': { action: 'organization:shareSection', limits: [64, 100] },
    'organization:renameProject': { action: 'organization:renameProject', limits: [64, 100, 80] },
    'harness:get': { action: 'harness:get', limits: [64] },
    'harness:skills': { action: 'harness:skills', limits: [64] },
    'harness:saveSkill': { action: 'harness:saveSkill', limits: [64, 64, 32_000] },
    'agents:list': { action: 'agents:list', limits: [] },
    'agents:create': { action: 'agents:create', limits: [80] },
    'agents:delete': { action: 'agents:delete', limits: [64] },
    'agents:saveIdentity': { action: 'agents:saveIdentity', limits: [64, 32_000, 100_000] },
    'conversations:list': { action: 'list', limits: [64] },
    'conversations:rename': { action: 'rename', limits: [64, 100, 200] },
    'conversations:delete': { action: 'delete', limits: [64, 100] },
    'conversations:get': { action: 'get', limits: [64, 100] },
    'workspace:entries': { action: 'entries', limits: [64, 1024] },
    'workspace:renameNote': { action: 'workspace:renameNote', limits: [64, 1024, 120] },
    'workspace:read': { action: 'read', limits: [64, 1024] }
  }

  function validLocation(value: unknown, optional = false): value is Partial<ConversationLocation> {
    if (value === undefined) return optional
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const location = value as Record<string, unknown>
    return Object.keys(location).every(key => key === 'sectionId' || key === 'projectId') &&
      (location.sectionId === undefined ? optional : typeof location.sectionId === 'string' && location.sectionId.length <= 100) &&
      (location.projectId === undefined ? optional : location.projectId === null || typeof location.projectId === 'string' && location.projectId.length <= 100)
  }
  ipcMain.handle('conversations:create', (event, agentId, location) => {
    trusted(event)
    if (typeof agentId !== 'string' || agentId.length > 64 || !validLocation(location, true)) return { ok: false, error: 'Invalid chat location.' }
    return agents.call('create', agentId, location)
  })
  ipcMain.handle('conversations:move', (event, agentId, id, location) => {
    trusted(event)
    if (typeof agentId !== 'string' || agentId.length > 64 || typeof id !== 'string' || id.length > 100 || !validLocation(location)) return { ok: false, error: 'Invalid chat location.' }
    return agents.call('move', agentId, id, location)
  })
  async function pickRepositoryFolder(event: Electron.IpcMainInvokeEvent) {
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
      title: 'Choose a repository folder', properties: ['openDirectory'], buttonLabel: 'Choose folder'
    })
    return selected.canceled ? null : selected.filePaths[0] ?? null
  }
  ipcMain.handle('organization:pickRepositoryFolder', event => {
    trusted(event)
    return safely(() => pickRepositoryFolder(event))
  })
  ipcMain.handle('organization:createProject', (event, agentId, sectionId, name, repositoryPath = null, createRepository = false) => {
    trusted(event)
    if ([agentId, sectionId, name].some((value, index) => typeof value !== 'string' || value.length > [64, 100, 80][index]) ||
        repositoryPath !== null && (typeof repositoryPath !== 'string' || repositoryPath.length > 4096) ||
        typeof createRepository !== 'boolean' || createRepository && repositoryPath !== null) {
      return { ok: false, error: 'Invalid project details.' }
    }
    return agents.call('organization:createProject', agentId, sectionId, name, repositoryPath, createRepository)
  })
  ipcMain.handle('organization:chooseRepository', async (event, agentId, projectId) => {
    trusted(event)
    if (typeof agentId !== 'string' || agentId.length > 64 || typeof projectId !== 'string' || projectId.length > 100) {
      return { ok: false, error: 'Finish the current operation before linking a folder.' }
    }
    return safely(async () => {
      const selected = await pickRepositoryFolder(event)
      if (!selected) return null
      const result = await agents.call('organization:attachRepository', agentId, projectId, selected)
      if (!result.ok) throw new Error(result.error)
      return result.value
    })
  })

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
      model?: string,
      effort?: string,
      intent: RunIntent = 'message'
    ) => {
      trusted(event)

      return (async () => {
        if (
          typeof requestId !== 'string' ||
          !requestId ||
          requestId.length > 100 ||
          active.has(requestId) ||
          quitting ||
          typeof conversationId !== 'string' ||
          typeof agentId !== 'string' ||
          agentId.length > 64 || conversationId.length > 100 ||
          typeof text !== 'string' || text.length > 32_000 ||
          !['message', 'continue', 'pending'].includes(intent)
        ) {
          return { ok: false, error: 'This request is invalid or has already been accepted.' }
        }

        const request: { senderId: number; stopped: boolean; usageBinding?: UsageBinding } = { senderId: event.sender.id, stopped: false }
        active.set(requestId, request)

        try {
          const connection = await store.resolve(connectionId, model)
          request.usageBinding = usage.bind(connectionId, connection.model)
          connection.connectionId = connectionId
          if (effort !== undefined) {
            if (typeof effort !== 'string' || !/^(|none|minimal|low|medium|high|xhigh|max|ultra)$/.test(effort)) {
              throw new Error('Choose a supported reasoning level.')
            }
            connection.effort = effort
          }

          if (connection.provider === 'chatgpt') {
            await modelCatalog.prepare(connection)
          }

          if (request.stopped) {
            return { ok: true, value: { stopped: true } }
          }

          const result = await agents.call('run', requestId, agentId, conversationId, connection, text, intent)
          // Refresh availability, but never replay a run or its completed tools.
          await modelCatalog.refreshAfterError(connection, result)
          return result
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error ? error.message : 'Could not load the selected connection.'
          }
        } finally {
          active.delete(requestId)
        }
      })()
    }
  )

  ipcMain.handle('model:stop', async (event, requestId: string) => {
    trusted(event)
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100) return
    const request = active.get(requestId)
    if (request) request.stopped = true
    await agents.call('stop', requestId)
  })
}
