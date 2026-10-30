import { useState } from 'react'
import type { ContextReference } from '../../../../shared/context'
import type { GraniteBridge } from '../../../../shared/chat'
type Source = Awaited<ReturnType<GraniteBridge['context']['read']>>

export default function ContextSources({ agentId, chatId, sources }: { agentId: string; chatId: string; sources: ContextReference[] }) {
  const [selection, setSelection] = useState<Source | null>(null)
  const [loading, setLoading] = useState(false)
  async function read(id: string) {
    setLoading(true)
    try { setSelection(await window.granite.context.read(agentId, chatId, id)) }
    catch { setSelection({ ok: false, error: 'Could not open this source.' }) }
    finally { setLoading(false) }
  }
  return <details className="context-sources">
    <summary>Context sources ({sources.length})</summary>
    <div className="context-source-links">{sources.map(source => <button type="button" className="quiet-button" key={source.id} data-source-id={source.id} disabled={loading} onClick={() => void read(source.id)}>{source.kind} · {source.title}</button>)}</div>
    {selection && <section className="context-source-reader" aria-label="Original saved source">
      <button className="quiet-button" onClick={() => setSelection(null)}>Close source</button>
      {selection.ok ? <><h3>{selection.value.title}</h3><small>{selection.value.messageId ? `Message ${selection.value.messageId}` : selection.value.path} · revision {selection.value.revision.slice(0, 12)}</small>
        <pre>{selection.value.content}</pre>
        {selection.value.items?.map(item => <div key={item.id}><p>{item.text}</p>{item.source_ids.map(id => <button className="quiet-button" key={id} onClick={() => void read(id)}>Supporting source · {id}</button>)}</div>)}
      </> : <p role="alert">{selection.error}</p>}
    </section>}
  </details>
}
