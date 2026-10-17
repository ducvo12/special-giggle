import type { Connection, Message, Result } from '../shared/chat'

function validate(connection: Connection): URL {
  if (!connection || typeof connection.baseUrl !== 'string' || typeof connection.apiKey !== 'string' || typeof connection.model !== 'string') {
    throw new Error('Invalid connection settings.')
  }
  const url = new URL(connection.baseUrl.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS API base URL without credentials, query parameters, or a fragment.')
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/'
  return url
}

async function request(connection: Connection, path: string, body?: unknown): Promise<any> {
  const base = validate(connection)
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(connection.apiKey.trim() ? { Authorization: `Bearer ${connection.apiKey.trim()}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120_000)
  })
  if (!response.ok) {
    // Don't echo provider responses: they may contain credentials or request content.
    throw new Error(`Server returned HTTP ${response.status}. Check the API URL, key, and model access.`)
  }
  try { return await response.json() } catch { throw new Error('The server did not return JSON. Check that the URL ends at the API prefix, usually /v1.') }
}

export async function safely<T>(action: () => Promise<T>): Promise<Result<T>> {
  try { return { ok: true, value: await action() } } catch (error) {
    let message = error instanceof Error ? error.message : 'Connection failed.'
    if (message === 'fetch failed') message = 'Could not reach the server. Check its address, network access, and whether the model server is running.'
    if (error instanceof Error && error.name === 'TimeoutError') message = 'The server took longer than two minutes to respond.'
    return { ok: false, error: message }
  }
}

export async function listModels(connection: Connection): Promise<string[]> {
  const data = await request(connection, 'models')
  if (!Array.isArray(data.data)) throw new Error('The server returned an unexpected model list.')
  return data.data.map((model: any) => model?.id).filter((id: unknown): id is string => typeof id === 'string')
}

export async function chat(connection: Connection, messages: Message[]): Promise<string> {
  validate(connection)
  if (!connection.model.trim()) throw new Error('Choose or enter a model ID first.')
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200 || messages.some(message =>
    !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 100_000
  )) throw new Error('Invalid or oversized conversation. Start a new chat.')
  const data = await request(connection, 'chat/completions', { model: connection.model.trim(), messages, stream: false })
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('The model returned no text. Check that it supports Chat Completions.')
  return content
}
