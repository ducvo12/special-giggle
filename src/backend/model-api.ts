import type { Connection, Message, Result, StreamActivity } from '../shared/chat'

export function validateConnection(connection: Connection): URL {
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

async function responseFor(connection: Connection, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const base = validateConnection(connection)
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(connection.apiKey.trim() ? { Authorization: `Bearer ${connection.apiKey.trim()}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600_000)]) : AbortSignal.timeout(30_000)
  })
  if (!response.ok) {
    // Don't echo provider responses: they may contain credentials or request content.
    throw new Error(`Server returned HTTP ${response.status}. Check the API URL, key, and model access.`)
  }
  return response
}

async function request(connection: Connection, path: string, body?: unknown): Promise<any> {
  const response = await responseFor(connection, path, body)
  try { return await response.json() } catch { throw new Error('The server did not return JSON. Check that the URL ends at the API prefix, usually /v1.') }
}

export async function safely<T>(action: () => Promise<T>): Promise<Result<T>> {
  try { return { ok: true, value: await action() } } catch (error) {
    let message = error instanceof Error ? error.message : 'Connection failed.'
    if (message === 'fetch failed') message = 'Could not reach the server. Check its address, network access, and whether the model server is running.'
    if (error instanceof Error && error.name === 'TimeoutError') message = 'The server timed out. Check that the model is loaded and try again.'
    return { ok: false, error: message }
  }
}

export async function listModels(connection: Connection): Promise<string[]> {
  const data = await request(connection, 'models')
  if (!Array.isArray(data.data)) throw new Error('The server returned an unexpected model list.')
  return data.data.map((model: any) => model?.id).filter((id: unknown): id is string => typeof id === 'string')
}

export async function chat(connection: Connection, messages: Message[]): Promise<string> {
  validateConnection(connection)
  if (!connection.model.trim()) throw new Error('Choose or enter a model ID first.')
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200 || messages.some(message =>
    !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 100_000
  )) throw new Error('Invalid or oversized conversation. Start a new chat.')
  const data = await request(connection, 'chat/completions', { model: connection.model.trim(), messages, stream: false })
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('The model returned no text. Check that it supports Chat Completions.')
  return content
}


export async function streamChat(connection: Connection, messages: Message[], signal: AbortSignal, onText: (text: string) => void, onActivity: (activity: StreamActivity) => void = () => {}): Promise<void> {
  validateConnection(connection)
  if (!connection.model.trim()) throw new Error('Choose a model first.')
  if (!Array.isArray(messages) || !messages.length || messages.length > 200 || messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 100_000)) {
    throw new Error('Invalid or oversized conversation. Start a new chat.')
  }
  const response = await responseFor(connection, 'chat/completions', {
    model: connection.model.trim(),
    messages: messages.map(({ role, content }) => ({ role, content })),
    stream: true
  }, signal)
  if (!response.body) throw new Error('The server returned no response stream.')
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body.cancel()
    throw new Error('This endpoint did not return a streaming response. Use a server that supports streaming Chat Completions.')
  }
  await readEventStream(response.body, onText, onActivity)
}

export async function readEventStream(body: ReadableStream<Uint8Array>, onText: (text: string) => void, onActivity: (activity: StreamActivity) => void = () => {}): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let data: string[] = []
  let finished = false
  let hasText = false
  const activity: StreamActivity = { reasoningCharacters: 0, answerCharacters: 0 }
  function dispatch() {
    if (!data.length) return
    const value = data.join('\n')
    data = []
    if (value.trim() === '[DONE]') { finished = true; return }
    let event: any
    try { event = JSON.parse(value) } catch { throw new Error('The server sent an invalid streaming event.') }
    if (event.error) throw new Error('The model server reported an error while generating the reply.')
    const choice = event.choices?.[0]
    const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? choice?.delta?.thinking
    if (typeof reasoning === 'string') activity.reasoningCharacters += reasoning.length
    if (typeof choice?.delta?.content === 'string' && choice.delta.content) {
      hasText = true
      activity.answerCharacters += choice.delta.content.length
      onText(choice.delta.content)
    }
    if (choice?.finish_reason != null) { finished = true; activity.finishReason = String(choice.finish_reason) }
    onActivity({ ...activity })
  }
  function line(value: string) {
    if (value === '') dispatch()
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''))
  }
  try {
    while (!finished) {
      const { value, done } = await reader.read()
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let match: RegExpExecArray | null
      while ((match = /\r\n|\n|\r(?!$)/.exec(pending))) {
        const current = pending.slice(0, match.index)
        pending = pending.slice(match.index + match[0].length)
        line(current)
        if (finished) break
      }
      if (pending.length > 1_000_000) throw new Error('The server sent an oversized streaming event.')
      if (done) {
        if (pending) line(pending.replace(/\r$/, ''))
        dispatch()
        if (!finished) throw new Error('The connection ended before the reply finished. The partial reply has been kept.')
        break
      }
    }
    if (activity.finishReason === 'length') throw new Error('The model reached its output limit before finishing. Any partial answer has been kept. Check generation settings in LM Studio and compare them with Open WebUI.')
    if (!hasText) throw new Error(activity.reasoningCharacters
      ? 'The model generated reasoning but no answer text. Check the model’s reasoning and generation settings in LM Studio.'
      : 'The model returned no text.')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
