import { messageWithAttachments, type ChatAttachment } from '../features/chat/attachments'
import { ConversationStream } from './conversation-stream'
import { responseClock } from '../features/chat/response-clock'
import { beginTiming, recordDelta, finishTiming, bindTiming } from '../features/chat/devTimings'
import { useEffect, useRef, useState } from 'react'
import type { Result, SavedConnection, StreamActivity } from '../../../shared/chat'
import type { ApprovalRequest } from '../../../shared/harness'
import type { Agent, AgentMessage, Conversation } from '../../../shared/agent'
import { isLiveRun, locksChat, type RecoveryNotice, type RunIntent, type RunSnapshot } from '../../../shared/run'
import { useConnectionModel } from '../features/chat/useConnectionModel'
import type { AgentOrganization, ConversationLocation } from '../../../shared/organization'

const bridgeError = 'Could not communicate with the desktop backend.'
const emptyActivity = (): StreamActivity => ({ reasoningCharacters: 0, answerCharacters: 0 })

export function useAgentSession() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState('')
  const currentAgent = useRef('')
  const selection = useRef(0)
  const conversationSelection = useRef(0)
  const visible = useRef({ owner: '', id: '' })
  const streams = useRef(new Map<string, ConversationStream>())
  const runRecords = useRef(new Map<string, RunSnapshot>())
  const [runs, setRuns] = useState<RunSnapshot[]>([])
  const runDetails = useRef(new Map<string, { activity: StreamActivity; approval: ApprovalRequest | null }>())
  const submissions = useRef(new Set<string>())
  const [submitting, setSubmitting] = useState(false)
  const [recovery, setRecovery] = useState<RecoveryNotice | null>(null)
  const [connections, setConnections] = useState<SavedConnection[]>([])
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem('granite.connection') ?? '')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [organization, setOrganization] = useState<AgentOrganization>({ sections: [], projects: [] })
  const [location, setLocation] = useState<ConversationLocation>({ sectionId: '', projectId: null })
  const currentLocation = useRef(location)
  const [conversationId, setConversationId] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [draft, setDraftState] = useState('')
  const drafts = useRef(new Map<string, string>())
  const [attachments, setAttachmentsState] = useState<ChatAttachment[]>([])
  const attachmentDrafts = useRef(new Map<string, ChatAttachment[]>())
  const [error, setError] = useState('')
  const [managingAgents, setManagingAgents] = useState(false)
  const agentOperation = useRef(false)
  const [now, setNow] = useState(Date.now())
  const end = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  const visibleRuns = runs.filter(run => run.agentId === agentId && run.conversationId === conversationId)
  const viewRun = visibleRuns.filter(isLiveRun).at(-1) ?? visibleRuns.at(-1)
  const viewBusy = Boolean(viewRun && isLiveRun(viewRun))
  const busy = runs.some(run => run.agentId === agentId && isLiveRun(run))
  const activeConversationId = runs.find(run => run.agentId === agentId && isLiveRun(run))?.conversationId ?? ''
  const locked = messages.find(message => message.model)
  const connection = connections.find(item => item.id === (locked?.connectionId ?? viewRun?.connectionId ??
    (locked ? connections.find(item => item.model === locked.model)?.id : undefined) ?? selectedId))
  const modelSelection = useConnectionModel(connection, locked?.model ?? viewRun?.model, conversationId,
    [...messages].reverse().find(message => message.model)?.effort)
  const agent = agents.find(item => item.id === agentId)
  const section = organization.sections.find(item => item.id === location.sectionId)
  const project = organization.projects.find(item => item.id === location.projectId)
  const runUnavailable = section?.mode === 'closed'
    ? 'You can organize chats here, but replies in Closed sections are not available yet.'
    : ''
  const details = viewRun ? runDetails.current.get(viewRun.id) : undefined
  const approval = details?.approval ?? null
  const activity = details?.activity ?? emptyActivity()
  const stopping = viewRun?.phase === 'stopping'
  const elapsed = viewRun ? Math.max(0, Math.floor((now - (viewRun.startedAt ?? viewRun.createdAt)) / 1000)) : 0

  function updateLocation(next: ConversationLocation) {
    currentLocation.current = next
    setLocation(next)
  }
  function isViewing(owner: string, id: string) { return visible.current.owner === owner && visible.current.id === id }
  function setDraft(value: string) {
    drafts.current.set(JSON.stringify(visible.current), value)
    setDraftState(value)
  }
  function setAttachments(files: ChatAttachment[]) {
    attachmentDrafts.current.set(JSON.stringify(visible.current), files)
    setAttachmentsState(files)
  }
  function updateRun(run: RunSnapshot) {
    runRecords.current.set(run.id, run)
    const detail = runDetails.current.get(run.id)
    if (detail && run.phase !== 'approval') detail.approval = null
    setRuns([...runRecords.current.values()])
  }
  function latestStream(owner: string, id: string) {
    return [...streams.current.values()].filter(stream => stream.matches(owner, id)).at(-1)
  }

  async function refreshList(owner = currentAgent.current) {
    if (!owner) return
    const result = await window.granite.conversations.list(owner)
    if (currentAgent.current !== owner) return
    if (result.ok) setConversations(result.value)
    else setError(result.error)
  }

  async function loadConversation(id: string, owner = currentAgent.current) {
    const token = ++conversationSelection.current
    visible.current = { owner, id }
    setConversationId(id)
    setDraftState(drafts.current.get(JSON.stringify({ owner, id })) ?? '')
    setAttachmentsState(attachmentDrafts.current.get(JSON.stringify({ owner, id })) ?? [])
    setError('')
    follow.current = true
    setLoaded(false)
    const snapshot = latestStream(owner, id)
    setMessages(snapshot?.messages ?? [])
    try {
      const result = await window.granite.conversations.get(owner, id)
      if (token !== conversationSelection.current || currentAgent.current !== owner) return
      if (!result.ok) throw new Error(result.error)
      updateLocation({ sectionId: result.value.sectionId, projectId: result.value.projectId })
      const stream = latestStream(owner, id)
      if (stream && !stream.messages.length) stream.messages = result.value.messages
      setMessages(stream?.messages ?? result.value.messages)
    } catch (error) {
      if (token === conversationSelection.current) setError(error instanceof Error ? error.message : bridgeError)
    } finally {
      if (token === conversationSelection.current && currentAgent.current === owner) setLoaded(true)
    }
  }

  async function selectAgent(id: string) {
    const token = ++selection.current
    currentAgent.current = id
    ++conversationSelection.current
    visible.current = { owner: id, id: '' }
    setAgentId(id)
    setLoaded(false)
    setMessages([])
    setConversations([])
    setOrganization({ sections: [], projects: [] })
    updateLocation({ sectionId: '', projectId: null })
    setConversationId('')
    setDraftState('')
    setAttachmentsState([])
    setError('')
    if (!id) {
      localStorage.removeItem('granite.agent')
      setLoaded(true)
      return
    }
    try {
      const [chats, layout] = await Promise.all([window.granite.conversations.list(id), window.granite.organization.get(id)])
      if (token !== selection.current) return
      if (!chats.ok) throw new Error(chats.error)
      if (!layout.ok) throw new Error(layout.error)
      setConversations(chats.value)
      setOrganization(layout.value)
      updateLocation({ sectionId: layout.value.sections.find(item => item.kind === 'general')?.id ?? '', projectId: null })
      const saved = localStorage.getItem(`granite.conversation.${id}`) ?? (id === 'atlas' ? localStorage.getItem('granite.conversation') : null)
      const chat = chats.value.find(chat => chat.id === saved) ?? chats.value[0]
      if (chat) await loadConversation(chat.id, id)
      localStorage.setItem('granite.agent', id)
    } catch (error) {
      if (token === selection.current) setError(error instanceof Error ? error.message : bridgeError)
    } finally { if (token === selection.current) setLoaded(true) }
  }

  async function refreshRecovery() {
    const [saved, notice] = await Promise.all([window.granite.runs.list(), window.granite.runs.recovery()])
    if (saved.ok) {
      runRecords.current = new Map(saved.value.map(run => [run.id, run]))
      for (const run of saved.value) {
        const detail = runDetails.current.get(run.id)
        if (detail && run.phase !== 'approval') detail.approval = null
      }
      setRuns(saved.value)
    }
    if (notice.ok && (notice.value.active || notice.value.pending || notice.value.repositories || notice.value.previews)) setRecovery(notice.value)
  }

  useEffect(() => {
    let mounted = true
    const off = window.granite.onDelta(delta => {
      if (delta.run) updateRun(delta.run)
      const run = delta.run ?? runRecords.current.get(delta.requestId)
      if (!run) return
      recordDelta(delta)
      const detail = runDetails.current.get(run.id) ?? { activity: emptyActivity(), approval: null }
      if (delta.activity) detail.activity = delta.activity
      if (Object.hasOwn(delta, 'approval')) detail.approval = delta.approval ?? null
      runDetails.current.set(run.id, detail)
      let stream = streams.current.get(run.id)
      if (!stream) {
        stream = new ConversationStream(run.id, run.agentId, run.conversationId, [])
        streams.current.set(run.id, stream)
      }
      if (delta.messages) stream.messages = delta.messages
      else stream.apply(delta)
      if (isViewing(run.agentId, run.conversationId)) {
        setMessages([...stream.messages])
        // Approval-only deltas also need a render.
        setNow(Date.now())
      }
      if (delta.run) void refreshList(run.agentId)
    })
    void Promise.all([window.granite.connections.list(), window.granite.agents.list(), refreshRecovery()])
      .then(async ([savedConnections, savedAgents]) => {
        if (!mounted) return
        if (savedConnections.ok) {
          setConnections(savedConnections.value)
          setSelectedId(current => savedConnections.value.some(item => item.id === current) ? current : savedConnections.value[0]?.id ?? '')
        } else setError(savedConnections.error)
        if (!savedAgents.ok) { setError(savedAgents.error); setLoaded(true); return }
        setAgents(savedAgents.value)
        const saved = localStorage.getItem('granite.agent')
        const selected = savedAgents.value.find(agent => agent.id === saved) ?? savedAgents.value[0]
        if (selected) await selectAgent(selected.id)
        else setLoaded(true)
      }).catch(() => { if (mounted) { setError(bridgeError); setLoaded(true) } })
    return () => { mounted = false; ++selection.current; ++conversationSelection.current; off() }
  }, [])

  useEffect(() => {
    if (!viewBusy) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [viewBusy])
  useEffect(() => { localStorage.setItem('granite.connection', selectedId) }, [selectedId])
  useEffect(() => {
    if (conversationId) localStorage.setItem(`granite.conversation.${agentId}`, conversationId)
  }, [conversationId, agentId])

  async function finishConversation(owner: string, id: string, requestId: string) {
    const result = await window.granite.conversations.get(owner, id)
    if (!result.ok) { if (isViewing(owner, id)) setError(result.error); return }
    const reply = [...result.value.messages].reverse().find(message => (message.id === requestId || message.runId === requestId) && message.role === 'assistant')
    if (reply) {
      bindTiming(requestId, reply.id)
      if (reply.status === 'complete') responseClock.bind(requestId, reply.id, reply.content, (messageId, durationMs) => {
        void window.granite.conversations.saveResponseDuration(owner, id, messageId, durationMs)
      })
    }
    const stream = streams.current.get(requestId)
    if (stream) stream.messages = result.value.messages
    if (isViewing(owner, id)) setMessages(result.value.messages)
    await refreshList(owner)
    return result.value
  }

  async function submit(intent: RunIntent = 'message') {
    if (agentOperation.current || !connection || !modelSelection.ready || !agent || runUnavailable || !loaded ||
      intent === 'message' && !draft.trim() && !attachments.length) return
    const owner = agent.id
    let text = ''
    try { text = intent === 'message' ? messageWithAttachments(draft, attachments) : '' }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not prepare attachments.'); return }
    const originalDraft = draft
    const originalAttachments = attachments
    const submitKey = JSON.stringify(visible.current)
    if (submissions.current.has(submitKey)) return
    submissions.current.add(submitKey)
    setSubmitting(true)
    const requestId = crypto.randomUUID()
    const destination = { ...currentLocation.current }
    const token = conversationSelection.current
    let id = conversationId
    setError('')
    if (intent === 'message') { setDraft(''); setAttachments([]) }
    follow.current = true
    try {
      if (!id) {
        const created = await window.granite.conversations.create(owner, destination)
        if (!created.ok) throw new Error(created.error)
        id = created.value.id
        if (token === conversationSelection.current && currentAgent.current === owner) {
          visible.current = { owner, id }
          setConversationId(id)
        }
        await refreshList(owner)
      }
      responseClock.begin(requestId)
      beginTiming(requestId)
      // IPC remains pending until a new run settles; a steering submission
      // returns immediately and names the existing run. Neither blocks navigation.
      const pending = window.granite.stream(requestId, owner, id, connection.id, text,
        connection.provider === 'chatgpt' ? modelSelection.model : undefined, modelSelection.effort, intent)
      submissions.current.delete(submitKey)
      setSubmitting(submissions.current.size > 0)
      const result = await pending
      finishTiming(requestId)
      if (!result.ok) {
        if (result.code === 'model_access') {
          const catalog = await window.granite.connections.models(connection.id)
          if (catalog.ok) window.dispatchEvent(new CustomEvent('granite:models-refreshed', {
            detail: { connectionId: connection.id, models: catalog.value }
          }))
        }
        if (isViewing(owner, id)) setError(result.error)
        await refreshRecovery()
      }
      if (result.ok && result.value.steered) {
        // The live run already emitted its accepted message snapshot. Reading a
        // throttled database snapshot here could overwrite newer streamed text.
        await refreshList(owner)
        return
      }
      const detail = await finishConversation(owner, id, requestId)
      if (!result.ok && text && isViewing(owner, id) && !detail?.messages.some(message => message.role === 'user' && message.runId === requestId)) { setDraft(originalDraft); setAttachments(originalAttachments) }
    } catch (error) {
      if (isViewing(owner, id)) {
        setError(error instanceof Error ? error.message : bridgeError)
        if (text) { setDraft(originalDraft); setAttachments(originalAttachments) }
      }
    } finally {
      submissions.current.delete(submitKey)
      setSubmitting(submissions.current.size > 0)
      finishTiming(requestId)
    }
  }

  async function stop() {
    if (!viewRun || !isLiveRun(viewRun)) return
    try { await window.granite.stop(viewRun.id) }
    catch { setError(bridgeError) }
  }

  async function renameConversation(id: string, title: string) {
    if (agentOperation.current || !loaded) return false
    agentOperation.current = true
    setManagingAgents(true)
    setError('')
    try {
      const result = await window.granite.conversations.rename(agentId, id, title)
      if (!result.ok) throw new Error(result.error)
      await refreshList()
      return true
    } catch (error) { setError(error instanceof Error ? error.message : bridgeError); return false }
    finally { agentOperation.current = false; setManagingAgents(false) }
  }

  async function deleteConversation(id: string) {
    if (agentOperation.current || !loaded) return false
    agentOperation.current = true
    setManagingAgents(true)
    setError('')
    try {
      const result = await window.granite.conversations.delete(agentId, id)
      if (!result.ok) throw new Error(result.error)
      setConversations(current => current.filter(chat => chat.id !== id))
      for (const [key, run] of runRecords.current) if (run.conversationId === id) runRecords.current.delete(key)
      for (const [key, stream] of streams.current) if (stream.conversationId === id) streams.current.delete(key)
      setRuns([...runRecords.current.values()])
      localStorage.removeItem(`granite.conversation.${agentId}`)
      if (agentId === 'atlas') localStorage.removeItem('granite.conversation')
      if (conversationId === id) {
        ++conversationSelection.current
        visible.current = { owner: agentId, id: '' }
        setConversationId(''); setMessages([]); setDraft(''); setAttachments([])
      }
      return true
    } catch (error) { setError(error instanceof Error ? error.message : bridgeError); return false }
    finally { agentOperation.current = false; setManagingAgents(false) }
  }

  async function deleteAgent(id: string) {
    if (agentOperation.current) return false
    agentOperation.current = true
    setManagingAgents(true)
    setError('')
    try {
      const result = await window.granite.agents.delete(id)
      if (!result.ok) throw new Error(result.error)
      const remaining = agents.filter(agent => agent.id !== id)
      setAgents(remaining)
      for (const [key, run] of runRecords.current) if (run.agentId === id) runRecords.current.delete(key)
      setRuns([...runRecords.current.values()])
      localStorage.removeItem(`granite.conversation.${id}`)
      if (id === currentAgent.current) await selectAgent(remaining[0]?.id ?? '')
      return true
    } catch (error) { setError(error instanceof Error ? error.message : bridgeError); return false }
    finally { agentOperation.current = false; setManagingAgents(false) }
  }

  async function changeOrganization(action: () => Promise<Result<unknown>>) {
    if (agentOperation.current || !loaded || !agentId) return false
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
      await refreshList(owner)
      return true
    } catch (error) { setError(error instanceof Error ? error.message : bridgeError); return false }
    finally { agentOperation.current = false; setManagingAgents(false) }
  }
  async function moveConversation(id: string, destination: ConversationLocation) {
    if (runs.some(run => run.conversationId === id && locksChat(run))) return false
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
    visible.current = { owner: currentAgent.current, id: '' }
    setConversationId(''); setMessages([]); setError(''); setDraft(''); setAttachments([])
    follow.current = true
  }
  function newChat() {
    if (agentOperation.current || !loaded || !agentId) return
    const general = organization.sections.find(section => section.kind === 'general')
    if (general) selectLocation({ sectionId: general.id, projectId: null })
  }

  return {
    agents, managingAgents, agentId, agent, connections, setConnections, selectedId, setSelectedId, connection,
    modelSelection, conversations, organization, location, runUnavailable, selectLocation, changeOrganization,
    moveConversation, conversationId, loaded, messages, draft, setDraft, attachments, setAttachments, busy, viewBusy, viewRun, runs, submitting,
    activeConversationId, stopping, approval, activity, elapsed, error, setError, end, follow,
    loadConversation, selectAgent, stop, deleteAgent, deleteConversation, renameConversation, newChat,
    send: () => submit(), continueRun: () => submit('continue'), runPending: () => submit('pending'), recovery,
    async cancelPending() {
      const result = await window.granite.runs.cancelPending(agentId, conversationId)
      if (!result.ok) setError(result.error)
      else { await refreshRecovery(); await loadConversation(conversationId) }
    },
    async dismissRecovery() {
      const result = await window.granite.runs.dismissRecovery()
      if (result.ok) setRecovery(null)
      else setError(result.error)
    },
    async answerQuestion(answers: string[]) {
      if (!viewRun?.question) return false
      const result = await window.granite.harness.answer(viewRun.id, viewRun.question.id, answers)
      if (!result.ok) setError(result.error)
      return result.ok
    },
    async approve(allow: boolean) {
      if (!approval) return
      const result = await window.granite.harness.approve(approval.requestId, approval.id, allow)
      if (!result.ok) setError(result.error)
    },
    async addAgent(created: Agent) {
      setAgents(current => [...current, created])
      await selectAgent(created.id)
    }
  }
}
