import { paneTypes, type PaneType } from './panes/pane-types'

interface HeaderProps {
  paneType: PaneType
  onPaneTypeChange: (type: PaneType) => void
  onAddGroup: () => void
  canAddGroup: boolean
}

// Keep temporary group creation available while real explorer content opening is deferred.
export default function Header({ onAddGroup, canAddGroup, paneType, onPaneTypeChange }: HeaderProps) {
  return (
    <header className={`app-header ${window.granite.platform === 'darwin' ? 'app-header-mac' : ''}`}>
      <div className="app-brand">
        <span>Archon</span>
      </div>

      <select
        className="new-group-region quiet-button"
        aria-label="New group region"
        value={paneType}
        onChange={event => {
          if (event.currentTarget.value === 'explorer' || event.currentTarget.value === 'content') {
            onPaneTypeChange(event.currentTarget.value)
          }
        }}
      >
        <option value="content">
          {paneTypes.content.label}
        </option>

        <option value="explorer">
          {paneTypes.explorer.label}
        </option>
      </select>

      <button
        type="button"
        className="add-group quiet-button"
        aria-label={`Add ${paneTypes[paneType].label} group`}
        onClick={onAddGroup}
        disabled={!canAddGroup}
        title={canAddGroup ? 'Add group' : 'Enlarge this region or close a group to make room'}
      >
        Add group
      </button>
    </header>
  )
}
