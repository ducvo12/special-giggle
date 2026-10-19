import type { StreamActivity } from '../../shared/chat'

export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  onActivity: (activity: StreamActivity) => void = () => {}
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let data: string[] = []
  let finished = false
  let hasText = false
  const activity: StreamActivity = { reasoningCharacters: 0, answerCharacters: 0 }

  function dispatch() {
    if (!data.length) {
      return
    }

    const value = data.join('\n')
    data = []

    if (value.trim() === '[DONE]') {
      finished = true

      return
    }

    let event: any

    try {
      event = JSON.parse(value)
    } catch {
      throw new Error('The server sent an invalid streaming event.')
    }

    if (event.error) {
      throw new Error('The model server reported an error while generating the reply.')
    }

    const choice = event.choices?.[0]
    const reasoning =
      choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? choice?.delta?.thinking

    if (typeof reasoning === 'string') {
      activity.reasoningCharacters += reasoning.length
    }

    if (typeof choice?.delta?.content === 'string' && choice.delta.content) {
      hasText = true
      activity.answerCharacters += choice.delta.content.length
      onText(choice.delta.content)
    }

    if (choice?.finish_reason != null) {
      finished = true
      activity.finishReason = String(choice.finish_reason)
    }

    onActivity({ ...activity })
  }

  function line(value: string) {
    if (value === '') {
      dispatch()
    } else if (value.startsWith('data:')) {
      data.push(value.slice(5).replace(/^ /, ''))
    }
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

        if (finished) {
          break
        }
      }

      if (pending.length > 1_000_000) {
        throw new Error('The server sent an oversized streaming event.')
      }

      if (done) {
        if (pending) {
          line(pending.replace(/\r$/, ''))
        }

        dispatch()

        if (!finished) {
          throw new Error(
            'The connection ended before the reply finished. The partial reply has been kept.'
          )
        }

        break
      }
    }

    if (activity.finishReason === 'length') {
      throw new Error(
        'The model reached its output limit before finishing. Any partial answer has been kept. Check generation settings in LM Studio and compare them with Open WebUI.'
      )
    }

    if (!hasText) {
      throw new Error(
        activity.reasoningCharacters
          ? 'The model generated reasoning but no answer text. Check the model’s reasoning and generation settings in LM Studio.'
          : 'The model returned no text.'
      )
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
