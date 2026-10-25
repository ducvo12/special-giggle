export type SectionMode = 'shared' | 'closed'
export type ChatRetention = 'permanent' | 'temporary'

export interface Section {
  id: string
  agentId: string
  name: string
  kind: 'general' | 'custom'
  mode: SectionMode
  createdAt: number
}

export interface Project {
  id: string
  agentId: string
  sectionId: string
  name: string
  repositoryPath: string | null
  createdAt: number
}

export interface ConversationLocation {
  sectionId: string
  projectId: string | null
}

export interface AgentOrganization {
  sections: Section[]
  projects: Project[]
}

// This same policy drives the move picker and the backend; storage remains the
// authority even when a caller bypasses the picker.
export function chatMoveProblem(
  chat: ConversationLocation & { retention: ChatRetention },
  target: ConversationLocation,
  organization: AgentOrganization
): string | null {
  const source = organization.sections.find(section => section.id === chat.sectionId)
  const destination = organization.sections.find(section => section.id === target.sectionId)
  const sourceProject = organization.projects.find(project => project.id === chat.projectId)
  const targetProject = organization.projects.find(project => project.id === target.projectId)

  if (!source || !destination || (target.projectId !== null &&
      (!targetProject || targetProject.sectionId !== destination.id))) {
    return 'Choose a location belonging to this agent.'
  }
  if (sourceProject?.repositoryPath && target.projectId !== sourceProject.id) {
    return 'Chats in a repository project cannot leave that project.'
  }
  if (source.mode === 'closed' && source.id !== destination.id) {
    return 'Make the entire Closed section Shared before moving a chat to another section.'
  }
  if (chat.retention === 'temporary' && target.projectId !== null) {
    return 'Keep a temporary chat permanently before moving it into a project.'
  }
  return null
}
