import type { SavedConnection } from '../../../shared/chat'
import ConnectionUsageCircles from '../features/connections/ConnectionUsage'

type Props = {
  activeTab?: string
  onSelectTab?: (tab: string) => void
  onBack: () => void
  connections: SavedConnection[]
}

export default function SettingsSidebar({
  activeTab = 'connections',
  onSelectTab,
  onBack,
  connections
}: Props) {
  return (
    <aside id="app-sidebar" className="sidebar settings-sidebar" aria-label="Settings navigation">
      <button
        type="button"
        className="settings-back-button quiet-button"
        onClick={onBack}
        aria-label="Back to workspace"
        title="Back to workspace"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5m7 7-7-7 7-7" />
        </svg>
        <span>Back</span>
      </button>

      <div className="settings-sidebar-heading">Settings</div>

      <nav className="settings-nav" aria-label="Settings categories">
        <button
          type="button"
          className={`settings-nav-item ${activeTab === 'providers' || activeTab === 'connections' ? 'active' : ''}`}
          aria-current={activeTab === 'providers' || activeTab === 'connections' ? 'page' : undefined}
          onClick={() => onSelectTab?.('providers')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
          </svg>
          <span>Providers</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-settings quiet-button selected"
          aria-label="Back to workspace"
          title="Back to workspace"
          onClick={onBack}
        >
          <svg
            width="18"
            height="18"
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

        <ConnectionUsageCircles connections={connections} />
      </div>
    </aside>
  )
}
