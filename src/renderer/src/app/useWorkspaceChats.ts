import { useEffect, useRef, useState } from 'react'
import type { MessageImage } from '../../../shared/message-images'
import type { AgentMessage, ConversationDetail } from '../../../shared/agent'
import type { Result, SavedConnection } from '../../../shared/chat'
import type { ConversationLocation } from '../../../shared/organization'
import type { ApprovalRequest } from '../../../shared/harness'
import { isLiveRun, type RunIntent, type RunSnapshot } from '../../../shared/run'
import { applyStreamDelta } from './conversation-stream'

export interface ChatIdentity {
  agentId: string
  id: string
}

interface MessageSubmission {
  images?: MessageImage[]
  messageId?: string
  location?: ConversationLocation
  started: (id: string) => void
  accepted: (chat: ConversationDetail) => void
}

export interface WorkspaceChatState {
  result?: Result<ConversationDetail>
  messages?: AgentMessage[]
  run?: RunSnapshot
  approval?: ApprovalRequest | null
  submitting?: boolean
  error?: string
}

export function chatKey(chat: ChatIdentity) {
  return JSON.stringify([chat.agentId, chat.id])
}

function runChatKey(run: RunSnapshot) {
  return chatKey({ agentId: run.agentId, id: run.conversationId })
}

function currentRun(records: Iterable<RunSnapshot>, key: string) {
  let latest: RunSnapshot | undefined
  for (const run of records) {
    if (runChatKey(run) !== key) continue
    // A live run still needs controls if a queued successor was cancelled.
    if (!latest || isLiveRun(run) || !isLiveRun(latest)) latest = run
  }
  return latest
}

const bridgeError = 'Could not communicate with the desktop backend.'

