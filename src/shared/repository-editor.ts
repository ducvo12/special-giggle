export interface RepositoryEditor {
  id: string
  name: string
}

export interface RepositoryEditorChoices {
  editors: RepositoryEditor[]
  selectedId: string | null
}
