export interface RepositoryAccess {
  projectId: string
  sectionId: string
  name: string
  writable: boolean
}

export interface RepositoryChange {
  path: string
  previousPath?: string
  directory?: boolean
  symbolicLink?: boolean
  generated?: boolean
  kind: 'added' | 'modified' | 'deleted' | 'renamed'
  binary: boolean
  large?: boolean
  modeChanged?: boolean
  added: number
  removed: number
  diff: string
  truncated?: boolean
}

export interface RepositoryReport {
  runId: string
  projectId: string
  name: string
  state: 'active' | 'settled' | 'attention'
  changes: RepositoryChange[]
  gitChanged?: boolean
  preExisting: number
  error?: string
  commands?: RepositoryCommandSnapshot[]
  commandVersion?: number
}

export interface RepositoryCommandSnapshot {
  id: string
  command: string
  cwd: string
  interactive: boolean
  status: 'starting' | 'running' | 'publishing' | 'complete' | 'failed' | 'stopped'
  publication: 'staged' | 'applied' | 'discarded' | 'partial'
  inputRevision: number
  output: string
  exitCode?: number | null
  error?: string
}
