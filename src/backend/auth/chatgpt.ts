import { randomUUID } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { ChatGPTAccount } from '../../shared/harness.ts'
import { browserLogin } from './browser-login.ts'
import { atomicJson, readJson, seal, unseal, type CredentialProtection } from './storage.ts'

interface Tokens {
  access: string
  refresh: string
  identity: string
  expiresAt: number
  scopes: string[]
}

interface RecordEntry {
  id: string
  clientId: string
  subject: string
  email: string
  encrypted?: string
}

interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  revocation_endpoint?: string
}

async function accountJson(response: Response) {
  try {
    return await response.json()
  } catch {
    throw new Error('ChatGPT returned an invalid account response. Try signing in again.')
  }
}

// Endpoints are fixed in the desktop app. Dependency injection is only used by
// backend tests; the renderer cannot supply an OAuth or inference endpoint.
export class ChatGPTAccounts {
  private directory: string
  private protection: CredentialProtection
  private origin: string
  private discovery?: Discovery
  private jwks?: ReturnType<typeof createRemoteJWKSet>
  private queue: Promise<unknown> = Promise.resolve()
  private loginController?: AbortController
  private records: RecordEntry[] = []
  private hostId = ''
  private loaded = false

  constructor(
    directory: string,
    protection: CredentialProtection,
    origin = 'https://auth.openai.com'
  ) {
    this.directory = directory
    this.protection = protection
    this.origin = origin
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action)
    this.queue = next.catch(() => {})

