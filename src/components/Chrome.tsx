import { baseName } from '../utils/paths'
import { modelDisplayName } from '../utils/models'

export interface TitleBarProps {
  workspaceRoot: string | null
  activeFile: string | null
  dirty: boolean
  canSave: boolean
  busy: boolean
  autoSave: boolean
  onOpenProject: () => void
  onSave: () => void
  onOpenSettings: () => void
}

// Slim context bar under the native menu: product mark, project/file
// breadcrumb, and the handful of global actions.
export function TitleBar(props: TitleBarProps) {
  const project = props.workspaceRoot ? baseName(props.workspaceRoot) : null

  return (
    <header className="titlebar">
      <span className="title-brand" aria-label="KryomCode">
        <span className="title-mark" aria-hidden="true">
          K
        </span>
        KryomCode
      </span>

      <span className="title-crumb muted" title={props.workspaceRoot ?? ''}>
        {project ?? 'No project selected'}
        {props.activeFile
          ? ` › ${baseName(props.activeFile)}${props.dirty ? ' •' : ''}`
          : ''}
      </span>

      {props.autoSave && (
        <span className="chip" title="Auto Save is on (File menu to change)">
          Auto-save
        </span>
      )}

      <span className="spacer" />

      <button
        type="button"
        className="title-btn"
        onClick={props.onOpenProject}
        disabled={props.busy}
        title="Open a project folder (Ctrl+Shift+O)"
      >
        Open Project
      </button>

      <button
        type="button"
        className="title-btn"
        onClick={props.onSave}
        disabled={!props.canSave}
        title="Save the active file (Ctrl+S)"
      >
        Save
      </button>

      <button
        type="button"
        className="title-btn"
        onClick={props.onOpenSettings}
        title="Settings"
        aria-label="Open settings"
      >
        Settings
      </button>
    </header>
  )
}

export interface StatusBarProps {
  status: string
  workspaceName: string | null
  branch: string | null
  branchKnown: boolean
  onBranchRefresh: () => void
  fileName: string | null
  dirty: boolean
  language: string | null
  line: number | null
  column: number | null
  model: string
  autoSave: boolean
  terminalRunning: boolean
  diagnostics: { count: number; success: boolean } | null
  onShowDiagnostics: () => void
  rightOpen: boolean
  onToggleRight: () => void
}

// Compact status bar. Every segment is verified live state: no fake
// counts, branches, or diagnostics.
export function StatusBar(props: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span className="status-left">
        <button
          className="status-toggle"
          onClick={props.onToggleRight}
          title={
            props.rightOpen
              ? 'Hide right panel (Ctrl+J)'
              : 'Show right panel (Ctrl+J)'
          }
          aria-label={props.rightOpen ? 'Hide right panel' : 'Show right panel'}
        >
          {props.rightOpen ? '▾ Terminal' : '▸ Terminal'}
        </button>
        <span className="status-msg" title={props.status}>
          {props.status}
        </span>
        {props.terminalRunning && (
          <span className="status-run" title="A terminal command is running">
            <span className="run-dot" aria-hidden="true" />
            Running
          </span>
        )}
        {props.diagnostics && (
          <button
            type="button"
            className="status-btn"
            onClick={props.onShowDiagnostics}
            title={
              props.diagnostics.success
                ? `${props.diagnostics.count} problem(s) from the last diagnostics run — click to open`
                : 'Last diagnostics run failed — click to open'
            }
          >
            {props.diagnostics.success
              ? `✓ ${props.diagnostics.count}`
              : `✕ ${props.diagnostics.count}`}
          </button>
        )}
      </span>

      <span className="status-right">
        {props.workspaceName && (
          <span className="status-seg" title="Open project">
            {props.workspaceName}
          </span>
        )}

        <button
          type="button"
          className="status-btn"
          onClick={props.onBranchRefresh}
          title={
            props.branchKnown
              ? `Git branch ${props.branch ?? 'detached HEAD'} — click to refresh`
              : 'No Git repository verified — click to recheck'
          }
        >
          {props.branchKnown ? `⎇ ${props.branch ?? 'detached'}` : '⎇ no repo'}
        </button>

        {props.fileName && (
          <span
            className="status-seg"
            title={props.language ? `Language: ${props.language}` : 'Open file'}
          >
            {props.fileName}
            {props.dirty ? ' •' : ''}
            {props.language ? ` · ${props.language}` : ''}
          </span>
        )}

        {props.line !== null && props.column !== null && (
          <span className="status-seg" title="Cursor position">
            Ln {props.line}, Col {props.column}
          </span>
        )}

        <span className="status-seg" title={`Default model: ${props.model}`}>
          {modelDisplayName(props.model)}
        </span>

        <span
          className="status-seg"
          title={props.autoSave ? 'Auto Save is on' : 'Auto Save is off'}
        >
          {props.autoSave ? 'Auto-save' : 'Save: manual'}
        </span>
      </span>
    </footer>
  )
}
