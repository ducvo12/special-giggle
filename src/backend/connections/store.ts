import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectionDraft, SavedConnection, Connection } from '../../shared/chat'
import { validateConnection } from '../models/api.ts'

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
      validateConnection(draft)

      if (typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 100) {
        throw new Error('Enter a connection name (up to 100 characters).')
      }

      if (!draft.model.trim()) {
        throw new Error('Choose or enter a model ID.')
      }

      const previous = this.records.find(record => record.id === draft.id)

      if (draft.id && !previous) {
        throw new Error('Connection no longer exists.')
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
        encryptedKey
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

  resolve(id: string): Promise<Connection> {
    return this.serialize(async () => {
      await this.load()
      const record = this.records.find(item => item.id === id)

      if (!record) {
        throw new Error('Choose a saved connection first.')
      }

      return { baseUrl: record.baseUrl, model: record.model, apiKey: this.decrypt(record) }
    })
  }

  resolveDraft(draft: ConnectionDraft): Promise<Connection> {
    return this.serialize(async () => {
      await this.load()
      validateConnection(draft)
      const previous = this.records.find(record => record.id === draft.id)
      // Never forward an existing secret to a changed endpoint without re-entry.
      const sameEndpoint = previous?.baseUrl === draft.baseUrl.trim().replace(/\/+$/, '')
      const apiKey =
        draft.apiKey.trim() || (!draft.removeKey && sameEndpoint ? this.decrypt(previous) : '')

      return { baseUrl: draft.baseUrl, model: draft.model, apiKey }
    })
  }
}
