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
          className={`settings-nav-item ${activeTab === 'connections' ? 'active' : ''}`}
          aria-current={activeTab === 'connections' ? 'page' : undefined}
          onClick={() => onSelectTab?.('connections')}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span>Connections</span>
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
