import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatGPTAccounts } from '../src/backend/auth/chatgpt.ts'

const protection = {
  available: () => true,
  encrypt: (text: string) => Buffer.from(text.split('').reverse().join('')),
  decrypt: (value: Buffer) => value.toString().split('').reverse().join('')
}

test(
  'Granite ChatGPT OAuth verifies identity, protects tokens, retains registration, serializes refresh, and revokes its own session',
  { timeout: 20_000 },
  async context => {
    const directory = await mkdtemp(join(tmpdir(), 'granite-oauth-'))
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' }
    let origin = '',
      nonce = '',
      subject = 'test-subject',
      badNonce = false,
      noPlan = false
    let tokenRequests: URLSearchParams[] = []
    let refreshes = 0,
      revoked = false
    const server = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'application/json')

      if (request.url === '/.well-known/openid-configuration') {
        return response.end(
          JSON.stringify({
            issuer: origin,
            authorization_endpoint: origin + '/authorize',
            token_endpoint: origin + '/token',
            jwks_uri: origin + '/jwks',
            revocation_endpoint: origin + '/revoke'
          })
        )
      }

      if (request.url === '/jwks') {
        return response.end(JSON.stringify({ keys: [jwk] }))
      }

      let raw = ''

      for await (const chunk of request) {
        raw += chunk
      }

      const params = new URLSearchParams(raw)

      if (request.url === '/revoke') {
        revoked = params.get('token') === 'refresh-test'
        response.end()

        return
      }

      tokenRequests.push(params)

      if (params.get('grant_type') === 'refresh_token') {
        refreshes++
        response.end(
          JSON.stringify({
            token_type: 'Bearer',
            access_token: 'refreshed-access-test',
            refresh_token: 'refresh-test',
            expires_in: 3600
          })
        )

        return
      }

      const identity = await new SignJWT({
        email: 'test@example.com',
        nonce: badNonce ? 'wrong' : nonce
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(origin)
        .setAudience('oaiapp_granite_test')
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey)
      response.end(
        JSON.stringify({
          token_type: 'Bearer',
          access_token: 'access-test',
          refresh_token: 'refresh-test',
          id_token: identity,
          expires_in: 1,
          scope: noPlan
            ? 'openid email'
            : 'openid email offline_access resource.invoke chatgpt.tokens.use.direct'
        })
      )
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as any).port}`
    const accounts = new ChatGPTAccounts(directory, protection, origin)
    const signIn = (id?: string) =>
      accounts.login(async raw => {
        const url = new URL(raw)
        nonce = url.searchParams.get('nonce')!
        assert.equal(url.searchParams.get('agent_name_hint'), id ? null : 'Granite')
        assert.equal(
          url.searchParams.get('client_id'),
          id ? 'oaiapp_granite_test' : 'dynamic_agent_client'
        )
        assert.match(url.searchParams.get('ext_agent_host_id')!, /^urn:uuid:/)
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
        const callback = new URL(url.searchParams.get('redirect_uri')!)
        callback.search = new URLSearchParams({
          code: 'test-code',
          state: 'incorrect-state',
          client_id: 'oaiapp_granite_test'
        }).toString()
        assert.equal(
          (await fetch(callback)).status,
          400,
          'invalid state cannot consume the attempt'
        )
        callback.searchParams.set('state', url.searchParams.get('state')!)
        assert.equal((await fetch(callback)).status, 200)
      }, id)

    try {
      badNonce = true
      await assert.rejects(signIn(), /verify/)
      assert.deepEqual(await accounts.list(), [])
      badNonce = false
      const account = await signIn()
      assert.equal(account.email, 'test@example.com')
      assert.equal(account.planEnabled, true)
      const saved = await readFile(join(directory, 'chatgpt-accounts.json'), 'utf8')
      assert.doesNotMatch(saved, /access-test|refresh-test|eyJ/)
      assert.doesNotMatch(
        JSON.stringify(await accounts.list()),
        /access-test|refresh-test|clientId/
      )
      assert.equal(tokenRequests.at(-1)!.get('code_verifier')!.length > 40, true)
      assert.match(tokenRequests.at(-1)!.get('redirect_uri')!, /^http:\/\/127.0.0.1:/)
      const restored = new ChatGPTAccounts(directory, protection, origin)
      const results = await Promise.all([
        restored.resolve(account.id),
        restored.resolve(account.id)
      ])
      assert.deepEqual(results, ['refreshed-access-test', 'refreshed-access-test'])
      assert.equal(refreshes, 1)

      const originalFetch = globalThis.fetch
      const catalogFetch = context.mock.method(globalThis, 'fetch', async (input, init) => {
        if (String(input) !== 'https://api.openai.com/v1/models') {
          return originalFetch(input, init)
        }

        assert.equal(init.headers.Authorization, 'Bearer refreshed-access-test')

        return Response.json({
          models: [
            { slug: 'account-model-b', display_name: 'Account Model B', visibility: 'list' },
            { slug: 'hidden-model', visibility: 'hide' },
            null,
            { slug: 'account-model-a', visibility: 'list' },
            { slug: 'account-model-b', display_name: 'Duplicate', visibility: 'list' },
            { slug: '', visibility: 'list' }
          ]
        })
      })

      try {
        assert.deepEqual(await restored.modelCatalog(account.id), [
          { id: 'account-model-b', name: 'Account Model B' },
          { id: 'account-model-a', name: 'account-model-a' }
        ])
        assert.deepEqual(await restored.models(account.id), ['account-model-b', 'account-model-a'])
      } finally {
        catalogFetch.mock.restore()
      }

      subject = 'another-user'
      await assert.rejects(signIn(account.id), /different account/)
      subject = 'test-subject'
      assert.equal((await accounts.list())[0].id, account.id)
      assert.deepEqual(await restored.signOut(account.id), { revoked: true })
      assert.equal(revoked, true)
      await assert.rejects(restored.resolve(account.id), /Sign in/)
      const reloaded = new ChatGPTAccounts(directory, protection, origin)
      const signedAgain = await reloaded.login(async raw => {
        const url = new URL(raw)
        nonce = url.searchParams.get('nonce')!
        assert.equal(url.searchParams.get('client_id'), 'oaiapp_granite_test')
        const callback = new URL(url.searchParams.get('redirect_uri')!)
        callback.search = new URLSearchParams({
          code: 'again',
          state: url.searchParams.get('state')!
        }).toString()
        await fetch(callback)
      }, account.id)
      assert.equal(signedAgain.id, account.id)
      noPlan = true
      const notGranted = await signIn()
      assert.equal(notGranted.planEnabled, false)
      await assert.rejects(accounts.resolve(notGranted.id), /not authorized/)
      let opened: () => void
      const ready = new Promise<void>(resolve => {
        opened = resolve
      })
      const pending = accounts.login(async () => {
        opened()
      })
      await ready
      accounts.cancel()
      await assert.rejects(pending, /cancelled/)
      await assert.rejects(
        new ChatGPTAccounts(directory, { ...protection, available: () => false }, origin).login(
          async () => assert.fail()
        ),
        /Secure credential/
      )
    } finally {
      accounts.cancel()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }
)
