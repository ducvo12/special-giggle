import { HarnessError } from '../types.ts'

// Both model transports use SSE. Completion is determined by the adapter's
// terminal event; a disconnected stream is never treated as a completed turn.
export async function readModelEvents(response: Response, dispatch: (event: any) => boolean) {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
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

  const line = (value: string) => {
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
