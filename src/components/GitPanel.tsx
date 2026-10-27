import { useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { useDialogs } from './dialogs'

export interface GitPanelProps {
  workspaceRoot: string | null
  onStatus: (status: string) => void
}

interface DiffView {
  title: string
  diff: string
  truncated: boolean
}

export function GitPanel(props: GitPanelProps) {
  const dialogs = useDialogs()
  const [status, setStatus] = useState<KryomGitStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [diff, setDiff] = useState<DiffView | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [showStaged, setShowStaged] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [operating, setOperating] = useState<string | null>(null)

  async function loadStatus() {
    if (!props.workspaceRoot) {
      setStatus(null)
      return
    }

    setLoading(true)
    setError('')

    try {
      setStatus(await kryom().gitStatus())
    } catch (e) {
      setStatus(null)
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setDiff(null)
    setSelected(new Set())
    setCommitMessage('')

    if (props.workspaceRoot) {
      void loadStatus()
    } else {
      setStatus(null)
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.workspaceRoot])

  function toggleSelected(file: string) {
    setSelected((previous) => {
      const next = new Set(previous)

      if (next.has(file)) {
        next.delete(file)
      } else {
        next.add(file)
      }

      return next
    })
  }

  async function loadDiff(title: string, staged: boolean, path?: string) {
    setDiffLoading(true)
    setError('')

    try {
      const result = await kryom().gitDiff({ staged, path })
      setDiff({ title, diff: result.diff, truncated: result.truncated })
    } catch (e) {
      setDiff(null)
      setError(errorMessage(e))
    } finally {
      setDiffLoading(false)
    }
  }

  const pathBase = status?.toplevel || props.workspaceRoot || ''

  async function stageSelected() {
    if (selected.size === 0 || operating) {
      return
    }

    setOperating('stage')
    setError('')

    try {
      if (!pathBase) {
        return
      }

      const absolute = [...selected].map((file) => `${pathBase}/${file}`)
      await kryom().gitStage(absolute)
      setSelected(new Set())
      await loadStatus()
      props.onStatus('Git changes staged')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setOperating(null)
    }
  }

  async function commit() {
    const message = commitMessage.trim()

    if (!message || operating) {
      return
    }

    const confirmed = await dialogs.confirm({
      title: 'Create commit?',
      message: `This creates a commit with message: "${message.slice(0, 120)}"`,
      confirmLabel: 'Commit',
    })

    if (!confirmed) {
      return
    }

    setOperating('commit')
    setError('')

    try {
      await kryom().gitCommit({ message })
      setCommitMessage('')
      await loadStatus()
      props.onStatus('Git commit created')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setOperating(null)
    }
  }

  async function push() {
    if (operating) {
      return
    }

    const confirmed = await dialogs.confirm({
      title: 'Push to remote?',
      message:
        'This pushes the current branch to its remote. ' +
        'KryomCode never handles your credentials; git uses your ambient login.',
      confirmLabel: 'Push',
    })

    if (!confirmed) {
      return
    }

    setOperating('push')
    setError('')

    try {
      const result = await kryom().gitPush({})
      await loadStatus()
      props.onStatus(`Pushed ${result.branch} to ${result.remote}`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setOperating(null)
    }
  }

  const busy = loading || operating !== null || diffLoading

  return (
    <section className="git-panel bottom-tab-panel">
      {!props.workspaceRoot ? (
        <p className="muted padded">Open a project to use Git.</p>
      ) : (
        <>
          <div className="git-toolbar">
            <button onClick={() => void loadStatus()} disabled={busy}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>

            <button
              onClick={() => void loadDiff('Full diff (unstaged)', false)}
              disabled={busy || !status || status.clean}
            >
              View full diff
            </button>

            <label className="staged-toggle">
              <input
                type="checkbox"
                checked={showStaged}
                onChange={(event) => setShowStaged(event.target.checked)}
              />
              Show staged diffs
            </label>

            {status && (
              <span className="muted">
                {status.branch ?? '(no branch)'}
                {status.upstream ? ` → ${status.upstream}` : ''}
                {status.clean ? ' · clean' : ' · changes'}
              </span>
            )}
          </div>

          {error && <p className="inline-error padded">{error}</p>}

          {status && (
            <div className="git-columns">
              <div className="git-list">
                <strong>Staged ({status.staged.length})</strong>
                {status.staged.length === 0 && (
                  <p className="muted">Nothing staged.</p>
                )}
                {status.staged.map((file) => (
                  <button
                    key={`s-${file}`}
                    className="git-file"
                    onClick={() => void loadDiff(file, true, `${pathBase}/${file}`)}
                    title="View staged diff"
                  >
                    {file}
                  </button>
                ))}
              </div>

              <div className="git-list">
                <strong>
                  Unstaged ({status.unstaged.length}) · Untracked (
                  {status.untracked.length})
                </strong>
                {status.unstaged.length === 0 &&
                  status.untracked.length === 0 && <p className="muted">Clean.</p>}
                {[...status.unstaged, ...status.untracked].map((file) => (
                  <label key={`u-${file}`} className="git-file-check">
                    <input
                      type="checkbox"
                      checked={selected.has(file)}
                      onChange={() => toggleSelected(file)}
                      aria-label={`Select ${file}`}
                    />
                    <button
                      type="button"
                      className="git-file link-button"
                      onClick={() => void loadDiff(file, showStaged, `${pathBase}/${file}`)}
                      title="View diff"
                    >
                      {file}
                    </button>
                  </label>
                ))}

                <div className="git-actions">
                  <button
                    onClick={() => void stageSelected()}
                    disabled={selected.size === 0 || busy}
                  >
                    Stage selected ({selected.size})
                  </button>
                </div>
              </div>

              <div className="git-list">
                <strong>Commit</strong>
                <textarea
                  aria-label="Commit message"
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Commit message…"
                  rows={3}
                  maxLength={2000}
                />
                <div className="git-actions">
                  <button
                    onClick={() => void commit()}
                    disabled={!commitMessage.trim() || busy}
                  >
                    {operating === 'commit' ? 'Committing…' : 'Commit staged'}
                  </button>
                  <button onClick={() => void push()} disabled={busy}>
                    {operating === 'push' ? 'Pushing…' : 'Push'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {diffLoading && <p className="muted padded">Loading diff…</p>}

          {diff && (
            <div className="git-diff">
              <strong>{diff.title}</strong>
              {diff.truncated && (
                <p className="muted">Diff truncated for display.</p>
              )}
              <pre className="terminal-output">
                {diff.diff || '(No differences.)'}
              </pre>
            </div>
          )}
        </>
      )}
    </section>
  )
}
