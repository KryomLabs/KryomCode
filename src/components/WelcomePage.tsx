import { useState } from 'react'
import { baseName } from '../utils/paths'
import { modelDisplayName } from '../utils/models'

export interface WelcomePageProps {
  workspaceRoot: string | null
  defaultModel: string
  recent: string[]
  onOpenProject: () => void
  onOpenRecent: (path: string) => void
  onClearRecent: () => void
  onShowAiChat: () => void
  onShowResearch: () => void
  onShowTerminal: () => void
  onSubmitChat: (prompt: string) => void
  onSubmitAgent: (task: string) => void
  onSubmitResearch: (objective: string) => void
}

type WelcomeMode = 'chat' | 'agent' | 'research'

const CHAT_SUGGESTIONS = [
  'Explain my project structure',
  'Find and fix a build error',
  'Suggest tests for a utility module',
] as const

const AGENT_SUGGESTIONS = [
  'Add input validation to the signup form',
  'Refactor a large utility into smaller functions',
  'Add error handling around file saves',
] as const

const RESEARCH_SUGGESTIONS = [
  'Research algorithms for warehouse robotics',
  'Compare embedded databases for offline-first apps',
  'Survey retry strategies for flaky network calls',
] as const

const MAX_LENGTHS: Record<WelcomeMode, number> = {
  chat: 12000,
  agent: 4000,
  research: 2000,
}

function composerPlaceholder(mode: WelcomeMode, hasWorkspace: boolean): string {
  if (mode === 'research') {
    return hasWorkspace
      ? 'Describe the research objective, e.g. algorithms for warehouse robotics…'
      : 'Open a project first — research sessions are saved inside it…'
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
  // One draft per mode so switching modes never loses entered text.
  const [drafts, setDrafts] = useState<Record<WelcomeMode, string>>({
    chat: '',
    agent: '',
    research: '',
  })
  const [notice, setNotice] = useState('')
  const hasWorkspace = props.workspaceRoot !== null
  const maxLength = MAX_LENGTHS[mode]
  const prompt = drafts[mode]
  const suggestions =
    mode === 'agent'
      ? AGENT_SUGGESTIONS
      : mode === 'research'
        ? RESEARCH_SUGGESTIONS
        : CHAT_SUGGESTIONS

  function selectMode(next: WelcomeMode) {
    setMode(next)
    setNotice('')
  }

  function setPrompt(value: string) {
    setDrafts((previous) => ({
      ...previous,
      [mode]: value.slice(0, maxLength),
    }))
  }

  function clearPrompt() {
    setDrafts((previous) => ({ ...previous, [mode]: '' }))
  }

  function submitText(text: string) {
    const trimmed = text.trim()

    if (trimmed === '') {
      return
    }

    if (mode === 'chat') {
      props.onSubmitChat(trimmed)
      clearPrompt()
      setNotice('Sent to Kryom AI. See the AI Chat panel for the response.')
      return
    }

    if (!hasWorkspace) {
      setDrafts((previous) => ({ ...previous, [mode]: trimmed }))
      setNotice(
        mode === 'research'
          ? 'Open a project to run research. Your text is kept above.'
          : 'Open a project to run agent tasks. Your text is kept above.'
      )
      return
    }

    if (mode === 'research') {
      props.onSubmitResearch(trimmed)
      clearPrompt()
      setNotice(
        'Research started. Follow progress in the Research panel; the brief is cited and saved.'
      )
      return
    }

    props.onSubmitAgent(trimmed)
    clearPrompt()
    setNotice(
      'Task sent to the Coding agent. Review the plan in the Agent panel before anything is applied.'
    )
  }

  const submitLabel =
    mode === 'agent'
      ? 'Start agent task'
      : mode === 'research'
        ? 'Start research'
        : 'Ask AI'

  return (
    <div className="welcome welcome-redesign">
      <div className="welcome-inner">
        <p className="welcome-brand">KryomCode</p>
        <h1>What should we build or discover?</h1>
        <p className="welcome-tagline">
          Explore ideas, understand your code, research solutions, and turn
          plans into working software.
        </p>
        <p className="welcome-workspace muted">
          {hasWorkspace
            ? `Project ${baseName(props.workspaceRoot ?? '')} is open. Pick a file in the Explorer or start below.`
            : 'No project open. Open one to browse files, edit code, and run commands.'}
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
              mode === 'agent'
                ? 'Describe a coding task'
                : mode === 'research'
                  ? 'Describe a research objective'
                  : 'Ask Kryom AI'
            }
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                submitText(prompt)
              }
            }}
            placeholder={composerPlaceholder(mode, hasWorkspace)}
            rows={4}
            maxLength={maxLength}
          />
          <div className="composer-footer welcome-composer-footer">
            <span className="muted">
              {prompt.length}/{maxLength}
            </span>
            <button type="submit" disabled={prompt.trim() === ''}>
              {submitLabel}
            </button>
          </div>
        </form>

        {notice ? (
          <p className="welcome-notice" role="status">
            {notice}
          </p>
        ) : mode !== 'chat' && !hasWorkspace ? (
          <p className="welcome-notice" role="status">
            {mode === 'research' ? 'Research' : 'Agent tasks'} need an open
            project. Open one below to continue.
          </p>
        ) : null}

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

        {props.recent.length > 0 && (
          <div className="welcome-recent">
            <div className="welcome-recent-head">
              <span className="muted">Recent projects</span>
              <button
                type="button"
                className="mini-btn"
                onClick={props.onClearRecent}
              >
                Clear
              </button>
            </div>
            <ul>
              {props.recent.map((root) => (
                <li key={root}>
                  <button
                    type="button"
                    className="recent-row"
                    onClick={() => props.onOpenRecent(root)}
                    title={root}
                  >
                    <span className="recent-name">{baseName(root)}</span>
                    <span className="muted recent-path">{root}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

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
          <kbd>Ctrl</kbd> + <kbd>`</kbd> toggles the terminal panel
        </p>
      </div>
    </div>
  )
}
