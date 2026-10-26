import { validateConnection } from '../../models/api.ts'
import type { ModelOptions } from '../types.ts'
import { HarnessError, HostCapacityError, ModelAccessError, ModelConnectionError, isModelAccessCode } from '../types.ts'

export async function modelRequest(options: ModelOptions, path: string, body: unknown) {
  const { connection, signal } = options
  const url = new URL(path, validateConnection(connection))
  if (connection.provider === 'chatgpt' && url.href !== 'https://api.openai.com/v1/responses') {
    throw new HarnessError('ChatGPT plan access requires the official Responses endpoint.')
  }
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST', redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      headers: {
        'Content-Type': 'application/json', Accept: 'text/event-stream',
        ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {})
      },
      body: JSON.stringify(body)
    })
  } catch {
    signal.throwIfAborted()
    throw new ModelConnectionError('Could not reach the model. Check the connection, then Continue.')
  }
  if (response.ok) return response

  // Only explicit capacity codes are a host queue. Generic 429/503 errors may
  // mean exhausted quota or a broken server and must not wait indefinitely.
  let code = ''
  let param = ''
  try {
    const reader = response.body?.getReader()
    if (reader) {
      let raw = ''
      try {
        while (raw.length < 8192) {
          const chunk = await reader.read()
          if (chunk.done) break
          raw += new TextDecoder().decode(chunk.value)
        }
        const error = JSON.parse(raw).error
        code = error?.code ?? error?.type ?? ''
        param = error?.param ?? ''
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    }
  } catch { /* Provider errors are untrusted and never displayed verbatim. */ }
  if ([429, 503].includes(response.status) &&
      ['server_busy', 'model_busy', 'model_overloaded', 'no_available_slots'].includes(code)) {
    const retryAfter = Number(response.headers.get('retry-after'))
    throw new HostCapacityError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(60_000, retryAfter * 1000) : 2000)
  }
  const message = `Model request failed (HTTP ${response.status}). Check sign-in, model access, and account limits.`
  if ([400, 403, 404].includes(response.status) &&
      (isModelAccessCode(code) || param === 'model' || [403, 404].includes(response.status))) {
    throw new ModelAccessError(message)
  }
  if ([408, 502, 503, 504].includes(response.status)) throw new ModelConnectionError(message)
  throw new HarnessError(message)
}
