export default function Chevron({ expanded }: { expanded: boolean }) {
  return <svg className="chevron-icon" width="12" height="12" viewBox="0 0 12 12"
    fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">
    <polyline points={expanded ? '3 4.5 6 7.5 9 4.5' : '4.5 3 7.5 6 4.5 9'} />
  </svg>
}
