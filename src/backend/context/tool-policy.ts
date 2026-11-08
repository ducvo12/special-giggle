// These results contain cached source bytes. Evict them when their evidence
// changes, while retaining completed actions and independent visible dialogue.
export const cachedRetrievalTools: ReadonlySet<string> = new Set([
  'list_context',
  'search_context',
  'read_context',
  'read_file',
  'grep',
  'glob',
  'ls',
  'load_skill'
])