    return next
  }

  private async load() {
    if (this.loaded) {
      return
    }

    const data = await readJson(this.directory, 'chatgpt-accounts.json')

    if (data) {
      if (
        typeof data.hostId !== 'string' ||
        !Array.isArray(data.accounts) ||
        data.accounts.some(
          (entry: RecordEntry) =>
            !entry ||
            typeof entry.id !== 'string' ||
            typeof entry.clientId !== 'string' ||
            typeof entry.subject !== 'string' ||
            typeof entry.email !== 'string' ||
            (entry.encrypted !== undefined && typeof entry.encrypted !== 'string')
        )
      ) {
        throw new Error('Invalid account storage. The existing file has been kept.')
      }

      this.hostId = data.hostId
      this.records = data.accounts
    } else {
      this.hostId = `urn:uuid:${randomUUID()}`
      await this.persist([])
    }

    this.loaded = true
  }

  private async persist(records: RecordEntry[]) {
    await atomicJson(this.directory, 'chatgpt-accounts.json', {
      hostId: this.hostId,
      accounts: records
    })
    this.records = records
  }

  private tokens(record: RecordEntry): Tokens | undefined {
    if (!record.encrypted) {
      return undefined
    }

    const value = unseal(this.protection, record.encrypted)

    if (
      typeof value.access !== 'string' ||
      typeof value.refresh !== 'string' ||
      typeof value.identity !== 'string' ||
      typeof value.expiresAt !== 'number' ||
      !Array.isArray(value.scopes)
    ) {
      throw new Error('Invalid saved credentials. Sign in again.')
    }

    return value
  }

  private public(record: RecordEntry): ChatGPTAccount {
    const tokens = this.tokens(record)

    return {
      id: record.id,
      email: record.email,
      signedIn: Boolean(tokens),
      planEnabled: Boolean(
        tokens?.scopes.includes('chatgpt.tokens.use.direct') &&
          tokens.scopes.includes('resource.invoke')
      )
    }
  }

  list() {
    return this.serialize(async () => {
      await this.load()

      return this.records.map(record => this.public(record))
    })
  }

  private async metadata(signal?: AbortSignal) {
    if (this.discovery) {
      return this.discovery
    }

    const response = await fetch(`${this.origin}/.well-known/openid-configuration`, {
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000)
    })

    if (!response.ok) {
      throw new Error('Could not load ChatGPT sign-in configuration.')
    }

    const data = (await accountJson(response)) as Discovery

    if (data.issuer !== this.origin) {
      throw new Error('Unexpected sign-in issuer.')
    }

    for (const endpoint of [
      data.authorization_endpoint,
      data.token_endpoint,
      data.jwks_uri,
      ...(data.revocation_endpoint ? [data.revocation_endpoint] : [])
    ]) {
      if (typeof endpoint !== 'string' || new URL(endpoint).origin !== this.origin) {
        throw new Error('Unexpected sign-in endpoint.')
      }
    }

    this.discovery = data

    return data
  }

  private async exchange(params: Record<string, string>, signal?: AbortSignal): Promise<any> {
    const metadata = await this.metadata(signal)
    const response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, resource: 'https://api.openai.com/v1' })
    })

    if (!response.ok) {
      throw new Error(
        'ChatGPT authorization failed. Sign in again; your existing account has been kept.'
      )
    }

    return accountJson(response)
  }

  private async verify(identity: string, clientId: string, nonce?: string): Promise<JWTPayload> {
    const metadata = await this.metadata()

    try {
      this.jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri))
      const { payload } = await jwtVerify(identity, this.jwks, {
        issuer: metadata.issuer,
        audience: clientId,
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5
      })

      if (!payload.sub || (nonce !== undefined && payload.nonce !== nonce)) {
        throw new Error()
      }

      return payload
    } catch {
      throw new Error('Could not verify the ChatGPT account. No credentials were saved.')
    }
  }

  private fromResponse(response: any, previous?: Tokens): Tokens {
    if (
      response.token_type?.toLowerCase() !== 'bearer' ||
      typeof response.access_token !== 'string' ||
      !Number.isFinite(response.expires_in) ||
      response.expires_in <= 0
    ) {
      throw new Error('ChatGPT returned an invalid token response.')
    }

    const scopes =
      typeof response.scope === 'string'
        ? response.scope.split(/\s+/).filter(Boolean)
        : previous?.scopes

    if (!scopes) {
      throw new Error('ChatGPT did not return granted permissions.')
    }

    return {
      access: response.access_token,
      refresh:
        typeof response.refresh_token === 'string'
          ? response.refresh_token
          : (previous?.refresh ?? ''),
      identity:
        typeof response.id_token === 'string' ? response.id_token : (previous?.identity ?? ''),
      expiresAt: Date.now() + response.expires_in * 1000,
      scopes
    }
  }

  async login(openBrowser: (url: string) => Promise<void>, accountId?: string) {
    if (this.loginController) {
      throw new Error('A ChatGPT sign-in is already in progress.')
    }

    const controller = new AbortController()
    this.loginController = controller
    const timeout = setTimeout(
      () => controller.abort(new Error('ChatGPT sign-in timed out. Try again.')),
      180_000
    )

    try {
      if (!this.protection.available()) {
        throw new Error(
          'Secure credential storage is unavailable. Unlock your system credential store before signing in.'
        )
      }

      const existing = await this.serialize(async () => {
        await this.load()

        return this.records.find(record => record.id === accountId)
      })

      if (accountId && !existing) {
        throw new Error('This account no longer exists.')
      }

      const metadata = await this.metadata(controller.signal)
      const { code, clientId, nonce, verifier, callbackUri } = await browserLogin({
        authorizationEndpoint: metadata.authorization_endpoint,
        hostId: this.hostId,
        clientId: existing?.clientId,
        signal: controller.signal,
        openBrowser
      })
      const response = await this.exchange(
        {
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: callbackUri
        },
        controller.signal
      )
      const tokens = this.fromResponse(response)
      const identity = await this.verify(tokens.identity, clientId, nonce)

      if (existing && identity.sub !== existing.subject) {
        throw new Error(
          'A different account was returned. The saved account has not been replaced.'
        )
      }

      controller.signal.throwIfAborted()

      return await this.serialize(async () => {
        const previous = this.records.find(
          record => record.clientId === clientId && record.subject === identity.sub
        )
        const record: RecordEntry = {
          id: previous?.id ?? randomUUID(),
          clientId,
          subject: identity.sub!,
          email: typeof identity.email === 'string' ? identity.email : 'ChatGPT account',
          encrypted: seal(this.protection, tokens)
        }
        await this.persist([...this.records.filter(item => item.id !== record.id), record])

        return this.public(record)
      })
    } finally {
      clearTimeout(timeout)
      controller.abort()
      this.loginController = undefined
    }
  }

  cancel() {
    this.loginController?.abort()
  }

  resolve(id: string): Promise<string> {
    return this.serialize(async () => {
      await this.load()
      const record = this.records.find(record => record.id === id)

      if (!record) {
        throw new Error('Choose a signed-in ChatGPT account in Settings.')
      }

      let tokens = this.tokens(record)

      if (!tokens) {
        throw new Error('Sign in to this ChatGPT account again.')
      }

      if (
        !tokens.scopes.includes('chatgpt.tokens.use.direct') ||
        !tokens.scopes.includes('resource.invoke')
      ) {
        throw new Error(
          'ChatGPT plan use was not authorized. Continue with ChatGPT and grant plan access.'
        )
      }

      if (tokens.expiresAt < Date.now() + 60_000) {
        if (!tokens.refresh) {
          throw new Error('This ChatGPT session expired. Sign in again.')
        }

        const response = await this.exchange({
          grant_type: 'refresh_token',
          client_id: record.clientId,
          refresh_token: tokens.refresh
        })
        const refreshed = this.fromResponse(response, tokens)

        if (
          response.id_token &&
          (await this.verify(response.id_token, record.clientId)).sub !== record.subject
        ) {
          throw new Error('ChatGPT returned a different account during refresh.')
        }

        tokens = refreshed
        await this.persist(
          this.records.map(item =>
            item.id === id ? { ...item, encrypted: seal(this.protection, tokens) } : item
          )
        )
      }

      if (
        !tokens.scopes.includes('chatgpt.tokens.use.direct') ||
        !tokens.scopes.includes('resource.invoke')
      ) {
        throw new Error(
          'ChatGPT plan access is no longer authorized. Sign in again to grant access.'
        )
      }

      return tokens.access
    })
  }

  async models(id: string) {
    const token = await this.resolve(id)
    const response = await fetch('https://api.openai.com/v1/models', {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!response.ok) {
      throw new Error(
        `Could not load ChatGPT models (HTTP ${response.status}). Check account access.`
      )
    }

    const data = (await accountJson(response)) as any

    if (!Array.isArray(data.models)) {
      throw new Error('ChatGPT returned an unexpected model catalog.')
    }

    return data.models
      .filter((model: any) => model.visibility === 'list' && typeof model.slug === 'string')
      .map((model: any) => model.slug) as string[]
  }

  signOut(id: string) {
    return this.serialize(async () => {
      await this.load()
      const record = this.records.find(record => record.id === id)

      if (!record) {
        throw new Error('Account not found.')
      }

      const tokens = this.tokens(record)
      let revoked = !tokens?.refresh

      if (tokens?.refresh) {
        try {
          const metadata = await this.metadata()

          if (metadata.revocation_endpoint) {
            const response = await fetch(metadata.revocation_endpoint, {
              method: 'POST',
              redirect: 'error',
              signal: AbortSignal.timeout(10_000),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                token: tokens.refresh,
                token_type_hint: 'refresh_token',
                client_id: record.clientId
              })
            })
            revoked = response.status === 200
            await response.body?.cancel()
          }
        } catch {
          /* always clear local credentials, report unconfirmed revocation */
        }
      }

      await this.persist(
        this.records.map(item => (item.id === id ? { ...item, encrypted: undefined } : item))
      )

      return { revoked }
    })
  }
}
