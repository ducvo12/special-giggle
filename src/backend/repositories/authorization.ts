import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { AgentStore } from '../agents/store.ts'
import type { AgentMessage } from '../../shared/agent.ts'
import type { SetupGrant } from '../../shared/setup.ts'
import { userAuthorized } from './access.ts'
const parse: (command: string) => unknown[] = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)('shell-quote').parse

// A conservative command classifier, not a shell executor. Any operator,
// substitution, assignment or unsupported syntax requires exact-action approval.
export function setupCommand(command: string): { operation: 'install' | 'create'; framework?: 'vite' | 'next' } | undefined {
  if (/[\n\r$`\\]/.test(command)) return
  let tokens: unknown[]
  try { tokens = parse(command) } catch { return }
  if (!tokens.length || tokens.some(token => typeof token !== 'string')) return
  const words = tokens as string[]
  if (words.some(word => /^(?:--?(?:prefix|cwd|dir|global)|-g|-C)(?:=|$)/.test(word) || /^(?:https?:|git\+|file:|link:)/.test(word))) return
  const [bin, action] = words
  if (['npm','pnpm','yarn','bun'].includes(bin) && ['install','i','add','ci'].includes(action)) return { operation: 'install' }
  const args = words.slice(1).filter(word => !['--yes','-y'].includes(word))
  let name: string | undefined
  if (['npm','pnpm','yarn','bun'].includes(bin) && args[0] === 'create') name = args[1]
  if (['npx','bunx'].includes(bin)) name = args[0]?.replace(/^create-/, '')
  if (bin === 'pnpm' && args[0] === 'dlx') name = args[1]?.replace(/^create-/, '')
  const framework = name?.match(/^(vite|next-app)(?:@[^/\s]+)?$/)?.[1]
  if (!framework) return
  // CLI output paths must remain within the selected repository; flags may not
  // redirect package-manager state into global or unrelated folders.
  if (words.some(word => word.startsWith('/') || word.split('/').includes('..'))) return
  return { operation: 'create', framework: framework === 'vite' ? 'vite' : 'next' }
}

const retry = /^(?:please\s+)?(?:try again|retry(?: it| that)?|continue(?: the interrupted task using the original request, corrections and actual completed outcomes\. Do not repeat completed actions\.)?)[.!]?$/i
const networkDenied = /(?<![\w-])(?:do not|don't|never|no|without|revoke|deny|disable|stop)(?![\w-])[^.;\n]{0,70}\b(?:network|internet|downloads?|install(?:ation)?|setup)\b/i


export class SetupAuthorization {
  private approvals = new Map<string, string>()
  noteApproval(runId: string, id: string) { this.approvals.set(runId, id) }
  private store: AgentStore
  constructor(store: AgentStore) {
    this.store = store
    store.saver.db.exec('CREATE TABLE IF NOT EXISTS setup_grants (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
  }
  all(): SetupGrant[] { return (this.store.saver.db.prepare('SELECT data FROM setup_grants ORDER BY rowid').all() as {data:string}[]).map(row => JSON.parse(row.data)) }
  save(grant: SetupGrant) { this.store.saver.db.prepare('INSERT INTO setup_grants VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(grant.id, JSON.stringify(grant)); return grant }
  list(agentId: string, chatId: string) { this.store.get(agentId, chatId); return this.all().filter(grant => grant.agentId === agentId && grant.conversationId === chatId) }
  begin(runId: string, agentId: string, conversationId: string, projectId: string, messages: AgentMessage[]) {
    const direct = messages.filter(message => message.role === 'user' && !message.questionId && message.runId === runId)
    for (const message of direct) this.message(runId, agentId, conversationId, projectId, message)
  }
  message(runId: string, agentId: string, conversationId: string, projectId: string, message: AgentMessage) {
    if (message.questionId) return
    const text = message.content.trim()
    const scope = { runId, agentId, conversationId, projectId }
    const denyNetwork = networkDenied.test(text)
    if (denyNetwork) {
      for (const grant of this.list(agentId, conversationId).filter(grant => grant.state !== 'revoked' && grant.operation !== 'preview')) this.save({ ...grant, state: 'revoked' })
      this.save({ ...scope, id: randomUUID(), origin: { messageId: message.id }, operation: 'dependencies', state: 'revoked', createdAt: Date.now(), reason: 'The user explicitly ruled out network/setup downloads for this task.' })
    }
    if (retry.test(text)) {
      const previousRun = this.store.get(agentId, conversationId).messages.filter(item => item.role === 'user' && !item.questionId && item.runId !== runId).at(-1)?.runId
      const prior = this.list(agentId, conversationId).filter(grant => grant.projectId === projectId && grant.runId === previousRun && grant.operation !== 'preview').at(-1)
      if (prior) {
        const previous = this.all().filter(grant => grant.runId === prior.runId && grant.projectId === projectId && grant.operation !== 'preview')
        for (const grant of previous) {
          if (grant.state !== 'revoked' && prior.state === 'revoked') continue
          this.save({ ...grant, ...scope, id: randomUUID(), origin: { ...grant.origin, previousGrantId: grant.id, messageId: message.id }, state: grant.state === 'revoked' ? 'revoked' : 'active', createdAt: Date.now(), reason: grant.state === 'revoked' ? 'The previous task explicitly denied this capability; a retry does not restore it.' : 'Fresh authorization for the clearly repeated task; inspect completed effects before retrying.' })
        }
      }
      return
    }
    const framework = /\bnext\.?js\b|\bnextjs\b/i.test(text) ? 'next' : /\bvite\b/i.test(text) ? 'vite' : undefined
    if (!denyNetwork && /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:make|create|setup|set up|initialize|turn|convert|build)\b/i.test(text) && /\b(?:project|app|application|repo|repository|frontend|website)\b/i.test(text)) {
      if (framework) {
        for (const grant of this.all().filter(grant => grant.runId === runId && grant.state === 'active' && grant.operation === 'setup' && grant.framework !== framework)) this.save({ ...grant, state: 'revoked' })
        this.save({ ...scope, id: randomUUID(), origin: { messageId: message.id }, operation: 'setup', framework, state: 'active', createdAt: Date.now(), reason: `Requested ${framework === 'next' ? 'Next.js' : 'Vite'} setup and its necessary dependency downloads in this repository.` })
      }
    }
    if (!denyNetwork && /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:install|add|update)\b/i.test(text) && /\b(?:dependenc(?:y|ies)|packages?)\b/i.test(text)) this.save({ ...scope, id: randomUUID(), origin: { messageId: message.id }, operation: 'dependencies', state: 'active', createdAt: Date.now(), reason: 'Requested project dependency installation; no scaffold, global install or unrelated network commands.' })
    // Supplied installer commands also establish their bounded setup intent.
    const exact = text.replace(/^(?:please\s+)?run\s+/i, '').replace(/^`([\s\S]*)`$/, '$1')
    const kind = setupCommand(exact)
    if (!denyNetwork && (kind || /^(?:please\s+)?run\s+/i.test(text)) && userAuthorized([text], 'command', exact)) {
      this.save({ ...scope, id: randomUUID(), origin: { messageId: message.id }, operation: kind?.operation === 'create' ? 'setup' : kind?.operation === 'install' ? 'dependencies' : 'command', framework: kind?.framework, command: exact, state: 'active', createdAt: Date.now(), reason: kind ? 'Supplied package installation/scaffold command and necessary installation steps.' : 'Exact command supplied by the user.' })
    }

  }
  allowed(runId: string, command: string) {
    const kind = setupCommand(command)
    return this.all().some(grant => grant.runId === runId && grant.state === 'active' &&
      (grant.operation === 'command' && grant.command === command || grant.operation === 'dependencies' && kind?.operation === 'install' || grant.operation === 'setup' && kind && (kind.operation === 'install' || Boolean(grant.framework && grant.framework === kind.framework))))
  }
  denied(runId: string, command: string) {
    if (this.allowed(runId, command)) return false
    return this.all().some(grant => grant.runId === runId && grant.state === 'revoked' && grant.operation !== 'preview')
  }
  approve(runId: string, agentId: string, conversationId: string, projectId: string, operation: 'command', command: string, allowed: boolean) {
    if (!allowed) {
      for (const grant of this.all().filter(grant => grant.runId === runId && grant.state === 'active' && grant.operation !== 'preview')) this.save({ ...grant, state: 'revoked' })
    }
    const kind = allowed ? setupCommand(command) : undefined
    const grantedOperation = kind?.operation === 'create' ? 'setup' : kind?.operation === 'install' ? 'dependencies' : operation
    return this.save({ id: randomUUID(), runId, agentId, conversationId, projectId, operation: grantedOperation, framework: kind?.framework, command, state: allowed ? 'active' : 'revoked', createdAt: Date.now(), origin: { approvalId: this.approvals.get(runId) }, reason: allowed ? kind ? 'Explicit setup/download approval, including necessary package-manager installation steps for this task.' : 'Explicit action approval in this task.' : 'Action denied or withdrawn; do not retry through another path without a new user request.' })
  }
  end(runId: string) { this.approvals.delete(runId); for (const grant of this.all().filter(grant => grant.runId === runId && grant.state === 'active')) this.save({ ...grant, state: 'ended' }) }
  revoke(agentId: string, chatId: string, id: string) {
    const grant = this.list(agentId, chatId).find(grant => grant.id === id)
    if (!grant) throw new Error('Setup permission not found in this chat.')
    // Revoke the entire task lineage, including already-derived retry grants.
    for (const item of this.list(agentId, chatId).filter(item => item.projectId === grant.projectId)) this.save({ ...item, state: 'revoked' })
  }
  remove(agentId: string, chatId?: string) { for (const grant of this.all().filter(grant => grant.agentId === agentId && (!chatId || grant.conversationId === chatId))) this.store.saver.db.prepare('DELETE FROM setup_grants WHERE id = ?').run(grant.id) }
}
