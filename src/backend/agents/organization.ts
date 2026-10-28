import { randomUUID } from 'node:crypto'
import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { chatMoveProblem, type AgentOrganization, type ChatRetention,
  type ConversationLocation, type Project, type Section, type SectionMode } from '../../shared/organization.ts'

function name(value: unknown, kind: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 ||
      /[\u0000-\u001f\u007f<>]/.test(value)) {
    throw new Error(`Choose a ${kind} name between 1 and 80 characters without control characters or angle brackets.`)
  }
  return value.trim()
}

export class OrganizationStore {
  private db: SqliteSaver['db']

  constructor(db: SqliteSaver['db']) {
    this.db = db
    // Use the same Unicode-aware comparison for every database connection.
    db.function('organization_name_key', { deterministic: true }, (value: unknown) =>
      typeof value === 'string' ? value.trim().toLowerCase() : null)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sections (
          id TEXT PRIMARY KEY, agentId TEXT NOT NULL, name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('general', 'custom')),
          mode TEXT NOT NULL CHECK(mode IN ('shared', 'closed')), createdAt INTEGER NOT NULL,
          CHECK(kind != 'general' OR (name = 'General' AND mode = 'shared'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS agent_general ON sections(agentId) WHERE kind = 'general';
        CREATE INDEX IF NOT EXISTS section_agent ON sections(agentId);
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY, agentId TEXT NOT NULL, sectionId TEXT NOT NULL,
          name TEXT NOT NULL, repositoryPath TEXT, createdAt INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS project_section ON projects(agentId, sectionId);
        CREATE INDEX IF NOT EXISTS project_repository ON projects(repositoryPath);
      `)
      for (const kind of ['section', 'project'] as const) {
        const table = `${kind}s`
        const scope = `entry.agentId = NEW.agentId${kind === 'project' ? ' AND entry.sectionId = NEW.sectionId' : ''}`
        const custom = kind === 'section' ? "NEW.kind = 'custom' AND " : ''
        const reserved = kind === 'section' ? "organization_name_key(NEW.name) = 'general' OR " : ''
        const conflict = `${reserved}EXISTS (SELECT 1 FROM ${table} entry WHERE ${scope}
          AND entry.id != NEW.id AND organization_name_key(entry.name) = organization_name_key(NEW.name))`
        const message = kind === 'section'
          ? 'A section with this name already exists for this agent. Choose a different name.'
          : 'A project with this name already exists in this section. Choose a different name.'
        // Triggers enforce all writes without renaming or removing legacy duplicates.
        // Existing duplicate names can retain their spelling or change capitalization.
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS ${kind}_name_insert BEFORE INSERT ON ${table}
            WHEN ${custom}(${conflict}) BEGIN SELECT RAISE(ABORT, '${message}'); END;
          CREATE TRIGGER IF NOT EXISTS ${kind}_name_update BEFORE UPDATE OF name ON ${table}
            WHEN ${custom}organization_name_key(NEW.name) IS NOT organization_name_key(OLD.name)
              AND (${conflict}) BEGIN SELECT RAISE(ABORT, '${message}'); END;
        `)
      }
      const columns = db.pragma('table_info(conversations)') as { name: string }[]
      for (const [column, definition] of [
        ['sectionId', 'TEXT'], ['projectId', 'TEXT'],
        ['retention', "TEXT NOT NULL DEFAULT 'permanent' CHECK(retention IN ('permanent', 'temporary'))"],
        ['expiresAt', 'INTEGER']
      ]) {
        if (!columns.some(item => item.name === column)) {
          db.exec(`ALTER TABLE conversations ADD COLUMN ${column} ${definition}`)
        }
      }
      const owners = db.prepare('SELECT DISTINCT agentId FROM conversations').all() as { agentId: string }[]
      for (const { agentId } of owners) {
        const general = this.ensureGeneral(agentId)
        db.prepare('UPDATE conversations SET sectionId = ? WHERE agentId = ? AND sectionId IS NULL')
          .run(general.id, agentId)
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS conversation_location ON conversations(agentId, sectionId, projectId);
        CREATE TRIGGER IF NOT EXISTS project_location_insert BEFORE INSERT ON projects BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sections WHERE id = NEW.sectionId
            AND agentId = NEW.agentId AND kind = 'custom') THEN RAISE(ABORT, 'Projects require a custom section.') END;
        END;
        CREATE TRIGGER IF NOT EXISTS project_location_update BEFORE UPDATE OF sectionId, agentId ON projects
          WHEN NEW.sectionId IS NOT OLD.sectionId OR NEW.agentId IS NOT OLD.agentId BEGIN
          SELECT RAISE(ABORT, 'Projects cannot move to another section or agent.');
        END;
        CREATE TRIGGER IF NOT EXISTS project_repository_update BEFORE UPDATE OF repositoryPath ON projects
          WHEN OLD.repositoryPath IS NOT NULL AND NEW.repositoryPath IS NOT OLD.repositoryPath BEGIN
          SELECT RAISE(ABORT, 'This project already has a repository. Relinking is not available yet.');
        END;
        CREATE TRIGGER IF NOT EXISTS section_mode_update BEFORE UPDATE OF mode ON sections
          WHEN OLD.mode = 'shared' AND NEW.mode != 'shared' BEGIN
          SELECT RAISE(ABORT, 'Shared sections cannot become Closed.');
        END;
        CREATE TRIGGER IF NOT EXISTS section_owner_update BEFORE UPDATE OF agentId, kind ON sections
          WHEN NEW.agentId IS NOT OLD.agentId OR NEW.kind IS NOT OLD.kind BEGIN
          SELECT RAISE(ABORT, 'Sections cannot change their agent or built-in status.');
        END;
      `)
      for (const event of ['INSERT', 'UPDATE']) {
        db.exec(`CREATE TRIGGER IF NOT EXISTS chat_location_${event.toLowerCase()} BEFORE ${event} ON conversations BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sections WHERE id = NEW.sectionId AND agentId = NEW.agentId)
            THEN RAISE(ABORT, 'Chat section does not belong to this agent.') END;
          SELECT CASE WHEN NEW.projectId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects
            WHERE id = NEW.projectId AND agentId = NEW.agentId AND sectionId = NEW.sectionId)
            THEN RAISE(ABORT, 'Chat project does not belong to this section.') END;
          SELECT CASE WHEN NEW.retention = 'temporary' AND NEW.projectId IS NOT NULL
            THEN RAISE(ABORT, 'Temporary chats cannot belong to projects.') END;
        END;`)
      }
      db.exec(`CREATE TRIGGER IF NOT EXISTS chat_movement_update BEFORE UPDATE OF sectionId, projectId, agentId ON conversations BEGIN
        SELECT CASE WHEN NEW.agentId IS NOT OLD.agentId THEN RAISE(ABORT, 'Chats cannot move to another agent.') END;
        SELECT CASE WHEN NEW.sectionId IS NOT OLD.sectionId AND EXISTS (SELECT 1 FROM sections
          WHERE id = OLD.sectionId AND mode = 'closed') THEN RAISE(ABORT, 'Make the Closed section Shared before moving chats out.') END;
        SELECT CASE WHEN NEW.projectId IS NOT OLD.projectId AND EXISTS (SELECT 1 FROM projects
          WHERE id = OLD.projectId AND repositoryPath IS NOT NULL) THEN RAISE(ABORT, 'Repository chats cannot leave their project.') END;
      END;`)
    })()
  }

  ensureGeneral(agentId: string): Section {
    this.db.prepare(`INSERT OR IGNORE INTO sections (id, agentId, name, kind, mode, createdAt)
      VALUES (?, ?, 'General', 'general', 'shared', ?)`).run(`general-${agentId}`, agentId, Date.now())
    return this.db.prepare("SELECT * FROM sections WHERE agentId = ? AND kind = 'general'").get(agentId) as Section
  }

  snapshot(agentId: string): AgentOrganization {
    return {
      sections: this.db.prepare("SELECT * FROM sections WHERE agentId = ? ORDER BY kind = 'general' DESC, createdAt, rowid").all(agentId) as Section[],
      projects: this.db.prepare('SELECT * FROM projects WHERE agentId = ? ORDER BY createdAt, rowid').all(agentId) as Project[]
    }
  }

  section(agentId: string, id: string): Section {
    const section = this.db.prepare('SELECT * FROM sections WHERE id = ? AND agentId = ?').get(id, agentId) as Section | undefined
    if (!section) throw new Error('Section not found.')
    return section
  }

  project(agentId: string, id: string): Project {
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ? AND agentId = ?').get(id, agentId) as Project | undefined
    if (!project) throw new Error('Project not found.')
    return project
  }

  createSection(agentId: string, value: unknown, mode: SectionMode): Section {
    if (mode !== 'shared' && mode !== 'closed') throw new Error('Choose Shared or Closed for the section.')
    const section: Section = { id: `section-${randomUUID()}`, agentId, name: name(value, 'section'), kind: 'custom', mode, createdAt: Date.now() }
    this.db.prepare('INSERT INTO sections (id, agentId, name, kind, mode, createdAt) VALUES (@id, @agentId, @name, @kind, @mode, @createdAt)').run(section)
    return section
  }

  renameSection(agentId: string, id: string, value: unknown): Section {
    const section = this.section(agentId, id)
    if (section.kind === 'general') throw new Error('The built-in General section cannot be renamed.')
    this.db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(name(value, 'section'), id)
    return this.section(agentId, id)
  }

  shareSection(agentId: string, id: string): Section {
    this.section(agentId, id)
    this.db.prepare("UPDATE sections SET mode = 'shared' WHERE id = ?").run(id)
    return this.section(agentId, id)
  }

  createProject(agentId: string, sectionId: string, value: unknown, repositoryPath: string | null = null): Project {
    if (this.section(agentId, sectionId).kind === 'general') throw new Error('General contains chats only. Create a custom section for projects.')
    const project: Project = { id: `project-${randomUUID()}`, agentId, sectionId, name: name(value, 'project'), repositoryPath, createdAt: Date.now() }
    this.db.prepare('INSERT INTO projects (id, agentId, sectionId, name, repositoryPath, createdAt) VALUES (@id, @agentId, @sectionId, @name, @repositoryPath, @createdAt)').run(project)
    return project
  }

  renameProject(agentId: string, id: string, value: unknown): Project {
    this.project(agentId, id)
    this.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name(value, 'project'), id)
    return this.project(agentId, id)
  }

  attachRepository(agentId: string, projectId: string, path: string): Project {
    const project = this.project(agentId, projectId)
    if (project.repositoryPath !== null) throw new Error('This project already has a repository. Relinking is not available yet.')
    if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error('Choose an existing repository folder.')
    this.db.prepare('UPDATE projects SET repositoryPath = ? WHERE id = ?').run(path, projectId)
    return this.project(agentId, projectId)
  }

  location(agentId: string, input?: Partial<ConversationLocation>, retention: ChatRetention = 'permanent'): ConversationLocation {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['sectionId', 'projectId'].includes(key)))) throw new Error('Invalid chat location.')
    const sectionId = input?.sectionId ?? this.ensureGeneral(agentId).id
    if (typeof sectionId !== 'string') throw new Error('Choose a section.')
    this.section(agentId, sectionId)
    const projectId = input?.projectId ?? null
    if (projectId !== null) {
      if (typeof projectId !== 'string' || this.project(agentId, projectId).sectionId !== sectionId) throw new Error('The project does not belong to this section.')
      if (retention === 'temporary') throw new Error('Keep a temporary chat permanently before moving it into a project.')
    }
    return { sectionId, projectId }
  }

  move(agentId: string, id: string, target: ConversationLocation) {
    if (!target || typeof target.sectionId !== 'string' ||
        !(target.projectId === null || typeof target.projectId === 'string')) throw new Error('Choose a complete chat location.')
    const chat = this.db.prepare('SELECT * FROM conversations WHERE id = ? AND agentId = ?').get(id, agentId) as (ConversationLocation & { retention: ChatRetention }) | undefined
    if (!chat) throw new Error('Conversation not found.')
    const location = this.location(agentId, target, chat.retention)
    const problem = chatMoveProblem(chat, location, this.snapshot(agentId))
    if (problem) throw new Error(problem)
    if (chat.sectionId === location.sectionId && chat.projectId === location.projectId) return
    this.db.transaction(() => {
      this.db.prepare("UPDATE conversations SET sectionId = ?, projectId = ?, engine = '' WHERE id = ?")
        .run(location.sectionId, location.projectId, id)
      // Reconstruct context in the destination. Preserve messages and old graph
      // ownership, but never reuse a source location's native continuation.
      this.db.prepare('DELETE FROM harness_state WHERE conversationId = ?').run(id)
    })()
  }
}
