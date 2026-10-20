import { validateConnection } from '../../models/api.ts'
import type { ModelOptions } from '../types.ts'
import { HarnessError } from '../types.ts'

export async function modelRequest(options: ModelOptions, path: string, body: unknown) {
  const { connection, signal } = options
  const url = new URL(path, validateConnection(connection))

  // Subscription tokens must only go to the supported public inference service.
  if (connection.provider === 'chatgpt' && url.href !== 'https://api.openai.com/v1/responses') {
    throw new HarnessError('ChatGPT plan access requires the official Responses endpoint.')
  }

  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {})
      },
      body: JSON.stringify(body)
    })

    if (response.ok) {
      return response
    }

    await response.body?.cancel()

    if ([502, 503, 504].includes(response.status) && attempt < 2) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          reject(signal.reason)
        }
        const timer = setTimeout(
          () => {
            signal.removeEventListener('abort', abort)
            resolve()
          },
          250 * (attempt + 1)
        )
        signal.addEventListener('abort', abort, { once: true })
      })
      continue
    }

    throw new HarnessError(
      `Model request failed (HTTP ${response.status}). Check sign-in, model access, and account limits.`
    )
  }
}
