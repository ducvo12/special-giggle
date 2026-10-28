import { useId, useState, type ReactNode } from 'react'

export default function ActivitySection({ title, summary, actions, children }: {
  title: string; summary?: ReactNode; actions?: ReactNode; children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <section className="activity-section">
    <div className="activity-section-heading">
      <h3><button type="button" className="activity-disclosure" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <span className="activity-section-label">{title}</span>{summary}
      </button></h3>
      {actions}
    </div>
    <div id={id} hidden={!open} className="activity-section-content">{children}</div>
  </section>
}
