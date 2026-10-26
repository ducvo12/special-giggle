import type { Connection, ModelOption, Result } from '../../shared/chat.ts'

interface AccountModels {
  modelCatalog: (accountId: string) => Promise<ModelOption[]>
  resolve: (accountId: string) => Promise<string>
}

// One catalog per signed-in account and app session. Keep failures too, so an
// unavailable catalog does not become a new network request on every message.
export class AccountModelCatalog {
  private entries = new Map<string, { pending: boolean; promise: Promise<ModelOption[]> }>()
  private accounts: AccountModels

  constructor(accounts: AccountModels) { this.accounts = accounts }

  get(accountId: string, refresh = false): Promise<ModelOption[]> {
    let entry = this.entries.get(accountId)
    if (!entry || refresh && !entry.pending) {
      const next = { pending: true, promise: Promise.resolve([] as ModelOption[]) }
      next.promise = Promise.resolve().then(() => this.accounts.modelCatalog(accountId)).then(
        models => { next.pending = false; return structuredClone(models) },
        error => { next.pending = false; throw error }
      )
      this.entries.set(accountId, next)
      entry = next
    }
    return entry.promise.then(models => structuredClone(models))
  }

  warm(accountIds: string[]) {
    return Promise.allSettled([...new Set(accountIds)].map(id => this.get(id)))
  }

  invalidate(accountId: string) { this.entries.delete(accountId) }

  async refreshAfterError(connection: Connection, result: Result<unknown>) {
    if (!result.ok && result.code === 'model_access' && connection.provider === 'chatgpt') {
      // Keep the original inference error even if discovery is also unavailable.
      await this.get(connection.accountId ?? '', true).catch(() => {})
    }
  }

  async prepare(connection: Connection) {
    const accountId = connection.accountId ?? ''
    const models = await this.get(accountId)
    connection.model ||= models[0]?.id ?? ''
    if (!models.some(model => model.id === connection.model)) {
      throw new Error('This model is no longer available. Refresh the model list and choose another model.')
    }
    connection.baseUrl = 'https://api.openai.com/v1'
    connection.protocol = 'responses'
    connection.apiKey = await this.accounts.resolve(accountId)
  }
}
