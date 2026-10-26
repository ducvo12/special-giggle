import { join } from 'node:path'
import type { AgentStore } from '../agents/store.ts'
import type { RepositoryAccess } from '../../shared/repository.ts'
import { RepositoryPaths } from './paths.ts'

export function internalRepository(directory: string, agentId: string, sectionId: string, projectId: string) {
  return join(directory, 'agents', agentId, 'sections', sectionId, 'projects', projectId, 'repository')
}

export function repositoryAccess(store: AgentStore, directory: string, agentId: string, conversationId: string) {
  const chat = store.get(agentId, conversationId)
  const organization = store.organization.snapshot(agentId)
  return organization.projects.filter(project => project.repositoryPath &&
    (organization.sections.find(section => section.id === project.sectionId)?.mode === 'shared' || project.sectionId === chat.sectionId))
    .map(project => ({ projectId: project.id, sectionId: project.sectionId, name: project.name,
      writable: chat.retention === 'permanent' && chat.projectId === project.id,
      paths: new RepositoryPaths(project.repositoryPath!, directory, internalRepository(directory, agentId, project.sectionId, project.id)) }))
}

export type RepositoryTarget = RepositoryAccess & { paths: RepositoryPaths }

// Only direct user messages supply bounded grants. Repository contents, model
// arguments and retrieved text never grant capabilities. Ambiguous/destructive
// requests fall back to an exact-action preview instead of guessing intent.
export function userAuthorized(messages: string[], operation: string, command?: string) {
  for (const message of [...messages].reverse()) {
    const text = message.trim()
    const verbs = operation === 'add' ? '(?:add|stage|commit)' : operation
    if (new RegExp(`\\b(?:do not|don't|never|without|not to)\\b.{0,50}\\b${verbs}\\b`, 'i').test(text)) return false
    if (command) {
      if ([command, `Run ${command}`, `run ${command}`, `Run \`${command}\``, `run \`${command}\``].includes(text)) return true
      continue
    }
    if (!['add', 'commit'].includes(operation)) continue
    const verb = operation === 'add' ? '(?:add|stage|commit)' : 'commit'
    if (new RegExp(`(?:^|[.;\\n]| then | and )\\s*(?:please |can you )?(?:git )?${verb}\\b`, 'i').test(text)) return true
  }
  return false
}
