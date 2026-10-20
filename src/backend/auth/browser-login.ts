import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

interface BrowserLoginOptions {
  authorizationEndpoint: string
  hostId: string
  clientId?: string
  signal: AbortSignal
  openBrowser: (url: string) => Promise<void>
}

// One browser transaction owns its listener, PKCE values, state, and callback.
// Account verification and credential persistence happen after this completes.
export async function browserLogin(options: BrowserLoginOptions) {
  const { signal } = options
  signal.throwIfAborted()
  let server: Server | undefined
  let onAbort: (() => void) | undefined

  try {
    const state = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    const verifier = randomBytes(64).toString('base64url')
    let callbackUri = '',
      consumed = false
    const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
      const abort = () => reject(new Error('ChatGPT sign-in was cancelled or timed out.'))
      onAbort = abort
      signal.addEventListener('abort', abort, { once: true })
      server = createServer((request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        let url: URL

        try {
          url = new URL(request.url ?? '/', callbackUri)
        } catch {
          response.writeHead(400).end('Invalid callback.')

          return
        }

        if (
          url.origin !== new URL(callbackUri).origin ||
          request.headers.host !== new URL(callbackUri).host
        ) {
          response.writeHead(400).end('Invalid callback host.')

          return
        }

        if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
          response.writeHead(404).end('Not found')

          return
        }

        if (consumed || url.searchParams.get('state') !== state) {
          response.writeHead(400).end('Invalid sign-in state. Return to Granite and try again.')

          return
        }

        consumed = true
        signal.removeEventListener('abort', abort)
        const clientId = url.searchParams.get('client_id') ?? options.clientId ?? ''
        const code = url.searchParams.get('code') ?? ''

        if (
          url.searchParams.has('error') ||
          !code ||
          code.length > 4096 ||
          !/^[a-zA-Z0-9_-]{3,200}$/.test(clientId) ||
          clientId === 'dynamic_agent_client' ||
          (options.clientId && clientId !== options.clientId)
        ) {
          response.writeHead(400).end('Sign-in was not completed. Return to Granite to try again.')
          reject(new Error('ChatGPT sign-in was declined or registration was incomplete.'))

          return
        }

        response.end('Authorization received. Return to Granite to finish connecting.', () =>
          resolve({ code, clientId })
        )
      })
      server.on('error', () => reject(new Error('Could not start the local sign-in callback.')))
    })
    // Attach rejection handling before awaiting browser launch or local listen.
    void callback.catch(() => {})
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject)
      server!.listen(0, '127.0.0.1', resolve)
    })
    callbackUri = `http://127.0.0.1:${(server!.address() as { port: number }).port}/auth/callback`
    const authorize = new URL(options.authorizationEndpoint)
    authorize.search = new URLSearchParams({
      client_id: options.clientId ?? 'dynamic_agent_client',
      ...(!options.clientId ? { agent_name_hint: 'Granite' } : {}),
      ext_agent_host_id: options.hostId,
      response_type: 'code',
      redirect_uri: callbackUri,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource: 'https://api.openai.com/v1',
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url')
    }).toString()
    signal.throwIfAborted()
    await options.openBrowser(authorize.href)
    const { code, clientId } = await callback

    return { code, clientId, nonce, verifier, callbackUri }
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort)
    }

    server?.closeAllConnections()
    server?.close()
  }
}
