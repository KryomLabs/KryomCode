import { useState } from 'react'
import { baseName } from '../utils/paths'

export interface WelcomePageProps {
  workspaceRoot: string | null
  defaultModel: string
  onOpenProject: () => void
  onShowAiChat: () => void
  onShowTerminal: () => void
  onShowResearch: () => void
  onSubmitChat: (prompt: string) => void
  onSubmitAgent: (task: string) => void
}

type WelcomeMode = 'chat' | 'agent' | 'research'

function modelDisplayName(modelId: string): string {
  if (modelId === 'muse-wonder-1.0') {
    return 'Muse Wonder 1.0'
  }

  return 'Muse Spark 1.3'
}

const CHAT_SUGGESTIONS = [
  'Explain my project structure',
  'How do I fix a failing npm build?',
  'Suggest tests for a utility module',
] as const

const AGENT_SUGGESTIONS = [
  'Add input validation to the signup form',
  'Refactor a large utility into smaller functions',
  'Add error handling around file saves',
] as const

function composerPlaceholder(mode: WelcomeMode, hasWorkspace: boolean): string {
  if (mode === 'research') {
    return 'Research runs in the RESEARCH tab below. Open it to search papers and build a cited brief.'
  }

  if (mode === 'agent') {
    return hasWorkspace
      ? 'Describe the change, e.g. add input validation to the signup form…'
      : 'Open a project first, then describe the change for the agent…'
  }

  return 'Ask about your code, debugging, or implementation ideas…'
}

export function WelcomePage(props: WelcomePageProps) {
  const [mode, setMode] = useState<WelcomeMode>('chat')
  const [prompt, setPrompt] = useState('')
  const [notice, setNotice] = useState('')
  const hasWorkspace = props.workspaceRoot !== null
  const isResearch = mode === 'research'
  const maxLength = mode === 'chat' ? 12000 : 4000
  const suggestions =
    mode === 'agent' ? AGENT_SUGGESTIONS : CHAT_SUGGESTIONS

  function selectMode(next: WelcomeMode) {
    setMode(next)
    setNotice('')
  }

  function submitText(text: string) {
    const trimmed = text.trim()

    if (isResearch || trimmed === '') {
      return
    }

    if (mode === 'chat') {
      props.onSubmitChat(trimmed)
      setPrompt('')
      setNotice('Sent to Kryom AI. See the AI Chat panel for the response.')
      return
    }

    if (!hasWorkspace) {
      setPrompt(trimmed)
      setNotice('Open a project to run agent tasks. Your text is kept above.')
      return
    }

    props.onSubmitAgent(trimmed)
    setPrompt('')
    setNotice(
      'Task sent to the Coding agent. Review the plan in the Agent panel; the Terminal is open for commands.'
    )
  }

  return (
    <div className="welcome welcome-redesign">
      <div className="welcome-inner">
        <p className="welcome-brand">KryomCode</p>
        <h1>What should we build or discover?</h1>
        <p className="welcome-tagline">
          {hasWorkspace
            ? `Project ${baseName(props.workspaceRoot ?? '')} is open. Ask AI, plan an agent task, or pick a file in the Explorer.`
            : 'Open a project to browse files, edit code, run commands, and ask AI for help.'}
        </p>

        <div className="welcome-modes" role="group" aria-label="Assistant mode">
          <button
            type="button"
            className={mode === 'chat' ? 'welcome-mode active' : 'welcome-mode'}
            aria-pressed={mode === 'chat'}
            onClick={() => selectMode('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            className={mode === 'agent' ? 'welcome-mode active' : 'welcome-mode'}
            aria-pressed={mode === 'agent'}
            onClick={() => selectMode('agent')}
          >
            Agent
          </button>
          <button
            type="button"
            className={
              mode === 'research' ? 'welcome-mode active' : 'welcome-mode'
            }
            aria-pressed={mode === 'research'}
            onClick={() => selectMode('research')}
            title="Research runs in the RESEARCH tab"
          >
            Research
          </button>
        </div>

        <form
          className="welcome-composer"
          onSubmit={(event) => {
            event.preventDefault()
            submitText(prompt)
          }}
        >
          <textarea
            aria-label={
              mode === 'agent' ? 'Describe a coding task' : 'Ask Kryom AI'
            }
            value={prompt}
            onChange={(event) =>
              setPrompt(event.target.value.slice(0, maxLength))
            }
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                submitText(prompt)
              }
            }}
            placeholder={composerPlaceholder(mode, hasWorkspace)}
            rows={4}
            maxLength={maxLength}
            disabled={isResearch}
          />
          <div className="composer-footer welcome-composer-footer">
            <span className="muted">
              {prompt.length}/{maxLength}
            </span>
            <button
              type="submit"
              disabled={isResearch || prompt.trim() === ''}
            >
              {mode === 'agent' ? 'Start agent task' : 'Ask AI'}
            </button>
          </div>
        </form>

        {isResearch ? (
          <p className="welcome-notice" role="status">
            Research runs in the RESEARCH tab, where you can search papers
            and build a cited brief. Nothing runs in this composer.
          </p>
        ) : notice ? (
          <p className="welcome-notice" role="status">
            {notice}
          </p>
        ) : mode === 'agent' && !hasWorkspace ? (
          <p className="welcome-notice" role="status">
            Agent tasks need an open project. Open one below to continue.
          </p>
        ) : null}

        {!isResearch && (
          <div className="welcome-suggestions" aria-label="Suggested prompts">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="welcome-suggestion"
                onClick={() => submitText(suggestion)}
                title={`Run: ${suggestion}`}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <div className="welcome-actions">
          <button className="primary-button" onClick={props.onOpenProject}>
            Open Project
          </button>
          <button className="secondary-button" onClick={props.onShowAiChat}>
            AI Chat
          </button>
          <button className="secondary-button" onClick={props.onShowResearch}>
            Research
          </button>
          <button className="secondary-button" onClick={props.onShowTerminal}>
            Terminal
          </button>
        </div>

        <p className="welcome-meta muted">
          Default model:{' '}
          <strong>{modelDisplayName(props.defaultModel)}</strong>
        </p>

        <p className="welcome-keys">
          <kbd>Ctrl</kbd> + <kbd>Enter</kbd> sends from the composer
          <span className="welcome-key-sep" aria-hidden="true">
            ·
          </span>
          <kbd>Ctrl</kbd> + <kbd>S</kbd> saves the active file
          <span className="welcome-key-sep" aria-hidden="true">
            ·
          </span>
          <kbd>Ctrl</kbd> + <kbd>`</kbd> toggles the bottom panel
        </p>
      </div>
    </div>
  )
}
