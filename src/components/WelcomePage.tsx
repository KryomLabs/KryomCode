import { baseName } from '../utils/paths'

export interface WelcomePageProps {
  workspaceRoot: string | null
  defaultModel: string
  onOpenProject: () => void
  onShowAiChat: () => void
  onShowTerminal: () => void
}

function modelDisplayName(modelId: string): string {
  if (modelId === 'muse-wonder-1.0') {
    return 'Muse Wonder 1.0'
  }

  return 'Muse Spark 1.3'
}

export function WelcomePage(props: WelcomePageProps) {
  const hasWorkspace = props.workspaceRoot !== null

  return (
    <div className="welcome">
      <p className="welcome-brand">KryomCode</p>
      <h1>
        {hasWorkspace
          ? 'No file open.'
          : 'Your AI-powered coding workspace.'}
      </h1>
      <p className="welcome-tagline">
        {hasWorkspace
          ? `Project ${baseName(props.workspaceRoot ?? '')} is open. Select a file in the Explorer to start editing.`
          : 'Open a project to browse files, edit code, run commands, and ask AI for help.'}
      </p>

      <div className="welcome-actions">
        <button className="primary-button" onClick={props.onOpenProject}>
          Open Project
        </button>
        <button className="secondary-button" onClick={props.onShowAiChat}>
          Ask AI
        </button>
        <button className="secondary-button" onClick={props.onShowTerminal}>
          Open Terminal
        </button>
      </div>

      <div className="welcome-grid">
        <div className="welcome-card">
          <h2>Get started</h2>
          <ul>
            <li>Open a project folder from the Explorer.</li>
            <li>Click a file to open it in an editor tab.</li>
            <li>Edit with Monaco; unsaved tabs show a dot.</li>
          </ul>
        </div>
        <div className="welcome-card">
          <h2>AI assistance</h2>
          <ul>
            <li>Chat about your code with context attached.</li>
            <li>Review agent plans before applying edits.</li>
            <li>
              Default model:{' '}
              <strong>{modelDisplayName(props.defaultModel)}</strong>
            </li>
          </ul>
        </div>
        <div className="welcome-card">
          <h2>Run and inspect</h2>
          <ul>
            <li>Run terminal commands in the project folder.</li>
            <li>Check Problems for build diagnostics.</li>
            <li>Review diffs and commit from the Git panel.</li>
          </ul>
        </div>
      </div>

      <p className="welcome-keys">
        <kbd>Ctrl</kbd> + <kbd>S</kbd> saves the active file
        <span className="welcome-key-sep" aria-hidden="true">
          ·
        </span>
        <kbd>Ctrl</kbd> + <kbd>`</kbd> toggles the bottom panel
      </p>
    </div>
  )
}
