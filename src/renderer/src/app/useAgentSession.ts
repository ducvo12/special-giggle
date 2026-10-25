import { ConversationStream } from './conversation-stream'
import { responseClock } from '../features/chat/response-clock'
import { beginTiming, recordDelta, finishTiming, bindTiming } from '../features/chat/devTimings'
import { useEffect, useRef, useState } from 'react'
import type { Result, SavedConnection, StreamActivity } from '../../../shared/chat'
import type { ApprovalRequest } from '../../../shared/harness'
import type { Agent, AgentMessage, Conversation } from '../../../shared/agent'
import { useConnectionModel } from '../features/chat/useConnectionModel'
import type { AgentOrganization, ConversationLocation } from '../../../shared/organization'

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
  const [organization, setOrganization] = useState<AgentOrganization>({ sections: [], projects: [] })
  const [location, setLocation] = useState<ConversationLocation>({ sectionId: '', projectId: null })
  const currentLocation = useRef<ConversationLocation>({ sectionId: '', projectId: null })

  function updateLocation(next: ConversationLocation) {
    currentLocation.current = next
    setLocation(next)
  }
  const [conversationId, setConversationId] = useState('')
  const visibleConversation = useRef({ owner: '', id: '' })
  const conversationSelection = useRef(0)
  const activeStream = useRef<ConversationStream | null>(null)
  const [activeConversationId, setActiveConversationId] = useState('')
  const drafts = useRef(new Map<string, string>())
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [draft, setDraftState] = useState('')
  function setDraft(value: string) {
    const { owner, id } = visibleConversation.current
    drafts.current.set(JSON.stringify([owner, id]), value)
    setDraftState(value)
  }

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
  const section = organization.sections.find(item => item.id === location.sectionId)
  const project = organization.projects.find(item => item.id === location.projectId)
  const runUnavailable = section?.mode === 'closed'
    ? 'You can organize chats here, but replies in Closed sections are not available yet.'
    : project?.repositoryPath
      ? 'This folder is linked. You can organize chats here, but repository work is not available yet.'
      : ''

  async function loadConversation(id: string, owner = agentId) {
    const token = ++conversationSelection.current
    visibleConversation.current = { owner, id }
    setConversationId(id)
    const known = conversations.find(chat => chat.id === id && chat.agentId === owner)
    if (known) updateLocation({ sectionId: known.sectionId, projectId: known.projectId })
    setDraftState(drafts.current.get(JSON.stringify([owner, id])) ?? '')
    setError('')
    follow.current = true

    const stream = activeStream.current
    if (stream?.matches(owner, id)) {
      setMessages(stream.messages)
      setLoaded(true)
      return
    }

    setLoaded(false)
    setMessages([])
    try {
      const result = await window.granite.conversations.get(owner, id)
      if (token !== conversationSelection.current || currentAgent.current !== owner) return
      if (!result.ok) { setError(result.error); return }
      updateLocation({ sectionId: result.value.sectionId, projectId: result.value.projectId })
      setMessages(result.value.messages)
    } catch {
      if (token === conversationSelection.current) setError(bridgeError)
    } finally {
      if (token === conversationSelection.current && currentAgent.current === owner) setLoaded(true)
    }
  }

  function isViewing(owner: string, id: string) {
    return visibleConversation.current.owner === owner && visibleConversation.current.id === id
  }

  async function finishConversation(id: string, owner: string, requestId: string) {
    const result = await window.granite.conversations.get(owner, id)
    if (!result.ok) {
      if (isViewing(owner, id)) setError(result.error)
      return
    }
    const reply = result.value.messages.at(-1)
    const existingReply = activeStream.current?.messages.some(message => message.id === reply?.id && message.id !== requestId)
    if (reply?.role === 'assistant' && !existingReply) {
      bindTiming(requestId, reply.id)
      if (reply.status === 'complete') {
        responseClock.bind(requestId, reply.id, reply.content, (messageId, durationMs) => {
          void window.granite.conversations.saveResponseDuration(owner, id, messageId, durationMs)
            .then(result => { if (!result.ok && isViewing(owner, id)) setError(result.error) })
            .catch(() => { if (isViewing(owner, id)) setError('Could not save the response duration.') })
        })
      }
    }
    if (activeStream.current?.requestId === requestId) activeStream.current.messages = result.value.messages
    if (isViewing(owner, id)) setMessages(result.value.messages)
  }

  async function refreshList() {
    const owner = currentAgent.current
    const result = await window.granite.conversations.list(owner)
    if (currentAgent.current !== owner) return

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
    ++conversationSelection.current
    visibleConversation.current = { owner: id, id: '' }
    setAgentId(id)
    setLoaded(false)

    setMessages([])
    setConversations([])
    setOrganization({ sections: [], projects: [] })
    updateLocation({ sectionId: '', projectId: null })
    setConversationId('')
    setDraft('')
    setError('')

    if (!id) {
      localStorage.removeItem('granite.agent')
      setLoaded(true)

      return
    }

    try {
      const [chats, layout] = await Promise.all([
        window.granite.conversations.list(id), window.granite.organization.get(id)
      ])

      if (token !== selection.current) {
        return
      }

      if (!chats.ok) {
        throw new Error(chats.error)
      }
      if (!layout.ok) throw new Error(layout.error)

      setConversations(chats.value)
      setOrganization(layout.value)
      updateLocation({ sectionId: layout.value.sections.find(item => item.kind === 'general')?.id ?? '', projectId: null })

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

      const stream = activeStream.current
      if (stream) {
        stream.apply(delta)
        if (isViewing(stream.owner, stream.conversationId)) setMessages(stream.messages)
      }
    })

    return () => {
      mounted = false
      ++selection.current
      ++conversationSelection.current
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
      runUnavailable ||
      !loaded
    ) {
      return
    }

    const requestId = crypto.randomUUID()
    const text = draft.trim()
    const destination = { ...currentLocation.current }
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
    const navigationToken = conversationSelection.current
    const stream = new ConversationStream(requestId, agent.id, id, [
      ...messages,
      { id: crypto.randomUUID(), role: 'user', content: text },
      { id: requestId, role: 'assistant', content: '', model: modelSelection.model,
        connectionId: connection.id, effort: modelSelection.effort, tools: [], status: 'running' }
    ])
    activeStream.current = stream
    setActiveConversationId(id)
    setMessages(stream.messages)

    try {
      if (!id) {
        const created = await window.granite.conversations.create(agent.id, destination)

        if (!created.ok) {
          throw new Error(created.error)
        }

        id = created.value.id
        stream.conversationId = id
        setActiveConversationId(id)
        if (navigationToken === conversationSelection.current) {
          const pendingDraft = drafts.current.get(JSON.stringify([agent.id, ''])) ?? ''
          drafts.current.set(JSON.stringify([agent.id, id]), pendingDraft)
          visibleConversation.current = { owner: agent.id, id }
          setConversationId(id)
        }
        await refreshList()
      }

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
      if (!result.ok && isViewing(agent.id, id)) {
        setError(result.error)
      }

      await finishConversation(id, agent.id, requestId)
      await refreshList()
    } catch (error) {
      const message = error instanceof Error ? error.message : bridgeError
      stream.messages = stream.messages.map(reply => reply.id === requestId
        ? { ...reply, status: 'error', error: message, interrupted: true }
        : reply)
      if (isViewing(agent.id, id)) {
        setMessages(stream.messages)
        setError(message)
        setDraft(text)
      }
    } finally {
      finishTiming(requestId)
      run.current = null
      activeStream.current = null
      setActiveConversationId('')
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
        ++conversationSelection.current
        visibleConversation.current = { owner: agentId, id: '' }
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

  async function changeOrganization(action: () => Promise<Result<unknown>>) {
    if (run.current || agentOperation.current || !loaded || !agentId) return false
    const owner = agentId
    agentOperation.current = true
    setManagingAgents(true)
    setError('')
    try {
      const result = await action()
      if (!result.ok) throw new Error(result.error)
      const layout = await window.granite.organization.get(owner)
      if (!layout.ok) throw new Error(layout.error)
      if (currentAgent.current !== owner) return false
      setOrganization(layout.value)
      await refreshList()
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : bridgeError)
      return false
    } finally {
      agentOperation.current = false
      setManagingAgents(false)
    }
  }

  async function moveConversation(id: string, destination: ConversationLocation) {
    return changeOrganization(async () => {
      const result = await window.granite.conversations.move(agentId, id, destination)
      if (result.ok && isViewing(agentId, id)) updateLocation(destination)
      return result
    })
  }

  function selectLocation(next: ConversationLocation) {
    if (!loaded || agentOperation.current) return
    updateLocation(next)
    ++conversationSelection.current
    visibleConversation.current = { owner: currentAgent.current, id: '' }
    setConversationId('')
    setMessages([])
    setError('')
    setDraft('')
    follow.current = true
  }

  function newChat() {
    if (run.current || agentOperation.current || !loaded || !agentId) return
    const general = organization.sections.find(section => section.kind === 'general')
    if (general) selectLocation({ sectionId: general.id, projectId: null })
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
    organization,
    location,
    runUnavailable,
    selectLocation,
    changeOrganization,
    moveConversation,
    conversationId,
    loaded,
    messages,
    draft,
    setDraft,
    busy,
    activeConversationId,
    viewBusy: busy && conversationId === activeConversationId,
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
    newChat,
    async addAgent(created: Agent) {
      setAgents(current => [...current, created])
      await selectAgent(created.id)
    }
  }
}
