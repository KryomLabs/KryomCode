export interface TopBarProps {
  workspaceRoot: string | null
  canSave: boolean
  busy: boolean
  onOpenProject: () => void
  onCloseProject: () => void
  onSave: () => void
  onOpenSettings: () => void
}

export function TopBar(props: TopBarProps) {
  return (
    <header className="topbar">
      <strong className="brand">KryomCode</strong>

      <button onClick={props.onOpenProject} disabled={props.busy}>
        Open Project
      </button>

      <button
        onClick={props.onCloseProject}
        disabled={!props.workspaceRoot || props.busy}
        title="Close the current project"
      >
        Close
      </button>

      <span className="muted">
        {props.workspaceRoot ?? 'No project selected'}
      </span>

      <span className="spacer" />

      <button
        onClick={props.onOpenSettings}
        title="Settings"
        aria-label="Open settings"
      >
        Settings
      </button>

      <button onClick={props.onSave} disabled={!props.canSave}>
        Save File
      </button>
    </header>
  )
}

export interface StatusBarProps {
  status: string
  fileName: string | null
  dirty: boolean
  platform: string
  bottomOpen: boolean
  onToggleBottom: () => void
}

export function StatusBar(props: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span className="status-left">
        <button
          className="status-toggle"
          onClick={props.onToggleBottom}
          title={props.bottomOpen ? 'Hide panel (Ctrl+`)' : 'Show panel (Ctrl+`)'}
          aria-label={props.bottomOpen ? 'Hide bottom panel' : 'Show bottom panel'}
        >
          {props.bottomOpen ? '▾ Panel' : '▸ Panel'}
        </button>
        <span>{props.status}</span>
      </span>
      <span className="status-right">
        {props.fileName && (
          <span>
            {props.fileName}
            {props.dirty ? ' •' : ''}
          </span>
        )}
        <span>{props.platform}</span>
      </span>
    </footer>
  )
}
