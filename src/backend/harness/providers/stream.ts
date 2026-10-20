import { HarnessError } from '../types.ts'

// Both model transports use SSE. Completion is determined by the adapter's
// terminal event; a disconnected stream is never treated as a completed turn.
export async function readModelEvents(response: Response, dispatch: (event: any) => boolean) {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()

  if (!response.body || (contentType && contentType !== 'text/event-stream')) {
    await response.body?.cancel()
    throw new HarnessError(
      'The model did not return an event stream. Check the connection protocol.'
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let data: string[] = []
  let size = 0
  let terminal = false
  let formatConfirmed = contentType === 'text/event-stream'
  let firstLine = true

  const line = (value: string) => {
    if (firstLine) {
      value = value.replace(/^\uFEFF/, '')
      firstLine = false
    }

    // Some subscription responses omit Content-Type while returning valid SSE.
    // Confirm an SSE field before accepting a stream without that header.
    if (!formatConfirmed && value) {
      if (!/^(?:data:|event:|id:|retry:|:)/.test(value)) {
        throw new HarnessError('The model did not return a valid event stream.')
      }

      formatConfirmed = true
    }

    if (value.startsWith('data:')) {
      data.push(value.slice(5).replace(/^ /, ''))
    }

    if (value !== '' || !data.length) {
      return
    }

    const raw = data.join('\n')
    data = []

    if (raw === '[DONE]') {
      terminal = dispatch({ type: 'done' })

      return
    }

    let event

    try {
      event = JSON.parse(raw)
    } catch {
      throw new HarnessError('The model returned an invalid stream.')
    }

    terminal = dispatch(event)
  }

  try {
    while (!terminal) {
      const { value, done } = await reader.read()
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true })
      size += value?.byteLength ?? 0

      if (pending.length > 4_000_000 || size > 24_000_000) {
        throw new HarnessError('The model response exceeded the run budget.')
      }

      let match

      while ((match = /\r\n|\n|\r(?!$)/.exec(pending))) {
        line(pending.slice(0, match.index))
        pending = pending.slice(match.index + match[0].length)

        if (terminal) {
          break
        }
      }

      if (done) {
        if (pending) {
          line(pending.replace(/\r$/, ''))
        }

        line('')

        if (!terminal) {
          throw new HarnessError(
            'The connection ended before the model finished. Partial text and completed actions are kept.'
          )
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
