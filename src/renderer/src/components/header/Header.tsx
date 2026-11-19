interface HeaderProps {
  onOpenSettings: () => void
}

export default function Header({ onOpenSettings }: HeaderProps) {
  return (
    <header className={`app-header ${window.granite.platform === 'darwin' ? 'app-header-mac' : ''}`}>
      <div className="app-brand">
        Archon
      </div>

      {onOpenSettings && (
        <button
          type="button"
          className="header-settings-button"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9.5 3-.6 2.3-1.4.8L5.2 5.5 2.7 9.8l1.7 1.7v1.6l-1.7 1.7 2.5 4.3 2.3-.6 1.4.8.6 2.3h5l.6-2.3 1.4-.8 2.3.6 2.5-4.3-1.7-1.7v-1.6l1.7-1.7-2.5-4.3-2.3.6-1.4-.8L14.5 3Z" />
            <circle cx="12" cy="12.3" r="3" />
          </svg>
        </button>
      )}
    </header>
  )
}
