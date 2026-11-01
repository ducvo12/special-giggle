import { useId, useRef, useState } from 'react'
import type { ContextReference } from '../../../../shared/context'
import type { GraniteBridge } from '../../../../shared/chat'
import { groupSources } from './context-sources'

type Source = Awaited<ReturnType<GraniteBridge['context']['read']>>
type Props = {
  agentId: string
  chatId: string
  sources: ContextReference[]
  excludeMessageIds?: ReadonlySet<string>
  trace?: boolean
}

export default function ContextSources({ agentId, chatId, sources, excludeMessageIds, trace = false }: Props) {
  const [selection, setSelection] = useState<{ id: string; result?: Source } | null>(null)
  const readerId = useId()
  const request = useRef({ version: 0, sourceId: null as string | null })
  const loading = Boolean(selection && !selection.result)
  const result = selection?.result
  const groups = groupSources(sources, excludeMessageIds)
  async function read(id: string, anchorId = id) {
    const current = ++request.current.version
    request.current.sourceId = anchorId
    setSelection({ id: anchorId })
    try {
      const result = await window.granite.context.read(agentId, chatId, id)
      if (request.current.version === current) setSelection({ id: anchorId, result })
    } catch {
      if (request.current.version === current) setSelection({ id: anchorId, result: { ok: false, error: 'Could not open this source.' } })
    }
  }
  function toggle(id: string) {
    if (request.current.sourceId === id) {
      request.current.version++
      request.current.sourceId = null
      setSelection(null)
    } else void read(id)
  }
  const sourceButton = (source: ContextReference, label: string) => <button type="button" className="context-source-link" key={source.id}
    data-source-id={source.id} aria-expanded={selection?.id === source.id} aria-controls={readerId}
    onClick={() => toggle(source.id)}>{label}</button>
  if (!trace && !groups.length) return null
  return <details className={`context-sources${trace ? ' context-source-trace' : ''}`}>
    <summary title={trace ? 'All recorded source references for this reply' : 'View saved context for this reply'}>
      {trace ? 'Recorded sources' : 'Sources'} <span className="context-source-count">{trace ? sources.length : groups.length}</span>
    </summary>
    <div className="context-source-links">
      {trace ? sources.map(source => sourceButton(source, `${source.kind} · ${source.title}`)) : groups.map(group => (
        <div className="context-source-group" key={group.key} data-source-group={group.key}>
          {group.sources.length === 1 ? sourceButton(group.sources[0], group.title) : <details>
            <summary><span>{group.title}</span><span className="context-source-count">{group.sources.length} entries</span></summary>
            <div className="context-source-entries">{group.sources.map((source, index) => sourceButton(source,
              source.kind === 'summary' ? 'Chat summary' : `Message ${index + 1}`))}</div>
          </details>}
        </div>
      ))}
    </div>
    {selection && <section id={readerId} className="context-source-reader" aria-label="Original saved source" aria-busy={loading}>
      {loading && <span className="context-source-loading" role="status">Opening source…</span>}
      {result?.ok ? <>
        <h3>{result.value.title}</h3>
        <small>{result.value.kind === 'message' ? result.value.role === 'user' ? 'Your saved message' : 'Agent’s saved message'
          : result.value.kind === 'summary' ? 'Chat summary' : result.value.path}</small>
        {trace && <small className="context-source-revision">{result.value.id} · revision {result.value.revision.slice(0, 12)}</small>}
        <pre>{result.value.content}</pre>
        {result.value.items?.map(item => <div key={item.id}><p>{item.text}</p>{item.source_ids.map((id, index) => <button type="button"
          className="context-source-link" key={id} onClick={() => void read(id, selection.id)}>Supporting source {index + 1}</button>)}</div>)}
      </> : result && <p role="alert">{result.error}</p>}
    </section>}
  </details>
}
