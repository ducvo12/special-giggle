import type { StreamDelta } from '../../shared/chat.ts'

export function observeModelStream(requestId: string, emit: (delta: StreamDelta) => void) {
  const observation = { budgetExceeded: false }
  const activity = { reasoningCharacters: 0, answerCharacters: 0 }

  // Observe provider reasoning even when the SDK omits nonstandard fields.
  // Forward original bytes unchanged; never persist reasoning text or keys.
  const observedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, { ...init, redirect: 'error' })

    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      return response
    }

    let pending = ''
    const decoder = new TextDecoder()

    return new Response(
      response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, output) {
            output.enqueue(chunk)
            pending += decoder.decode(chunk, { stream: true })
            const lines = pending.split('\n')
            pending = lines.pop() ?? ''

            for (const line of lines) {
              if (!line.startsWith('data:')) {
                continue
              }

              try {
                const data = JSON.parse(line.slice(5))
                const delta = data.choices?.[0]?.delta
                const reasoning = delta?.reasoning_content ?? delta?.reasoning

                if (typeof reasoning === 'string') {
                  activity.reasoningCharacters += reasoning.length
                  emit({ requestId, text: '', activity: { ...activity } })
                }

                if (data.choices?.[0]?.finish_reason === 'length') {
                  observation.budgetExceeded = true
                }
              } catch {
                /* SSE includes [DONE] and provider keepalives */
              }
            }
          }
        })
      ),
      { status: response.status, headers: response.headers }
    )
  }

  return {
    fetch: observedFetch,
    activity,
    get budgetExceeded() {
      return observation.budgetExceeded
    }
  }
}
