import { reasoningMetadata } from './catalog.ts'
import { readEventStream } from './event-stream.ts'
import type { Connection, Message, ModelOption, Result, StreamActivity } from '../../shared/chat'

export function validateConnection(connection: Connection): URL {
  if (
    !connection ||
    typeof connection.baseUrl !== 'string' ||
    typeof connection.apiKey !== 'string' ||
    typeof connection.model !== 'string'
  ) {
    throw new Error('Invalid connection settings.')
  }

  const url = new URL(connection.baseUrl.trim())

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTP or HTTPS API base URL without credentials, query parameters, or a fragment.'
    )
  }

  url.pathname = url.pathname.replace(/\/+$/, '') + '/'

  return url
}

async function responseFor(
  connection: Connection,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<Response> {
  const base = validateConnection(connection)
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(connection.apiKey.trim() ? { Authorization: `Bearer ${connection.apiKey.trim()}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(600_000)])
      : AbortSignal.timeout(30_000)
  })

  if (!response.ok) {
    // Don't echo provider responses: they may contain credentials or request content.
    throw new Error(
      `Server returned HTTP ${response.status}. Check the API URL, key, and model access.`
    )
  }

  return response
}

async function request(connection: Connection, path: string, body?: unknown): Promise<any> {
  const response = await responseFor(connection, path, body)

  try {
    return await response.json()
  } catch {
    throw new Error(
      'The server did not return JSON. Check that the URL ends at the API prefix, usually /v1.'
    )
  }
}

export async function safely<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    let message = error instanceof Error ? error.message : 'Connection failed.'

    if (message === 'fetch failed') {
      message =
        'Could not reach the server. Check its address, network access, and whether the model server is running.'
    }

    if (error instanceof Error && error.name === 'TimeoutError') {
      message = 'The server timed out. Check that the model is loaded and try again.'
    }

    return { ok: false, error: message }
  }
}

export async function listModelCatalog(connection: Connection): Promise<ModelOption[]> {
  const data = await request(connection, 'models')
  if (!Array.isArray(data.data)) {
    throw new Error('The server returned an unexpected model list.')
  }
  return data.data.flatMap((model: any) =>
    typeof model?.id === 'string'
      ? [{ id: model.id, name: model.id, ...reasoningMetadata(model) }]
      : []
  )
}

export async function listModels(connection: Connection): Promise<string[]> {
  return (await listModelCatalog(connection)).map(model => model.id)
}

export async function chat(connection: Connection, messages: Message[]): Promise<string> {
  validateConnection(connection)

  if (!connection.model.trim()) {
    throw new Error('Choose or enter a model ID first.')
  }

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 200 ||
    messages.some(
      message =>
        !message ||
        !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' ||
        message.content.length > 100_000
    )
  ) {
    throw new Error('Invalid or oversized conversation. Start a new chat.')
  }

  const data = await request(connection, 'chat/completions', {
    model: connection.model.trim(),
    messages,
    stream: false
  })
  const content = data.choices?.[0]?.message?.content

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('The model returned no text. Check that it supports Chat Completions.')
  }

  return content
}

export async function streamChat(
  connection: Connection,
  messages: Message[],
  signal: AbortSignal,
  onText: (text: string) => void,
  onActivity: (activity: StreamActivity) => void = () => {}
): Promise<void> {
  validateConnection(connection)

  if (!connection.model.trim()) {
    throw new Error('Choose a model first.')
  }

  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > 200 ||
    messages.some(
      message =>
        !message ||
        !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' ||
        message.content.length > 100_000
    )
  ) {
    throw new Error('Invalid or oversized conversation. Start a new chat.')
  }

  const response = await responseFor(
    connection,
    'chat/completions',
    {
      model: connection.model.trim(),
      messages: messages.map(({ role, content }) => ({ role, content })),
      stream: true
    },
    signal
  )

  if (!response.body) {
    throw new Error('The server returned no response stream.')
  }

  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body.cancel()
    throw new Error(
      'This endpoint did not return a streaming response. Use a server that supports streaming Chat Completions.'
    )
  }

  await readEventStream(response.body, onText, onActivity)
}
