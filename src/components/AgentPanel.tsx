import { useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { diffLines } from '../utils/diff'
import { baseName } from '../utils/paths'
import { useDialogs } from './dialogs'

export interface AgentPanelProps {
  workspaceRoot: string | null
  defaultModel: string
  onFilesChanged: (changedPaths: string[]) => void
  onStatus: (status: string) => void
}

const MODELS = ['muse-spark-1.3', 'muse-wonder-1.0'] as const

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
  const [plan, setPlan] = useState<KryomAgentPlan | null>(null)
  const [approved, setApproved] = useState<Set<number>>(new Set())
  const [oldContents, setOldContents] = useState<Record<number, string>>({})
  const [planning, setPlanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<KryomAgentApplyResult | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => {
    setModel(props.defaultModel)
  }, [props.defaultModel])

  async function requestPlan() {
    const trimmed = task.trim()

    if (!trimmed || planning || !props.workspaceRoot) {
      return
    }

    setPlanning(true)
    setError('')
    setPlan(null)
    setApplyResult(null)
    setOldContents({})

    try {
      const next = await kryom().planAgentTask({ task: trimmed, model })
      setPlan(next)
      setApproved(new Set(next.edits.map((edit) => edit.index ?? 0)))
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
      setError(errorMessage(e))
    } finally {
      setPlanning(false)
    }
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

    try {
      const edits = plan.edits.filter((edit) => approved.has(edit.index ?? 0))
      const result = await kryom().applyAgentEdits({ edits })
      setApplyResult(result)
      props.onFilesChanged(result.applied.map((entry) => entry.path))

      if (result.completed) {
        props.onStatus(`Agent applied ${result.applied.length} edit(s)`)
      } else if (result.failed) {
        props.onStatus('Agent apply failed and rolled back')
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setApplying(false)
    }
  }

  function reset() {
    setPlan(null)
    setApproved(new Set())
    setApplyResult(null)
    setError('')
    setOldContents({})
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

  return (
    <section className="agent-panel">
      <div className="ai-heading">
        <div>
          <strong>Coding agent</strong>
          <div className="muted">Plans only · you approve every change</div>
        </div>
        {plan && (
          <button onClick={reset} disabled={planning || applying}>
            New task
          </button>
        )}
      </div>

      {!props.workspaceRoot ? (
        <p className="muted padded">Open a project to plan coding tasks.</p>
      ) : (
        <>
          <label className="model-row">
            Model
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={planning || applying}
              aria-label="Agent model"
            >
              {MODELS.map((id) => (
                <option key={id} value={id}>
                  {id === 'muse-spark-1.3' ? 'Muse Spark 1.3' : 'Muse Wonder 1.0'}
                </option>
              ))}
            </select>
          </label>

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
              disabled={planning || applying}
            />
            <div className="composer-footer">
              <span className="muted">{task.length}/4000</span>
              <button type="submit" disabled={planning || applying || !task.trim()}>
                {planning ? 'Planning…' : 'Plan task'}
              </button>
            </div>
          </form>

          {error && (
            <div className="ai-error" role="alert">
              <strong>Agent request failed</strong>
              <p>{error}</p>
              <button onClick={() => setError('')} className="secondary-button">
                Dismiss
              </button>
            </div>
          )}

          {plan && (
            <div className="plan-view">
              <p className="muted padded">
                Model: {plan.model} · {plan.edits.length} proposed edit(s)
              </p>

              {plan.notes && <p className="plan-notes">{plan.notes}</p>}

              {plan.edits.length === 0 && (
                <p className="muted padded">The plan proposes no file edits.</p>
              )}

              {plan.edits.map((edit) => {
                const key = edit.index ?? 0
                const checked = approved.has(key)

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
                    </label>

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
                      <pre className="plan-preview">
                        {(edit.preview ?? edit.content ?? '').slice(0, 2000)}
                      </pre>
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
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
