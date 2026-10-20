import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectionDraft, SavedConnection, Connection } from '../../shared/chat'
import { validateConnection } from '../models/api.ts'

function validateDraft(draft: ConnectionDraft) {
  if (
    !draft ||
    (draft.provider !== undefined && !['openai', 'codex', 'chatgpt'].includes(draft.provider))
  ) {
    throw new Error('Choose a supported connection type.')
  }

  if (draft.provider === 'codex') {
    throw new Error('Reconnect this legacy connection with ChatGPT or a Responses API connection.')
  }

  if (draft.provider === 'chatgpt') {
    if (
      typeof draft.accountId !== 'string' ||
      !draft.accountId ||
      draft.accountId.length > 100 ||
      typeof draft.model !== 'string'
    ) {
      throw new Error('Choose a signed-in ChatGPT account.')
    }
  } else {
    validateConnection(draft)
  }

  if (draft.protocol !== undefined && !['chat-completions', 'responses'].includes(draft.protocol)) {
    throw new Error('Choose a supported API protocol.')
  }

  if (
    draft.effort !== undefined &&
    !/^(|none|minimal|low|medium|high|xhigh|max|ultra)$/.test(draft.effort)
  ) {
    throw new Error('Choose a supported reasoning effort.')
  }
}

interface StoredConnection extends Omit<SavedConnection, 'hasKey'> {
  encryptedKey?: string
}

interface SecretStorage {
  available: () => boolean
  encrypt: (text: string) => Buffer
  decrypt: (data: Buffer) => string
}

export class ConnectionStore {
  private records: StoredConnection[] = []
  private loaded = false
  private queue: Promise<unknown> = Promise.resolve()
  private directory: string
  private secrets: SecretStorage

  constructor(directory: string, secrets: SecretStorage) {
    this.directory = directory
    this.secrets = secrets
  }

