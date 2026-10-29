import { useEffect, useRef, useState } from 'react'
import { kryom, errorMessage, isCancelError } from '../api/kryom'
import { diffLines } from '../utils/diff'
import { baseName } from '../utils/paths'
import { useDialogs } from './dialogs'
import { AiKeyNotice } from './AiKeyNotice'

export interface AgentPanelProps {
  workspaceRoot: string | null
  defaultModel: string
  defaultIncludeContext: boolean
  activeFile: string | null
  activeFileDirty: boolean
  onFilesChanged: (changedPaths: string[]) => void
  onStatus: (status: string) => void
  pendingTask?: { text: string; nonce: number; researchSessionId?: string } | null
  onOpenConnections?: () => void
  onOpenFile?: (path: string) => void
}

const MODELS = ['muse-spark-1.3', 'muse-wonder-1.0'] as const

const MAX_REPAIR_ATTEMPTS = 2
const MAX_FILE_RESULTS = 8
const MAX_SCRIPTS = 8
const MAX_FAILURE_CHARS = 4000
const MAX_OUTPUT_CHARS = 8000

type AgentStatus =
  | 'idle'
  | 'inspecting'
  | 'gathering'
  | 'planning'
  | 'review'
  | 'applying'
  | 'verifyApproval'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: '',
  inspecting: 'Inspecting project…',
  gathering: 'Gathering source context…',
  planning: 'Planning…',
  review: 'Awaiting review',
  applying: 'Applying changes…',
  verifyApproval: 'Awaiting verification approval',
  verifying: 'Verifying…',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  return `${(bytes / 1024).toFixed(1)} KB`
}

function isStaleError(error: unknown): boolean {
  return error instanceof Error && /changed since the plan/i.test(error.message)
}

function EditDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const { lines, truncated } = diffLines(oldText, newText)
  const shown = lines.slice(0, 300)

  return (
    <div className="diff-view">
      {shown.map((line, index) => (
        <div key={index} className={`diff-line diff-${line.type}`}>
          <span className="diff-gutter">
            {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
          </span>
          <span className="diff-text">{line.text || ' '}</span>
        </div>
      ))}
      {(truncated || lines.length > shown.length) && (
        <div className="muted padded">Diff truncated for display.</div>
      )}
    </div>
  )
}

