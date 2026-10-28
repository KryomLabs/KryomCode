import { useCallback, useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { modelDisplayName } from '../utils/models'

export interface ConnectionsPanelProps {
  workspaceRoot: string | null
  defaultModel: string
  onStatus: (status: string) => void
  onOpenSourceControl: () => void
}

// Integration hub. Every entry reports verified state only: GitHub
// reflects the system-git repository at hand (never a claimed OAuth
// login), Meta AI reflects local key presence without revealing keys,
// and future providers are labelled Coming soon.
export function ConnectionsPanel(props: ConnectionsPanelProps) {
  const [git, setGit] = useState<KryomGitStatus | null>(null)
  const [gitError, setGitError] = useState('')
  const [aiStatus, setAiStatus] = useState<KryomAIStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setGitError('')

    try {
      setAiStatus(await kryom().getAIStatus())
    } catch {
      setAiStatus(null)
    }

    if (!props.workspaceRoot) {
      setGit(null)
      setGitError('')
      setLoading(false)
      return
    }

    try {
      setGit(await kryom().gitStatus())
    } catch (e) {
      setGit(null)
      setGitError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [props.workspaceRoot])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const inRepo = git !== null

  return (
    <section className="side-view" aria-label="Connections">
      <div className="side-header">
        <span className="side-title">CONNECTIONS</span>
        <button
          type="button"
          className="mini-btn"
          onClick={() => {
            void refresh()
            props.onStatus('Connections refreshed')
          }}
          disabled={loading}
        >
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <div className="connect-list">
        <article className="connect-card">
          <header className="connect-head">
            <span className="connect-name">GitHub</span>
            <span
              className={inRepo ? 'chip chip-ok' : 'chip'}
              title={
                inRepo
                  ? 'System git reports a repository here'
                  : 'No verified repository connection'
              }
            >
              {inRepo ? 'Repository found' : 'Not connected'}
            </span>
          </header>

          {inRepo ? (
            <dl className="connect-facts">
              <div>
                <dt>Branch</dt>
                <dd>{git.branch ?? 'detached HEAD'}</dd>
              </div>
              <div>
                <dt>Upstream</dt>
                <dd>{git.upstream ?? 'none configured'}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>{git.clean ? 'clean' : 'changes present'}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">
              {props.workspaceRoot
                ? (gitError || 'This project is not a Git repository.')
                : 'Open a project to inspect its Git repository.'}
            </p>
          )}

          <p className="muted">
            Repository actions run through your system Git installation
            and its own credentials. KryomCode stores no GitHub tokens.
          </p>

          <div className="connect-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={props.onOpenSourceControl}
              disabled={!props.workspaceRoot}
            >
              Open Source Control
            </button>
          </div>

          <p className="coming-soon">GitHub OAuth sign-in — Coming soon</p>
        </article>

        <article className="connect-card">
          <header className="connect-head">
            <span className="connect-name">Meta AI · Muse</span>
            <span
              className={
                aiStatus?.modelKeyConfigured ? 'chip chip-ok' : 'chip chip-warn'
              }
            >
              {aiStatus === null
                ? 'Unknown'
                : aiStatus.modelKeyConfigured
                  ? 'Key configured'
                  : 'Key missing'}
            </span>
          </header>

          <dl className="connect-facts">
            <div>
              <dt>Default model</dt>
              <dd>{modelDisplayName(props.defaultModel)}</dd>
            </div>
            <div>
              <dt>Research search</dt>
              <dd>
                {aiStatus === null
                  ? 'unknown'
                  : aiStatus.researchKeyConfigured
                    ? 'key configured'
                    : 'key missing (paper search limited)'}
              </dd>
            </div>
          </dl>

          <p className="muted">
            Keys live in your local <code>.env</code> file (
            <code>MODEL_API_KEY</code>, <code>TAVILY_API_KEY</code>) and
            are never displayed here. Restart KryomCode after editing
            it.
          </p>
        </article>

        <article className="connect-card">
          <header className="connect-head">
            <span className="connect-name">More integrations</span>
            <span className="chip">Coming soon</span>
          </header>
          <p className="muted">
            Additional providers plug in here without changing the rest
            of the workspace. Nothing listed yet.
          </p>
        </article>
      </div>
    </section>
  )
}