  private async load() {
    if (this.loaded) {
      return
    }

    try {
      const data = JSON.parse(await readFile(join(this.directory, 'connections.json'), 'utf8'))

      if (
        !Array.isArray(data) ||
        data.some(
          item =>
            !item ||
            typeof item.id !== 'string' ||
            typeof item.name !== 'string' ||
            typeof item.baseUrl !== 'string' ||
            typeof item.model !== 'string' ||
            (item.provider !== undefined &&
              !['openai', 'codex', 'chatgpt'].includes(item.provider)) ||
            (item.accountId !== undefined && typeof item.accountId !== 'string') ||
            (item.protocol !== undefined &&
              !['chat-completions', 'responses'].includes(item.protocol)) ||
            (item.codexPath !== undefined && typeof item.codexPath !== 'string') ||
            (item.effort !== undefined && typeof item.effort !== 'string') ||
            (item.encryptedKey !== undefined && typeof item.encryptedKey !== 'string')
        )
      ) {
        throw new Error('Invalid connection file')
      }

      this.records = data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          'Could not read saved connections. Your connection file has not been overwritten.'
        )
      }
    }

    this.loaded = true
  }

  private public(record: StoredConnection): SavedConnection {
    const { encryptedKey, ...connection } = record

    return { ...connection, hasKey: Boolean(encryptedKey) }
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action)
    this.queue = next.catch(() => {})

    return next
  }

  list(): Promise<SavedConnection[]> {
    return this.serialize(async () => {
      await this.load()

      return this.records.map(record => this.public(record))
    })
  }

  private async persist(records: StoredConnection[]) {
    await mkdir(this.directory, { recursive: true })
    const temporary = join(this.directory, `connections-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(records, null, 2), { mode: 0o600 })
    await rename(temporary, join(this.directory, 'connections.json'))
    this.records = records
  }

  private decrypt(record?: StoredConnection): string {
    if (!record?.encryptedKey) {
      return ''
    }

    if (!this.secrets.available()) {
      throw new Error(
        'Secure credential storage is unavailable. Unlock your system credential store and try again.'
      )
    }

    try {
      return this.secrets.decrypt(Buffer.from(record.encryptedKey, 'base64'))
    } catch {
      throw new Error('Could not unlock the saved API key. Enter the key again in Settings.')
    }
  }

  save(draft: ConnectionDraft): Promise<SavedConnection> {
    return this.serialize(async () => {
      await this.load()
      validateDraft(draft)

      if (typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 100) {
        throw new Error('Enter a connection name (up to 100 characters).')
      }

      if (draft.provider !== 'chatgpt' && !draft.model.trim()) {
        throw new Error('Choose or enter a model ID.')
      }

      const previous = this.records.find(record => record.id === draft.id)

      if (draft.id && !previous) {
        throw new Error('Connection no longer exists.')
      }

      if (draft.provider === 'chatgpt') {
        if (this.records.some(record =>
          record.id !== draft.id &&
          (record.provider === 'chatgpt' || record.provider === 'codex') &&
          record.accountId === draft.accountId
        )) {
          throw new Error('This ChatGPT account already has a connection. Edit that connection or sign in with a different account.')
        }

        const record: StoredConnection = {
          id: previous?.id ?? randomUUID(),
          provider: 'chatgpt',
          protocol: 'responses',
          accountId: draft.accountId,
          name: draft.name.trim(),
          baseUrl: '',
          model: draft.model.trim(),
          effort: draft.effort || ''
        }
        await this.persist([...this.records.filter(item => item.id !== record.id), record])

        return this.public(record)
      }

      if (
        previous?.encryptedKey &&
        previous.baseUrl !== draft.baseUrl.trim().replace(/\/+$/, '') &&
        !draft.apiKey.trim() &&
        !draft.removeKey
      ) {
        throw new Error('The API URL changed. Re-enter the API key or remove it before saving.')
      }

      let encryptedKey = draft.removeKey ? undefined : previous?.encryptedKey

      if (draft.apiKey.trim()) {
        if (!this.secrets.available()) {
          throw new Error(
            'Secure credential storage is unavailable. This connection cannot save an API key on this device.'
          )
        }

        encryptedKey = this.secrets.encrypt(draft.apiKey.trim()).toString('base64')
      }

      const record: StoredConnection = {
        id: previous?.id ?? randomUUID(),
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
        model: draft.model.trim(),
        encryptedKey,
        protocol: draft.protocol ?? 'chat-completions',
        effort: draft.effort || ''
      }
      await this.persist([...this.records.filter(item => item.id !== record.id), record])

      return this.public(record)
    })
  }

  delete(id: string): Promise<void> {
    return this.serialize(async () => {
      await this.load()
      await this.persist(this.records.filter(record => record.id !== id))
    })
  }

  resolve(id: string, model?: string): Promise<Connection> {
    return this.serialize(async () => {
      await this.load()
      const record = this.records.find(item => item.id === id)

      if (!record) {
        throw new Error('Choose a saved connection first.')
      }

      if (model !== undefined) {
        if (typeof model !== 'string' || !model.trim() || model.length > 200) {
          throw new Error('Choose a valid model.')
        }

        if (record.provider !== 'chatgpt') {
          throw new Error('Model switching is available for ChatGPT account connections.')
        }
      }

      return {
        provider: record.provider,
        protocol: record.protocol,
        accountId: record.accountId,
        effort: record.effort,
        baseUrl: record.baseUrl,
        model: model?.trim() ?? record.model,
        apiKey:
          record.provider === 'chatgpt' || record.provider === 'codex' ? '' : this.decrypt(record)
      }
    })
  }

  resolveDraft(draft: ConnectionDraft): Promise<Connection> {
    return this.serialize(async () => {
      await this.load()
      validateDraft(draft)

      if (draft.provider === 'chatgpt') {
        return { ...draft, baseUrl: 'https://api.openai.com/v1', protocol: 'responses', apiKey: '' }
      }

      const previous = this.records.find(record => record.id === draft.id)
      // Never forward an existing secret to a changed endpoint without re-entry.
      const sameEndpoint = previous?.baseUrl === draft.baseUrl.trim().replace(/\/+$/, '')
      const apiKey =
        draft.apiKey.trim() || (!draft.removeKey && sameEndpoint ? this.decrypt(previous) : '')

      return {
        provider: draft.provider,
        protocol: draft.protocol,
        effort: draft.effort,
        baseUrl: draft.baseUrl,
        model: draft.model,
        apiKey
      }
    })
  }
}
