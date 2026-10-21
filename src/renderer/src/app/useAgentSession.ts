import { responseClock } from '../features/chat/response-clock'
import { beginTiming, recordDelta, finishTiming, bindTiming } from '../features/chat/devTimings'
import { useEffect, useRef, useState } from 'react'
import type { SavedConnection, StreamActivity } from '../../../shared/chat'
import type { ApprovalRequest } from '../../../shared/harness'
import type { Agent, AgentMessage, Conversation } from '../../../shared/agent'
import { useConnectionModel } from '../features/chat/useConnectionModel'

const bridgeError = 'Could not communicate with the desktop backend.'

export function useAgentSession() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState('')
  const selection = useRef(0)
  const currentAgent = useRef('')

  const [connections, setConnections] = useState<SavedConnection[]>([])
  const [selectedId, setSelectedId] = useState(
    () => localStorage.getItem('granite.connection') ?? ''
  )

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationId, setConversationId] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [draft, setDraft] = useState('')

  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [activity, setActivity] = useState<StreamActivity>({
    reasoningCharacters: 0,
    answerCharacters: 0
  })
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [managingAgents, setManagingAgents] = useState(false)
  const agentOperation = useRef(false)

  const run = useRef<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  const locked = messages.find(message => message.role === 'assistant' && message.model)
  const connection = connections.find(item => item.id === (locked?.connectionId ?? (locked ? connections.find(item => item.model === locked.model)?.id : undefined) ?? selectedId))
  const modelSelection = useConnectionModel(connection, locked?.model, conversationId, [...messages].reverse().find(message => message.role === 'assistant')?.effort)
  const agent = agents.find(agent => agent.id === agentId)

  async function loadConversation(id: string, owner = agentId, timingId?: string) {
    const result = await window.granite.conversations.get(owner, id)

    if (currentAgent.current !== owner) {
      return
    }

    if (!result.ok) {
      setError(result.error)

      return
    }

    const reply = result.value.messages[result.value.messages.length - 1]
    if (timingId && reply?.role === 'assistant') {
      bindTiming(timingId, reply.id)
      if (reply.status === 'complete') {
        responseClock.bind(timingId, reply.id, reply.content, (messageId, durationMs) => {
          void window.granite.conversations.saveResponseDuration(owner, id, messageId, durationMs)
            .then(result => { if (!result.ok) setError(result.error) })
            .catch(() => setError('Could not save the response duration.'))
        })
      }
    }
    setConversationId(id)
    setMessages(result.value.messages)
  }

  async function refreshList() {
    const result = await window.granite.conversations.list(agentId)

    if (result.ok) {
      setConversations(result.value)
    } else {
      setError(result.error)
    }
  }

  async function selectAgent(id: string) {
    if (run.current) {
      return
    }

    const token = ++selection.current
    currentAgent.current = id
    setAgentId(id)
    setLoaded(false)

    setMessages([])
    setConversations([])
    setConversationId('')
    setDraft('')
    setError('')

    if (!id) {
      localStorage.removeItem('granite.agent')
      setLoaded(true)

      return
    }

    try {
      const chats = await window.granite.conversations.list(id)

      if (token !== selection.current) {
        return
      }

      if (!chats.ok) {
        throw new Error(chats.error)
      }

      setConversations(chats.value)

      const saved =
        localStorage.getItem(`granite.conversation.${id}`) ??
        (id === 'atlas' ? localStorage.getItem('granite.conversation') : null)
      const chat = chats.value.find(chat => chat.id === saved) ?? chats.value[0]

      if (chat) {
        await loadConversation(chat.id, id)
      }

      localStorage.setItem('granite.agent', id)
    } catch (error) {
      if (token === selection.current) {
        setError(error instanceof Error ? error.message : bridgeError)
      }
    } finally {
      if (token === selection.current) {
        setLoaded(true)
      }
    }
  }

  useEffect(() => {
    let mounted = true
    void Promise.all([window.granite.connections.list(), window.granite.agents.list()])
      .then(async ([connections, agents]) => {
        if (!mounted) {
          return
        }

        if (connections.ok) {
          setConnections(connections.value)
          setSelectedId(current =>
            connections.value.some(item => item.id === current)
              ? current
              : (connections.value[0]?.id ?? '')
          )
        } else {
          setError(connections.error)
        }

        if (!agents.ok) {
          setError(agents.error)
          setLoaded(true)

          return
        }

        setAgents(agents.value)

        const saved = localStorage.getItem('granite.agent')
        const selected = agents.value.find(agent => agent.id === saved) ?? agents.value[0]

        if (selected) {
          await selectAgent(selected.id)
        } else {
          setLoaded(true)
        }
      })
      .catch(() => {
        if (mounted) {
          setError(bridgeError)
          setLoaded(true)
        }
      })

    const off = window.granite.onDelta(delta => {
      if (delta.requestId !== run.current) {
        return
      }

      recordDelta(delta)

      if (Object.hasOwn(delta, 'approval')) {
        setApproval(delta.approval ?? null)
      }

      if (delta.activity) {
        setActivity(delta.activity)
      }

      setMessages(current =>
        current.map((message, index) => {
          if (index !== current.length - 1 || message.role !== 'assistant') {
            return message
          }

          const tools = delta.tool
            ? [...(message.tools ?? []).filter(t => t.id !== delta.tool!.id), delta.tool]
            : message.tools

          return { ...message, content: message.content + delta.text, tools }
        })
      )
    })

    return () => {
      mounted = false
      ++selection.current
      off()
    }
  }, [])

  useEffect(() => {
    if (!busy) {
      return
    }

    const started = Date.now()
    setElapsed(0)

    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000
    )

    return () => window.clearInterval(timer)
  }, [busy])

  useEffect(() => {
    localStorage.setItem('granite.connection', selectedId)
  }, [selectedId])

  useEffect(() => {
    if (conversationId) {
      localStorage.setItem(`granite.conversation.${agentId}`, conversationId)
    }
  }, [conversationId, agentId])

  async function send() {
    if (
      run.current ||
      agentOperation.current ||
      !draft.trim() ||
      !connection ||
      !modelSelection.ready ||
      !agent ||
      !loaded
    ) {
      return
    }

    const requestId = crypto.randomUUID()
    const text = draft.trim()
    responseClock.begin(requestId)
    beginTiming(requestId)
    run.current = requestId
    follow.current = true
    setBusy(true)
    setStopping(false)
    setError('')
    setDraft('')
    setActivity({ reasoningCharacters: 0, answerCharacters: 0 })
    let id = conversationId

    try {
      if (!id) {
        const created = await window.granite.conversations.create(agent.id)

        if (!created.ok) {
          throw new Error(created.error)
        }

        id = created.value.id
        setConversationId(id)
      }

      setMessages(current => [
        ...current,
        { id: crypto.randomUUID(), role: 'user', content: text },
        {
          id: requestId,
          role: 'assistant',
          content: '',
          model: modelSelection.model,
          connectionId: connection.id,
          effort: modelSelection.effort,
          tools: [],
          status: 'running'
        }
      ])

      const result = await window.granite.stream(
        requestId,
        agent.id,
        id,
        connection.id,
        text,
        connection.provider === 'chatgpt' ? modelSelection.model : undefined,
        modelSelection.effort
      )

      finishTiming(requestId)
      if (!result.ok) {
        setError(result.error)
      }

      await loadConversation(id, agent.id, requestId)
      await refreshList()
    } catch (error) {
      setError(error instanceof Error ? error.message : bridgeError)
      setDraft(text)
    } finally {
      finishTiming(requestId)
      run.current = null
      setApproval(null)
      setBusy(false)
      setStopping(false)
    }
  }

  async function stop() {
    if (!run.current) {
      return
    }

    setStopping(true)

    try {
      await window.granite.stop(run.current)
    } catch {
      setError(bridgeError)
      setStopping(false)
    }
  }

  async function renameConversation(id: string, title: string) {
    if (run.current || agentOperation.current || !loaded) return false
    agentOperation.current = true
    setManagingAgents(true)
    setError('')
    try {
      const result = await window.granite.conversations.rename(agentId, id, title)
      if (!result.ok) {
        setError(result.error)
        return false
      }
      setConversations(current => current.map(chat => chat.id === id ? { ...chat, title: title.trim() } : chat))
      return true
    } catch {
      setError(bridgeError)
      return false
    } finally {
      agentOperation.current = false
      setManagingAgents(false)
    }
  }

  async function deleteConversation(id: string) {
    if (run.current || agentOperation.current || !loaded) {
      return false
    }

    agentOperation.current = true
    setManagingAgents(true)
    setError('')

    try {
      const result = await window.granite.conversations.delete(agentId, id)
      if (!result.ok) {
        setError(result.error)
        return false
      }

      setConversations(current => current.filter(chat => chat.id !== id))
      if (localStorage.getItem(`granite.conversation.${agentId}`) === id) {
        localStorage.removeItem(`granite.conversation.${agentId}`)
      }
      if (agentId === 'atlas' && localStorage.getItem('granite.conversation') === id) {
        localStorage.removeItem('granite.conversation')
      }
      if (conversationId === id) {
        setConversationId('')
        setMessages([])
        setDraft('')
      }
      return true
    } catch {
      setError(bridgeError)
      return false
    } finally {
      agentOperation.current = false
      setManagingAgents(false)
    }
  }

  async function deleteAgent(id: string) {
    if (run.current || agentOperation.current) {
      return false
    }

    agentOperation.current = true
    setManagingAgents(true)
    setError('')

    try {
      const result = await window.granite.agents.delete(id)

      if (!result.ok) {
        setError(result.error)

        return false
      }

      const remaining = agents.filter(agent => agent.id !== id)
      setAgents(remaining)
      localStorage.removeItem(`granite.conversation.${id}`)

      if (id === 'atlas') {
        localStorage.removeItem('granite.conversation')
      }

      if (id === currentAgent.current) {
        await selectAgent(remaining[0]?.id ?? '')
      }

      return true
    } catch {
      setError(bridgeError)

      return false
    } finally {
      agentOperation.current = false
      setManagingAgents(false)
    }
  }

  return {
    agents,
    managingAgents,
    agentId,
    agent,
    connections,
    setConnections,
    selectedId,
    setSelectedId,
    connection,
    modelSelection,
    conversations,
    conversationId,
    loaded,
    messages,
    draft,
    setDraft,
    busy,
    stopping,
    approval,
    async approve(allow: boolean) {
      if (!approval || approval.requestId !== run.current) {
        return
      }

      const result = await window.granite.harness.approve(approval.requestId, approval.id, allow)

      if (!result.ok) {
        setError(result.error)
      }
    },
    activity,
    elapsed,
    error,
    setError,
    end,
    follow,
    loadConversation,
    selectAgent,
    send,
    stop,
    deleteAgent,
    deleteConversation,
    renameConversation,
    newChat() {
      setConversationId('')
      setMessages([])
      setError('')
      setDraft('')
    },
    async addAgent(created: Agent) {
      setAgents(current => [...current, created])
      await selectAgent(created.id)
    }
  }
}
