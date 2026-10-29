import { useCallback, useEffect, useRef, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { MarkdownLite } from './MarkdownLite'

export interface ResearchPanelProps {
  workspaceRoot: string | null
  onStatus: (status: string) => void
  onImplement: (session: KryomResearchSession) => void
  onAsk: (session: KryomResearchSession) => void
  pendingStart?: { objective: string; nonce: number } | null
}

function stepIcon(status: KryomResearchStep['status']): string {
  switch (status) {
    case 'done':
      return '✓'
    case 'running':
      return '…'
    case 'failed':
      return '✕'
    case 'skipped':
      return '–'
    default:
      return '○'
  }
}

export function ResearchPanel(props: ResearchPanelProps) {
  const [objective, setObjective] = useState('')
  const [session, setSession] = useState<KryomResearchSession | null>(null)
  const [sessions, setSessions] = useState<KryomResearchSummary[]>([])
  const [starting, setStarting] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const [showBrief, setShowBrief] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportTemplate, setExportTemplate] = useState('report')
  const pollRef = useRef<number | null>(null)

  const refreshList = useCallback(async () => {
    if (!props.workspaceRoot) {
      setSessions([])
      return
    }

    try {
      setSessions(await kryom().listResearch())
    } catch {
      // List is auxiliary; the session view reports its own errors.
    }
  }, [props.workspaceRoot])

  const loadSession = useCallback(
    async (id: string) => {
      const loaded = await kryom().getResearchStatus({ id })
      setSession(loaded)
      return loaded
    },
    []
  )

  useEffect(() => {
    if (!props.workspaceRoot) {
      setSession(null)
      setSessions([])
      return
    }

    kryom()
      .getActiveResearch()
      .then((active) => {
        if (active) {
          setSession(active)
        }
      })
      .catch(() => undefined)
    void refreshList()
  }, [props.workspaceRoot, refreshList])

  useEffect(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }

    if (!session || session.status !== 'running') {
      return
    }

    pollRef.current = window.setInterval(() => {
      loadSession(session.id)
        .then((loaded) => {
          if (loaded.status !== 'running') {
            void refreshList()
            props.onStatus(`Research ${loaded.status}: ${loaded.statusDetail}`)
          }
        })
        .catch((e) => setError(errorMessage(e)))
    }, 2000)

    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [session?.id, session?.status, loadSession, refreshList, props])

  async function exportBrief(id: string) {
    if (exporting) {
      return
    }

    setExporting(true)
    setError('')

    try {
      const result = await kryom().exportBriefDocx({
        sessionId: id,
        template: exportTemplate,
      })

      if (!result) {
        props.onStatus('Brief export cancelled')
        return
      }

      props.onStatus(`Brief exported (${Math.round(result.bytes / 1024)} KB)`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  async function start(externalObjective?: string) {
    const trimmed = (externalObjective ?? objective).trim()

    if (!trimmed || starting || !props.workspaceRoot) {
      return
    }

    setStarting(true)
    setError('')
    setShowBrief(false)

    try {
      const started = await kryom().startResearch({ objective: trimmed })
      setObjective('')
      await loadSession(started.id)
      await refreshList()
      props.onStatus('Research started')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setStarting(false)
    }
  }

  // Welcome-composer starts arrive with a fresh nonce per submission.
  const consumedStartNonce = useRef<number | null>(null)

  useEffect(() => {
    const pending = props.pendingStart

    if (
      !pending ||
      consumedStartNonce.current === pending.nonce ||
      !props.workspaceRoot
    ) {
      return
    }

    consumedStartNonce.current = pending.nonce
    void start(pending.objective)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingStart, props.workspaceRoot])

  async function cancel() {
    if (!session || working) {
      return
    }

    setWorking(true)
    setError('')

    try {
      const updated = await kryom().cancelResearch({ id: session.id })
      setSession(updated)
      await refreshList()
      props.onStatus('Research cancelled')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setWorking(false)
    }
  }

  async function resume() {
    if (!session || working) {
      return
    }

    setWorking(true)
    setError('')

    try {
      await kryom().resumeResearch({ id: session.id })
      await loadSession(session.id)
      props.onStatus('Research resumed')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setWorking(false)
    }
  }

  async function select(id: string) {
    if (working || session?.id === id) {
      return
    }

    setWorking(true)
    setError('')
    setShowBrief(false)

    try {
      await kryom().selectResearch({ id })
      await loadSession(id)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setWorking(false)
    }
  }

  async function copyText(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(index)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setError('Copy is unavailable in this context.')
    }
  }

  function isOpenableUrl(url: string): boolean {
    return /^https?:\/\//i.test(url.trim())
  }

  async function openSource(url: string) {
    setError('')

    try {
      await kryom().openExternal(url)
      props.onStatus('Source opened in browser')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const running = session?.status === 'running'
  const resumable =
    session !== null &&
    ['cancelled', 'failed', 'blocked'].includes(session.status)

  return (
    <section className="agent-panel">
      <div className="ai-heading">
        <div>
          <strong>Research</strong>
          <div className="muted">Real paper + web search · cited briefs</div>
        </div>
        {session && (
          <span className="muted">
            {session.status.toUpperCase()} · {session.sources.length} source(s)
          </span>
        )}
      </div>

      {!props.workspaceRoot ? (
        <p className="muted padded">Open a project to run research.</p>
      ) : (
        <>
          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault()
              void start()
            }}
          >
            <textarea
              aria-label="Research objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="e.g. Compare path-planning algorithms for warehouse robots…"
              rows={3}
              maxLength={2000}
              disabled={starting || running}
            />
            <div className="composer-footer">
              <span className="muted">{objective.length}/2000</span>
              <button
                type="submit"
                disabled={starting || running || !objective.trim()}
              >
                {starting ? 'Starting…' : running ? 'Research running…' : 'Start research'}
              </button>
            </div>
          </form>

          {error && (
            <div className="ai-error" role="alert">
              <strong>Research request failed</strong>
              <p>{error}</p>
              <button onClick={() => setError('')} className="secondary-button">
                Dismiss
              </button>
            </div>
          )}

          {sessions.length > 0 && (
            <details className="sessions-disclosure">
              <summary>
                Recent sessions ({sessions.length > 6 ? '6+' : sessions.length})
              </summary>
              <div className="plan-commands">
                {sessions.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="command-row">
                    <code>
                      {entry.status} · {entry.sources} src ·{' '}
                      {entry.objective.slice(0, 80)}
                    </code>
                    <button
                      className="secondary-button"
                      onClick={() => void select(entry.id)}
                      disabled={working || session?.id === entry.id}
                    >
                      {session?.id === entry.id ? 'Current' : 'Open'}
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}

          {session && (
            <div className="plan-view">
              <p className="muted padded">
                {session.objective} · {session.statusDetail}
              </p>

              <div className="composer-footer padded">
                <span className="muted">
                  {running
                    ? 'Running — progress below reflects completed work only.'
                    : `Ended: ${session.status}.`}
                </span>
                <span>
                  {running && (
                    <button
                      className="secondary-button"
                      onClick={() => void cancel()}
                      disabled={working}
                    >
                      {working ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                  {resumable && (
                    <button
                      className="secondary-button"
                      onClick={() => void resume()}
                      disabled={working}
                    >
                      {working ? 'Resuming…' : 'Retry / resume'}
                    </button>
                  )}
                </span>
              </div>

              <div className="plan-commands">
                <strong>Progress</strong>
                {session.steps.map((step) => (
                  <div key={step.id} className="command-row">
                    <code>
                      [{stepIcon(step.status)}] {step.label}
                      {step.detail ? ` — ${step.detail}` : ''}
                      {step.error ? ` — ERROR: ${step.error}` : ''}
                    </code>
                  </div>
                ))}
              </div>

              {session.errors.length > 0 && (
                <div className="plan-commands">
                  <strong>Errors ({session.errors.length})</strong>
                  {session.errors.slice(0, 8).map((entry, index) => (
                    <div key={index} className="command-row">
                      <code>
                        {entry.where}: {entry.message}
                      </code>
                    </div>
                  ))}
                </div>
              )}

              <div className="plan-commands">
                <strong>
                  Sources ({session.sources.length})
                </strong>
                {session.sources.length === 0 ? (
                  <p className="muted">No sources yet.</p>
                ) : (
                  session.sources.map((source, index) => (
                    <div key={`${source.url}-${index}`} className="command-row">
                      <code>
                        [{index + 1}] {source.title} [{source.sourceType}] (
                        {source.accessStatus}) — {source.url}
                      </code>
                      <span className="source-actions">
                        {isOpenableUrl(source.url) && (
                          <button
                            className="secondary-button"
                            onClick={() => void openSource(source.url)}
                            title="Open in your browser"
                          >
                            Open
                          </button>
                        )}
                        <button
                          className="secondary-button"
                          onClick={() => void copyText(source.url, index)}
                        >
                          {copied === index ? 'Copied' : 'Copy'}
                        </button>
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="plan-commands">
                <strong>Findings ({session.findings.length})</strong>
                {session.findings.length === 0 ? (
                  <p className="muted">
                    {running
                      ? 'Findings appear here once synthesis completes.'
                      : 'No findings were recorded for this session.'}
                  </p>
                ) : (
                  session.findings.map((finding, index) => {
                    // Backend citations are 1-based: sources[n - 1].
                    // Non-numeric or out-of-range entries render as
                    // unavailable instead of resolving wrongly.
                    const cited = finding.sourceIndexes
                      .map((sourceIndex) => {
                        const source =
                          typeof sourceIndex === 'number' &&
                          Number.isInteger(sourceIndex)
                            ? session.sources[sourceIndex - 1]
                            : undefined

                        return source
                          ? `[${sourceIndex}] ${source.title}`
                          : null
                      })
                      .filter((entry): entry is string => entry !== null)
                    const missing = finding.sourceIndexes.length - cited.length

                    return (
                      <div key={index} className="command-row finding-row">
                        <div className="finding-body">
                          <span>{finding.claim}</span>
                          <span className="muted">
                            Confidence: {finding.confidence}
                            {finding.note ? ` · ${finding.note}` : ''}
                          </span>
                          <span className="muted">
                            {cited.length > 0
                              ? cited.join(' · ')
                              : 'No sources cited'}
                            {missing > 0
                              ? ` · ${missing} reference(s) unavailable`
                              : ''}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {session.evidence.length > 0 && (
                <div className="plan-commands">
                  <strong>Evidence ({session.evidence.length})</strong>
                  {session.evidence.slice(0, 12).map((entry, index) => (
                    <div key={index} className="command-row finding-row">
                      <div className="finding-body">
                        <span className="muted">{entry.sourceUrl}</span>
                        <span>{entry.excerpt.slice(0, 400)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {session.implementationTasks.length > 0 && (
                <div className="plan-commands">
                  <strong>
                    Implementation tasks ({session.implementationTasks.length})
                  </strong>
                  {session.implementationTasks.map((task, index) => (
                    <div key={index} className="command-row">
                      <code>
                        {index + 1}. {task}
                      </code>
                    </div>
                  ))}
                </div>
              )}

              {session.verification.length > 0 && (
                <div className="plan-commands">
                  <strong>Verification ({session.verification.length})</strong>
                  {session.verification.map((check, index) => (
                    <div key={index} className="command-row">
                      <code>
                        {index + 1}. {check}
                      </code>
                    </div>
                  ))}
                </div>
              )}

              {session.decisions.length > 0 && (
                <div className="plan-commands">
                  <strong>Decisions ({session.decisions.length})</strong>
                  {session.decisions.map((decision, index) => (
                    <div key={index} className="command-row">
                      <code>{decision.text}</code>
                    </div>
                  ))}
                </div>
              )}

              {session.brief.version > 0 && (
                <div className="plan-commands">
                  <strong>
                    Research Brief v{session.brief.version} ({session.brief.via})
                  </strong>
                  <div className="composer-footer">
                    <span className="muted">
                      {session.brief.generatedAt
                        ? `Generated ${session.brief.generatedAt.slice(0, 10)}`
                        : ''}
                    </span>
                    <button
                      className="secondary-button"
                      onClick={() => setShowBrief((open) => !open)}
                    >
                      {showBrief ? 'Hide brief' : 'Show brief'}
                    </button>
                  </div>
                  <div className="composer-footer">
                    <select
                      value={exportTemplate}
                      onChange={(event) => setExportTemplate(event.target.value)}
                      aria-label="Brief export template"
                      disabled={exporting}
                    >
                      <option value="report">Report template</option>
                      <option value="technical">Technical template</option>
                    </select>
                    <button
                      className="secondary-button"
                      disabled={exporting}
                      onClick={() => void exportBrief(session.id)}
                      title="Export this brief with its cited sources to a .docx file"
                    >
                      {exporting ? 'Exporting…' : 'Export .docx'}
                    </button>
                  </div>
                  {showBrief && (
                    <div className="brief-body">
                      <MarkdownLite
                        text={session.brief.markdown.slice(0, 12000)}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="composer-footer padded">
                <span className="muted">
                  {session.brief.version > 0
                    ? 'Brief ready for chat and implementation.'
                    : 'Brief appears here once synthesis completes.'}
                </span>
                <span>
                  <button
                    className="secondary-button"
                    onClick={() => props.onAsk(session)}
                  >
                    Ask about this
                  </button>{' '}
                  <button
                    className="primary-button"
                    onClick={() => props.onImplement(session)}
                    disabled={session.brief.version === 0}
                    title={
                      session.brief.version === 0
                        ? 'Available once the brief is ready'
                        : 'Plan implementation from this brief'
                    }
                  >
                    Implement from Research
                  </button>
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
