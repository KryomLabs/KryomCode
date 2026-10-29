import { baseName } from '../utils/paths'
import { modelDisplayName } from '../utils/models'

export interface TitleBarProps {
  workspaceRoot: string | null
  activeFile: string | null
  dirty: boolean
  autoSave: boolean
}

// Slim context bar under the native menu: product mark and a
// project/file breadcrumb. Actions live where they are used: Open
// Project in Explorer, Save in the editor tab bar, Settings at the
// bottom of the activity bar.
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
  bottomOpen: boolean
  onToggleBottom: () => void
}

// Compact status bar. Every segment is verified live state: no fake
// counts, branches, or diagnostics.
export function StatusBar(props: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span className="status-left">
        <button
          className="status-toggle"
          onClick={props.onToggleBottom}
          title={
            props.bottomOpen
              ? 'Hide bottom panel (Ctrl+J)'
              : 'Show bottom panel (Ctrl+J)'
          }
          aria-label={props.bottomOpen ? 'Hide bottom panel' : 'Show bottom panel'}
        >
          {props.bottomOpen ? '▾ Panel' : '▸ Panel'}
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