export function AgentPanel(props: AgentPanelProps) {
  const dialogs = useDialogs()
  const [model, setModel] = useState(props.defaultModel)
  const [task, setTask] = useState('')
  const [researchSessionId, setResearchSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [plan, setPlan] = useState<KryomAgentPlan | null>(null)
  const [approved, setApproved] = useState<Set<number>>(new Set())
  const [oldContents, setOldContents] = useState<Record<number, string>>({})
  const [planning, setPlanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<KryomAgentApplyResult | null>(null)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState('')
  const [keyMissing, setKeyMissing] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [copied, setCopied] = useState<number | null>(null)

  // Source context selection. Only explicitly chosen files are read,
  // in the main process, after validation.
  const [includeActive, setIncludeActive] = useState(props.defaultIncludeContext)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [fileQuery, setFileQuery] = useState('')
  const [fileResults, setFileResults] = useState<KryomSearchMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [contextPreview, setContextPreview] =
    useState<KryomAgentContextPreview | null>(null)
  const [contextOpen, setContextOpen] = useState(true)

  // Verification handoff. Nothing runs without an explicit click.
  const [verifyOptions, setVerifyOptions] = useState<string[]>([])
  const [verifyCommand, setVerifyCommand] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] =
    useState<KryomDiagnosticsResult | null>(null)
  const [verifyError, setVerifyError] = useState('')
  const [repairAttempt, setRepairAttempt] = useState(0)

  useEffect(() => {
    setModel(props.defaultModel)
  }, [props.defaultModel])

  useEffect(() => {
    setIncludeActive(props.defaultIncludeContext)
  }, [props.defaultIncludeContext])

  const consumedTaskNonce = useRef<number | null>(null)

  useEffect(() => {
    const pending = props.pendingTask

    if (!pending || pending.text.trim() === '') {
      return
    }

    if (consumedTaskNonce.current === pending.nonce) {
      return
    }

    consumedTaskNonce.current = pending.nonce
    setTask(pending.text)
    setResearchSessionId(pending.researchSessionId ?? null)

    if (!props.workspaceRoot || planning) {
      return
    }

    void requestPlanFor(pending.text, pending.researchSessionId ?? null)
    // Consumes one welcome submit per nonce; planning/model come from
    // this render's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingTask, props.workspaceRoot])

  function effectiveContextPaths(): string[] {
    const paths =
      includeActive && props.activeFile
        ? [props.activeFile, ...selectedFiles]
        : [...selectedFiles]

    return [...new Set(paths)]
  }

  async function searchProjectFiles(event?: React.FormEvent) {
    event?.preventDefault()

    const query = fileQuery.trim()

    if (!query || searching) {
      return
    }

    setSearching(true)
    setSearchError('')

    try {
      const result = await kryom().searchFiles({ query, mode: 'name' })
      const chosen = new Set(effectiveContextPaths())

      setFileResults(
        result.matches
          .filter((match) => !chosen.has(match.path))
          .slice(0, MAX_FILE_RESULTS)
      )
    } catch (e) {
      setSearchError(errorMessage(e))
    } finally {
      setSearching(false)
    }
  }

  function addSelectedFile(path: string) {
    setSelectedFiles((previous) =>
      previous.includes(path) ? previous : [...previous, path]
    )
    setFileResults((previous) =>
      previous.filter((match) => match.path !== path)
    )
  }

  function removeSelectedFile(path: string) {
    setSelectedFiles((previous) =>
      previous.filter((entry) => entry !== path)
    )
  }

  function clearRound() {
    setPlan(null)
    setApproved(new Set())
    setApplyResult(null)
    setStale(false)
    setOldContents({})
    setExpanded(new Set())
    setContextPreview(null)
    setVerifyOptions([])
    setVerifyCommand('')
    setVerifyResult(null)
    setVerifyError('')
  }

  async function requestPlan() {
    await requestPlanFor(task, researchSessionId)
  }

  async function requestPlanFor(taskText: string, researchId: string | null) {
    const trimmed = taskText.trim()

    if (!trimmed || planning || !props.workspaceRoot) {
      return
    }

    setStatus('inspecting')

    try {
      const aiStatus = await kryom().getAIStatus()

      if (!aiStatus.modelKeyConfigured) {
        setKeyMissing(true)
        setStatus('idle')
        props.onStatus('AI model is not configured')
        return
      }
    } catch {
      // Fall through to the planning path.
    }

    setPlanning(true)
    setError('')
    setKeyMissing(false)
    clearRound()

    const contextPaths = effectiveContextPaths()

    try {
      // Gather first so the user sees exactly which files would
      // reach the model before anything is transmitted.
      if (contextPaths.length > 0) {
        setStatus('gathering')

        const preview = await kryom().getAgentContext({
          paths: contextPaths,
        })

        setContextPreview(preview)
      }

      setStatus('planning')

      const next = await kryom().planAgentTask({
        task: trimmed,
        model,
        ...(contextPaths.length > 0 ? { contextPaths } : {}),
        ...(researchId ? { researchSessionId: researchId } : {}),
      })
      setPlan(next)
      setApproved(new Set(next.edits.map((edit) => edit.index ?? 0)))
      setStatus('review')
      props.onStatus(
        `Agent plan ready: ${next.edits.length} edit(s), ${next.commands.length} command(s)`
      )

      const loaded: Record<number, string> = {}

      for (const edit of next.edits) {
        if (edit.action !== 'modify') {
          continue
        }

        try {
          const meta = await kryom().readFileMeta(edit.path)
          loaded[edit.index ?? 0] = meta.content
        } catch {
          // Preview falls back to new content only; apply still validates.
        }
      }

      setOldContents(loaded)
    } catch (e) {
      if (isCancelError(e)) {
        setStatus('cancelled')
        props.onStatus('Planning cancelled')
      } else {
        setStatus('failed')
        setError(errorMessage(e))
      }
    } finally {
      setPlanning(false)
    }
  }

  function stopPlanning() {
    kryom().cancelAgentPlan().catch(() => undefined)
  }

  function toggleApproval(index: number) {
    setApproved((previous) => {
      const next = new Set(previous)

      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }

      return next
    })
  }

  function toggleExpanded(index: number) {
    setExpanded((previous) => {
      const next = new Set(previous)

      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }

      return next
    })
  }

  async function applyApproved() {
    if (!plan || applying || approved.size === 0) {
      return
    }

    const confirmed = await dialogs.confirm({
      title: 'Apply agent edits?',
      message:
        `This writes ${approved.size} approved file change(s) to your ` +
        `project. The batch rolls back automatically if any edit fails.`,
      confirmLabel: 'Apply changes',
    })

    if (!confirmed) {
      return
    }

    setApplying(true)
    setError('')
    setStale(false)
    setStatus('applying')

    try {
      const edits = plan.edits.filter((edit) => approved.has(edit.index ?? 0))
      const result = await kryom().applyAgentEdits({ edits })
      setApplyResult(result)
      props.onFilesChanged(result.applied.map((entry) => entry.path))

      if (result.completed) {
        setStatus('verifyApproval')
        props.onStatus(`Agent applied ${result.applied.length} edit(s)`)
        await loadVerifyOptions(plan)
      } else if (result.failed) {
        setStatus('failed')

        if (/changed since the plan/i.test(result.failed.message)) {
          setStale(true)
          props.onStatus('Agent plan is stale; request a fresh plan')
        } else {
          props.onStatus('Agent apply failed and rolled back')
        }
      }
    } catch (e) {
      setStatus('failed')

      if (isStaleError(e)) {
        setStale(true)
      }

      setError(errorMessage(e))
    } finally {
      setApplying(false)
    }
  }

  async function loadVerifyOptions(current: KryomAgentPlan) {
    const options = [...new Set(current.commands)]

    try {
      const summary = await kryom().getWorkspaceSummary()
      const scripts = Object.keys(summary.scripts)
        .slice(0, MAX_SCRIPTS)
        .map((name) => `npm run ${name}`)

      for (const script of scripts) {
        if (!options.includes(script)) {
          options.push(script)
        }
      }
    } catch {
      // Script suggestions are a convenience; plan commands and a
      // custom command still work without them.
    }

    setVerifyOptions(options)
    setVerifyCommand(options[0] ?? '')
  }

  async function runVerification() {
    const command = verifyCommand.trim()

    if (!command || verifying || !props.workspaceRoot) {
      return
    }

    const confirmed = await dialogs.confirm({
      title: 'Run project check?',
      message:
        `This executes exactly:\n${command}\n\n` +
        `Working directory:\n${props.workspaceRoot}`,
      confirmLabel: 'Run check',
    })

    if (!confirmed) {
      return
    }

    setVerifying(true)
    setVerifyError('')
    setVerifyResult(null)
    setStatus('verifying')
    props.onStatus('Verification running…')

    try {
      const result = await kryom().runDiagnostics({ command })

      setVerifyResult(result)

      if (result.success) {
        setStatus('succeeded')
        props.onStatus(`Check passed (exit ${result.exitCode})`)
      } else {
        setStatus('failed')
        props.onStatus(
          result.timedOut
            ? 'Check timed out'
            : `Check failed (exit ${result.exitCode})`
        )
      }
    } catch (e) {
      setStatus('failed')
      setVerifyError(errorMessage(e))
    } finally {
      setVerifying(false)
    }
  }

  function requestFix() {
    if (!plan || !verifyResult || repairAttempt >= MAX_REPAIR_ATTEMPTS) {
      return
    }

    const followUp = [
      'The previous change failed verification. Analyze the failure and propose a fix.',
      `Original task: ${plan.task}`,
      `Failed command: ${verifyCommand.trim()}`,
      `Exit code: ${verifyResult.exitCode}${verifyResult.timedOut ? ' (timed out)' : ''}`,
      'Command output (truncated):',
      verifyResult.output.slice(0, MAX_FAILURE_CHARS),
    ].join('\n')

    setRepairAttempt((previous) => previous + 1)
    setTask(followUp)
    void requestPlanFor(followUp, researchSessionId)
  }

  function reset() {
    setPlan(null)
    setApproved(new Set())
    setApplyResult(null)
    setStale(false)
    setError('')
    setOldContents({})
    setExpanded(new Set())
    setResearchSessionId(null)
    setContextPreview(null)
    setVerifyOptions([])
    setVerifyCommand('')
    setVerifyResult(null)
    setVerifyError('')
    setRepairAttempt(0)
    setStatus('idle')
  }

  async function copyCommand(command: string, index: number) {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(index)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setError('Copy is unavailable in this context.')
    }
  }

  const busy = planning || applying || verifying
  const contextCount =
    (includeActive && props.activeFile ? 1 : 0) + selectedFiles.length

  return (
    <section className="agent-panel agent-docked">
      <div className="ai-heading">
        <div>
          <strong>Coding agent</strong>
          <div className="muted">Plans only · you approve every change</div>
        </div>
        {plan && (
          <button onClick={reset} disabled={busy}>
            New task
          </button>
        )}
      </div>

      {status !== 'idle' && (
        <p className="muted padded" role="status">
          Status: {STATUS_LABELS[status]}
          {status === 'review' && repairAttempt > 0
            ? ` (repair attempt ${repairAttempt} of ${MAX_REPAIR_ATTEMPTS})`
            : ''}
        </p>
      )}

      {!props.workspaceRoot ? (
        <p className="muted padded">Open a project to plan coding tasks.</p>
      ) : (
        <>
          <div className="agent-toolbar">
            <label className="agent-model">
              Model
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={busy}
                aria-label="Agent model"
              >
                {MODELS.map((id) => (
                  <option key={id} value={id}>
                    {id === 'muse-spark-1.3' ? 'Muse Spark 1.3' : 'Muse Wonder 1.0'}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              aria-expanded={contextOpen}
              onClick={() => setContextOpen((open) => !open)}
              title="Show or hide the project context picker"
            >
              {contextOpen ? '▾' : '▸'} Context · {contextCount} selected
            </button>
          </div>

          <div className="agent-scroll">
            {contextOpen && (
              <div className="agent-context">
          <label
            className="context-toggle"
            title="Reads the active file in the main process and sends its contents with the task"
          >
            <input
              type="checkbox"
              checked={includeActive}
              onChange={(event) => setIncludeActive(event.target.checked)}
              disabled={busy || !props.activeFile}
            />
            Include active file
          </label>

          <div className="context-file">
            {props.activeFile
              ? `Active: ${baseName(props.activeFile)}`
              : 'No active file.'}
            {includeActive && props.activeFile && props.activeFileDirty
              ? ' Unsaved edits are NOT included — save first to ground on them.'
              : ''}
          </div>

          <form
            className="agent-composer"
            onSubmit={(event) => void searchProjectFiles(event)}
          >
            <input
              aria-label="Find project files to include"
              value={fileQuery}
              onChange={(event) => setFileQuery(event.target.value)}
              placeholder="Find project files to include, e.g. login…"
              maxLength={200}
              disabled={busy}
            />
            <div className="composer-footer">
              <span className="muted">{contextCount} file(s) selected</span>
              <button type="submit" disabled={busy || !fileQuery.trim()}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>
          </form>

          {searchError && (
            <p className="muted padded" role="alert">
              Search failed: {searchError}
            </p>
          )}

          {fileResults.length > 0 && (
            <div className="plan-commands">
              <strong>Matching files</strong>
              {fileResults.map((match) => (
                <div key={match.path} className="command-row">
                  <code title={match.path}>{match.relativePath}</code>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => addSelectedFile(match.path)}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="plan-commands">
              <strong>Selected files</strong>
              {selectedFiles.map((file) => (
                <div key={file} className="command-row">
                  <code title={file}>{baseName(file)}</code>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => removeSelectedFile(file)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

              </div>
            )}

          {error && (
            <div className="ai-error" role="alert">
              <strong>Agent request failed</strong>
              <p>{error}</p>
              <button onClick={() => setError('')} className="secondary-button">
                Dismiss
              </button>
            </div>
          )}

          {keyMissing && !planning && (
            <AiKeyNotice onOpenConnections={props.onOpenConnections} />
          )}

          {researchSessionId && !plan && (
            <p className="muted padded">
              Research brief attached: {researchSessionId}
            </p>
          )}

          {contextPreview && !plan && (
            <div className="context-file">
              <p>
                Model context: {contextPreview.files.length} file(s),{' '}
                {formatBytes(contextPreview.totalBytes)}
                {contextPreview.files.length > 0
                  ? `: ${contextPreview.files
                      .map((file) => file.relativePath)
                      .join(', ')}`
                  : ''}
              </p>
              {contextPreview.excluded.map((entry) => (
                <p key={entry.path} className="muted">
                  Excluded {baseName(entry.path)}: {entry.reason}
                </p>
              ))}
            </div>
          )}

          {plan && (
            <div className="plan-view">
              <p className="plan-task">
                <span className="muted">Task: </span>
                {plan.task}
              </p>
              <p className="muted padded">
                Model: {plan.model} · {plan.edits.length} proposed edit(s)
                {plan.researchSessionId
                  ? ` · research ${plan.researchSessionId}`
                  : ''}
              </p>

              <p className="muted padded">
                Grounded in {plan.contextFiles.length} file(s)
                {plan.contextFiles.length > 0
                  ? `: ${plan.contextFiles
                      .map((file) => file.relativePath)
                      .join(', ')}`
                  : ' (project summary only)'}
                {plan.contextExcluded.length > 0
                  ? ` · ${plan.contextExcluded.length} excluded`
                  : ''}
              </p>

              {plan.notes && <p className="plan-notes">{plan.notes}</p>}

              {plan.edits.length === 0 && (
                <p className="muted padded">The plan proposes no file edits.</p>
              )}

              {plan.edits.map((edit) => {
                const key = edit.index ?? 0
                const checked = approved.has(key)
                const fullPreview = edit.preview ?? edit.content ?? ''
                const showAll = expanded.has(key)

                return (
                  <div key={key} className="plan-edit">
                    <label className="plan-edit-head">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleApproval(key)}
                        disabled={applying}
                        aria-label={`Approve ${edit.action} ${edit.path}`}
                      />
                      <span className={`action-badge action-${edit.action}`}>
                        {edit.action.toUpperCase()}
                      </span>
                      <span className="plan-path" title={edit.path}>
                        {baseName(edit.path)}
                      </span>
                      {edit.originalDigest && (
                        <span
                          className="muted"
                          title="Snapshot of the original file; apply rejects stale plans"
                        >
                          @{edit.originalDigest.slice(0, 8)}
                        </span>
                      )}
                      {edit.action !== 'create' && props.onOpenFile && (
                        <button
                          type="button"
                          className="mini-btn"
                          title="Open the current file in the editor"
                          onClick={(event) => {
                            // The head is a label: stop the click from
                            // toggling approval.
                            event.preventDefault()
                            event.stopPropagation()
                            props.onOpenFile?.(edit.path)
                          }}
                        >
                          Open
                        </button>
                      )}
                    </label>

                    {edit.reason && (
                      <p className="plan-notes">Why: {edit.reason}</p>
                    )}

                    {edit.action === 'delete' ? (
                      <p className="delete-warning">
                        This file will be deleted if you approve this edit.
                      </p>
                    ) : edit.action === 'modify' && oldContents[key] !== undefined ? (
                      <EditDiff
                        oldText={oldContents[key]}
                        newText={edit.content ?? ''}
                      />
                    ) : (
                      <>
                        <pre className="plan-preview">
                          {showAll
                            ? fullPreview.slice(0, 20000)
                            : fullPreview.slice(0, 2000)}
                        </pre>
                        {fullPreview.length > 2000 && (
                          <button
                            type="button"
                            className="mini-btn"
                            onClick={() => toggleExpanded(key)}
                          >
                            {showAll
                              ? 'Show less'
                              : `Show full preview (${fullPreview.length} chars)`}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              })}

              <div className="plan-commands">
                <strong>Proposed commands (never executed automatically)</strong>

                {plan.commands.length === 0 ? (
                  <p className="muted">No commands proposed.</p>
                ) : (
                  plan.commands.map((command, index) => (
                    <div key={index} className="command-row">
                      <code>{command}</code>
                      <button
                        className="secondary-button"
                        onClick={() => void copyCommand(command, index)}
                      >
                        {copied === index ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="composer-footer padded">
                <span className="muted">
                  {approved.size} of {plan.edits.length} approved
                </span>
                <button
                  className="primary-button"
                  onClick={() => void applyApproved()}
                  disabled={applying || approved.size === 0}
                >
                  {applying ? 'Applying…' : 'Apply approved edits'}
                </button>
              </div>

              {applyResult && (
                <div className="apply-result" role="status">
                  {applyResult.completed ? (
                    <p>Applied {applyResult.applied.length} edit(s).</p>
                  ) : (
                    <>
                      <p>
                        <strong>Apply did not complete.</strong>
                      </p>
                      {applyResult.failed && <p>{applyResult.failed.message}</p>}
                      <p className="muted">
                        {applyResult.rolledBack
                          ? 'All changes were rolled back.'
                          : 'No changes were rolled back.'}
                      </p>
                      {stale && (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void requestPlanFor(task, researchSessionId)}
                        >
                          Plan again with current files
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {applyResult?.completed && (
                <div className="plan-commands">
                  <strong>Verification (never runs automatically)</strong>
                  <p className="muted">
                    Working directory: {props.workspaceRoot}
                  </p>

                  {verifyOptions.map((option) => (
                    <label key={option} className="command-row">
                      <input
                        type="radio"
                        name="verify-command"
                        checked={verifyCommand === option}
                        disabled={verifying}
                        onChange={() => setVerifyCommand(option)}
                      />
                      <code>{option}</code>
                    </label>
                  ))}

                  <input
                    aria-label="Custom verification command"
                    value={verifyCommand}
                    onChange={(event) => setVerifyCommand(event.target.value)}
                    placeholder="Custom command, e.g. npm test…"
                    maxLength={2000}
                    disabled={verifying}
                  />

                  <div className="composer-footer">
                    <span className="muted">
                      {verifyCommand.trim()
                        ? `Will run: ${verifyCommand.trim()}`
                        : 'Pick or type a check first.'}
                    </span>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={verifying || !verifyCommand.trim()}
                      onClick={() => void runVerification()}
                    >
                      {verifying ? 'Running…' : 'Run check'}
                    </button>
                  </div>

                  {verifyError && (
                    <p role="alert">Verification failed: {verifyError}</p>
                  )}

                  {verifyResult && (
                    <div className="apply-result" role="status">
                      <p>
                        <strong>
                          {verifyResult.success
                            ? 'Check passed.'
                            : 'Check failed.'}
                        </strong>{' '}
                        Exit code: {verifyResult.exitCode}
                        {verifyResult.timedOut ? ' (timed out)' : ''}
                        {verifyResult.outputLimited ? ' · output truncated' : ''}
                        {' · '}
                        {verifyResult.diagnostics.length} problem(s)
                      </p>
                      {verifyResult.warnings.map((warning) => (
                        <p key={warning} className="muted">
                          Warning: {warning}
                        </p>
                      ))}
                      <pre className="plan-preview">
                        {verifyResult.output.slice(0, MAX_OUTPUT_CHARS)}
                      </pre>
                      {verifyResult.diagnostics.slice(0, 10).map((diagnostic, index) => (
                        <p key={index} className="muted">
                          {diagnostic.file}:{diagnostic.line} {diagnostic.severity}:{' '}
                          {diagnostic.message}
                        </p>
                      ))}
                      {!verifyResult.success &&
                        repairAttempt < MAX_REPAIR_ATTEMPTS && (
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={requestFix}
                          >
                            Request fix (attempt {repairAttempt + 1} of{' '}
                            {MAX_REPAIR_ATTEMPTS})
                          </button>
                        )}
                      {!verifyResult.success &&
                        repairAttempt >= MAX_REPAIR_ATTEMPTS && (
                          <p className="muted">
                            Repair attempts exhausted. Adjust the task or files
                            and plan again.
                          </p>
                        )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!plan && !error && !keyMissing && !contextPreview && (
            <p className="muted padded">
              No plan yet. Describe a task below — the plan appears here
              for review before anything is applied.
            </p>
          )}
          </div>

          <div className="agent-dock">
            <form
              className="agent-composer"
              onSubmit={(event) => {
                event.preventDefault()
                void requestPlan()
              }}
            >
              <textarea
                aria-label="Coding task"
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder="Describe the change, e.g. add input validation to the signup form…"
                rows={3}
                maxLength={4000}
                disabled={busy}
              />
              <div className="composer-footer">
                <span className="muted">{task.length}/4000</span>
                {planning ? (
                  <button type="button" onClick={stopPlanning}>
                    Stop
                  </button>
                ) : (
                  <button type="submit" disabled={applying || verifying || !task.trim()}>
                    Plan task
                  </button>
                )}
              </div>
            </form>
          </div>
        </>
      )}
    </section>
  )
}