export function useWorkspaceChats() {
  const [chats, setChats] = useState(new Map<string, WorkspaceChatState>())
  const loads = useRef(new Map<string, Promise<Result<ConversationDetail>>>())
  const runRecords = useRef(new Map<string, RunSnapshot>())
  const submissions = useRef(new Map<string, string>())

  function update(key: string, change: (chat: WorkspaceChatState) => WorkspaceChatState) {
    setChats(current => new Map(current).set(key, change(current.get(key) ?? {})))
  }

  function setError(key: string, error: string) {
    update(key, chat => ({ ...chat, error }))
  }

  function finishSubmission(key: string, id: string) {
    if (submissions.current.get(key) !== id) return
    submissions.current.delete(key)
    update(key, chat => ({ ...chat, submitting: false }))
  }

  useEffect(() => {
    let mounted = true
    const off = window.granite.onDelta(delta => {
      if (delta.run) runRecords.current.set(delta.run.id, delta.run)
      const owner = runRecords.current.get(delta.requestId)
      if (!owner) return

      const key = runChatKey(owner)
      const publishedRun = delta.run ? currentRun(runRecords.current.values(), key) : undefined
      // The runtime publishes a new run only after accepting its input in storage.
      if (delta.run) finishSubmission(key, delta.run.id)
      setChats(current => {
        const chat = current.get(key)
        if (!chat) return current

        const run = publishedRun ?? chat.run
        const existing = chat.messages ?? (chat.result?.ok ? chat.result.value.messages : [])
        let messages = delta.messages ?? chat.messages
        if (!delta.messages && (delta.text || delta.tool || delta.contextUsage)) {
          messages = applyStreamDelta(existing, delta)
        }

        let approval: ApprovalRequest | null = null
        if (run?.phase === 'approval') {
          approval = delta.requestId === run.id && delta.approval !== undefined
            ? delta.approval
            : chat.run?.id === run.id ? chat.approval ?? null : null
        }
        return new Map(current).set(key, { ...chat, run, messages, approval })
      })
    })

    void window.granite.runs.list().then(result => {
      if (!mounted || !result.ok) return
      // Deltas can arrive while the initial snapshot is in transit.
      runRecords.current = new Map([...result.value.map(run => [run.id, run] as const), ...runRecords.current])
      const records = [...runRecords.current.values()]
      setChats(current => new Map([...current].map(([key, chat]) => [key, { ...chat, run: currentRun(records, key) }])))
    }, () => {
      // Live deltas still populate run controls if history is unavailable.
    })
    return () => {
      mounted = false
      off()
    }
  }, [])

  function load(identity: ChatIdentity, refresh = false) {
    const key = chatKey(identity)
    if (!refresh && (loads.current.has(key) || chats.get(key)?.result)) return
    const { agentId, id } = identity
    const priorMessages = chats.get(key)?.messages
    const run = currentRun(runRecords.current.values(), key)
    update(key, chat => ({ ...chat, run: chat.run ?? run }))

    const request = window.granite.conversations.get(agentId, id)
    loads.current.set(key, request)
    function publish(result: Result<ConversationDetail>) {
      if (loads.current.get(key) !== request) return
      loads.current.delete(key)
      update(key, chat => ({
        ...chat, result,
        messages: refresh && chat.messages === priorMessages ? undefined : chat.messages
      }))
    }
    void request.then(publish, () => publish({ ok: false, error: 'Could not load this conversation.' }))
  }

  function rememberAccepted(conversation: ConversationDetail, requestId: string) {
    const accepted = conversation.messages.find(message => message.id === requestId)!
    const key = chatKey(conversation)
    loads.current.delete(key)
    update(key, chat => ({
      ...chat,
      result: { ok: true, value: conversation },
      messages: chat.messages && !chat.messages.some(message => message.id === requestId)
        ? [...chat.messages, accepted] : chat.messages
    }))
  }

  function prune(isOpen: (key: string) => boolean) {
    const closed = [...chats].filter(([key, chat]) =>
      !isOpen(key) && !chat.submitting && !(chat.run && isLiveRun(chat.run))
    ).map(([key]) => key)
    if (!closed.length) return

    for (const key of closed) loads.current.delete(key)
    setChats(current => {
      const remaining = new Map(current)
      for (const key of closed) remaining.delete(key)
      return remaining
    })
  }

  async function reconcileInterruptedRun(identity: ChatIdentity, requestId: string) {
    const previous = runRecords.current.get(requestId)
    if (!previous || !isLiveRun(previous)) return

    // An IPC failure can bypass the final delta. The next worker request recovers saved work.
    const [runs, result] = await Promise.all([
      window.granite.runs.list(),
      window.granite.conversations.get(identity.agentId, identity.id)
    ])
    const recovered = runs.ok ? runs.value.find(run => run.id === requestId) : undefined
    if (!recovered || isLiveRun(recovered) || runRecords.current.get(requestId) !== previous) return

    runRecords.current.set(requestId, recovered)
    const key = chatKey(identity)
    const run = currentRun(runRecords.current.values(), key)
    update(key, chat => run?.id === requestId && result.ok
      ? { ...chat, run, result, messages: undefined, approval: null }
      : { ...chat, run })
  }

  async function submit(
    identity: ChatIdentity,
    connection: SavedConnection | undefined,
    model: string,
    effort: string,
    text: string,
    intent: RunIntent,
    message?: MessageSubmission
  ) {
    const key = chatKey(identity)
    if (submissions.current.has(key)) return
    const requestId = crypto.randomUUID()
    const messageId = message ? message.messageId ?? crypto.randomUUID() : undefined
    submissions.current.set(key, requestId)
    update(key, chat => ({ ...chat, submitting: true, error: '' }))

    try {
      if (message && messageId) {
        message.started(messageId)
        const accepted = await window.granite.conversations.acceptMessage(identity.agentId, identity.id, messageId, text, message.location, message.images)
        if (!accepted.ok) {
          setError(key, accepted.error)
          return
        }
        rememberAccepted(accepted.value, messageId)
        message.accepted(accepted.value)
      }

      if (!connection) {
        setError(key, 'Connect an available model to run pending messages.')
        return
      }

      const result = await window.granite.stream(requestId, identity.agentId, identity.id, connection.id, text,
        connection.provider === 'chatgpt' ? model : undefined, effort, message ? 'accepted' : intent, messageId)
      if (result.ok) return
      setError(key, result.error)
      await reconcileInterruptedRun(identity, requestId).catch(() => {
        // Keep the original submission error when the worker is still unavailable.
      })
      if (result.code === 'model_access') {
        const catalog = await window.granite.connections.models(connection.id)
        if (catalog.ok) window.dispatchEvent(new CustomEvent('granite:models-refreshed', {
          detail: { connectionId: connection.id, models: catalog.value }
        }))
      }
    } catch {
      setError(key, bridgeError)
    } finally {
      finishSubmission(key, requestId)
    }
  }

  return { chats, load, prune, submit, setError }
}
