import { baseName } from '../utils/paths'
import { modelDisplayName } from '../utils/models'
import logoUrl from '../../assets/branding/kryomcode-logo.png'
import type { DiscoveryMode } from './WelcomePage'

export interface TitleBarProps {
  workspaceRoot: string | null
  activeLabel: string | null
  dirty: boolean
  autoSave: boolean
  sidebarVisible: boolean
  bottomOpen: boolean
  onToggleSidebar: () => void
  onToggleBottom: () => void
  discoveryMode: DiscoveryMode
  onDiscoveryModeChange: (mode: DiscoveryMode) => void
}

// Compact IDE title bar under the native menu (File … Help stay
// native for accessibility and window behavior; minimize/maximize/
// close stay on the native OS frame). Shows the product logo, the
// current workspace, the active editor, and layout controls.
export function TitleBar(props: TitleBarProps) {
  const project = props.workspaceRoot ? baseName(props.workspaceRoot) : null

  return (
    <header className="titlebar">
      <span className="title-brand" aria-label="KryomCode">
        <img
          className="title-logo"
          src={logoUrl}
          alt=""
          aria-hidden="true"
          width={18}
          height={18}
        />
        KryomCode
      </span>

      <span className="title-crumb muted" title={props.workspaceRoot ?? ''}>
        {project ?? 'No project selected'}
        {props.activeLabel ? ` › ${props.activeLabel}${props.dirty ? ' •' : ''}` : ''}
      </span>

      <span
        className="title-modes"
        role="group"
        aria-label="Discovery mode"
        title="Chat or Research in the central workspace"
      >
        <button
          type="button"
          className={
            props.discoveryMode === 'chat'
              ? 'title-mode-btn active'
              : 'title-mode-btn'
          }
          aria-pressed={props.discoveryMode === 'chat'}
          onClick={() => props.onDiscoveryModeChange('chat')}
        >
          Chat
        </button>
        <button
          type="button"
          className={
            props.discoveryMode === 'research'
              ? 'title-mode-btn active'
              : 'title-mode-btn'
          }
          aria-pressed={props.discoveryMode === 'research'}
          onClick={() => props.onDiscoveryModeChange('research')}
        >
          Research
        </button>
      </span>

      {props.autoSave && (
        <span className="chip" title="Auto Save is on (File menu to change)">
          Auto-save
        </span>
      )}

      <span className="spacer" />

      <span className="title-layout" role="group" aria-label="Layout">
        <button
          type="button"
          className="title-layout-btn"
          onClick={props.onToggleSidebar}
          title={props.sidebarVisible ? 'Hide sidebar (Ctrl+B)' : 'Show sidebar (Ctrl+B)'}
          aria-label={props.sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          aria-pressed={props.sidebarVisible}
        >
          ◧
        </button>
        <button
          type="button"
          className="title-layout-btn"
          onClick={props.onToggleBottom}
          title={props.bottomOpen ? 'Hide bottom panel (Ctrl+J)' : 'Show bottom panel (Ctrl+J)'}
          aria-label={props.bottomOpen ? 'Hide bottom panel' : 'Show bottom panel'}
          aria-pressed={props.bottomOpen}
        >
          ◫
        </button>
      </span>
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
  providerLabel: string | null
  providerOk: boolean | null
  onOpenProviderSettings: () => void
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

        <button
          type="button"
          className="status-btn"
          onClick={props.onOpenProviderSettings}
          title={
            props.providerOk === null
              ? 'Provider status unknown — click for provider settings'
              : props.providerOk
                ? `${props.providerLabel ?? 'AI configured'} — click for provider settings`
                : 'Meta AI is not configured — click to configure'
          }
        >
          {props.providerOk === null
            ? 'AI …'
            : props.providerOk
              ? `AI ${props.providerLabel ?? 'ready'}`
              : 'AI not configured'}
        </button>

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
