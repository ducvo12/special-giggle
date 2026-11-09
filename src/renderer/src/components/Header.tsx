import { paneTypes, type PaneType } from './panes/pane-types'

interface HeaderProps {
  paneType: PaneType
  onPaneTypeChange: (type: PaneType) => void
  navigationOpen: boolean
  onAddPane: () => void
  canAddPane: boolean
}

// Reserve space for native controls and expose the two pane families for creation.
const Header = ({ onAddPane, canAddPane, paneType, onPaneTypeChange, navigationOpen }: HeaderProps) => {
  let addTitle = 'Add pane'
  if (paneType === 'navigation' && navigationOpen) {
    addTitle = 'The navigation pane is already open'
  } else if (!canAddPane) {
    addTitle = 'Enlarge the window or close a pane to make room'
  }

  return (
    <header
      className={`app-header ${window.granite.platform === "darwin" ? "app-header-mac" : ""}`}
    >
      <div className="app-brand">
        <span>Archon</span>
      </div>

      <select
        className="new-pane-type quiet-button"
        aria-label="New pane type"
        value={paneType}
        onChange={event => {
          if (event.currentTarget.value === 'navigation' || event.currentTarget.value === 'content') {
            onPaneTypeChange(event.currentTarget.value)
          }
        }}
      >
        <option value="content">
          {paneTypes.content.label}
        </option>

        <option value="navigation">
          {paneTypes.navigation.label}
        </option>
      </select>

      <button
        type="button"
        className="add-pane quiet-button"
        aria-label={`Add ${paneTypes[paneType].label.toLowerCase()} pane`}
        onClick={onAddPane}
        disabled={!canAddPane}
        title={addTitle}
      >
        Add pane
      </button>
    </header>
  );
};

export default Header;
