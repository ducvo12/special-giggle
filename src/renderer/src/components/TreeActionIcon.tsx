export default function TreeActionIcon({ plus = false }: { plus?: boolean }) {
  return plus ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
    strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M8 3v10M3 8h10" /></svg>
    : <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="3" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="13" cy="8" r="1.2" />
    </svg>
}
