import { useCallback, useEffect, useRef, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { AiKeyNotice } from './AiKeyNotice'

export interface IntelligenceHubProps {
  workspaceRoot: string | null
  defaultModel: string
  onStatus: (status: string) => void
  onOpenFile?: (path: string, line?: number) => void
  onFilesChanged?: (changedPaths: string[]) => void
  onOpenConnections?: () => void
}

type HubTab = 'search' | 'plan' | 'specialists' | 'runs' | 'quality'

const HUB_TABS: Array<{ id: HubTab; label: string }> = [
  { id: 'search', label: 'SEARCH' },
  { id: 'plan', label: 'PLAN' },
  { id: 'specialists', label: 'SPECIALISTS' },
  { id: 'runs', label: 'RUNS' },
  { id: 'quality', label: 'QUALITY' },
]

const SPECIALIST_OPTIONS: KryomSpecialistId[] = [
  'research',
  'coding',
  'testing',
  'debugging',
  'security',
  'review',
]

function splitPaths(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function renderUnknown(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }

  try {
    const text = JSON.stringify(value, null, 2)

    return (text ?? String(value)).slice(0, 4000)
  } catch {
    return String(value).slice(0, 4000)
  }
}

export function IntelligenceHub(props: IntelligenceHubProps) {
  const [tab, setTab] = useState<HubTab>('search')

  return (
    <section className="agent-panel">
      <div className="ai-heading">
        <div>
          <strong>Project Intelligence</strong>
          <div className="muted">Understand · Plan · Specialists · Runs · Quality</div>
        </div>
      </div>
      {!props.workspaceRoot && (
        <p className="muted padded">Open a project to use intelligence features.</p>
      )}
      {props.workspaceRoot && (
        <>
          <div className="stage-tabs" role="tablist" aria-label="Intelligence">
            {HUB_TABS.map((entry) => (
              <button
                key={entry.id}
                role="tab"
                aria-selected={tab === entry.id}
                className={tab === entry.id ? 'panel-tab active' : 'panel-tab'}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'search' && <SearchView {...props} workspaceRoot={props.workspaceRoot} />}
            {tab === 'plan' && <PlanView {...props} workspaceRoot={props.workspaceRoot} />}
            {tab === 'specialists' && <SpecialistsView {...props} workspaceRoot={props.workspaceRoot} />}
            {tab === 'runs' && <RunsView {...props} workspaceRoot={props.workspaceRoot} />}
            {tab === 'quality' && <QualityView {...props} workspaceRoot={props.workspaceRoot} />}
          </div>
        </>
      )}
    </section>
  )
}

function SearchView(props: { workspaceRoot: string; onOpenFile?: (path: string, line?: number) => void; onStatus: (status: string) => void }) {
  const [status, setStatus] = useState<KryomIndexStatus | null>(null)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<KryomIntelSearch | null>(null)
  const [impactPaths, setImpactPaths] = useState('')
  const [impact, setImpact] = useState<KryomImpactReport | null>(null)
  const [architecture, setArchitecture] = useState<KryomArchitecture | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await kryom().getIndexStatus())
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus, props.workspaceRoot])

  async function runRefresh() {
    setWorking(true)
    setError('')

    try {
      const report = await kryom().refreshIndex({})

      props.onStatus(`Index refreshed: ${report.total} files.`)
      await refreshStatus()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function runSearch() {
    setWorking(true)
    setError('')
    setResult(null)

    try {
      setResult(await kryom().searchProject({ query }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function runImpact() {
    setWorking(true)
    setError('')
    setImpact(null)

    try {
      setImpact(await kryom().analyzeImpact({ paths: splitPaths(impactPaths) }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  async function runArchitecture() {
    setWorking(true)
    setError('')
    setArchitecture(null)

    try {
      setArchitecture(await kryom().analyzeArchitecture())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="plan-view">
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <div className="plan-commands">
        <div className="command-row">
          <span>
            {status?.indexed
              ? `Index: ${status.total} files${status.truncated ? ' (truncated)' : ''}`
              : 'Index: not built yet'}
          </span>
          <button className="secondary-button" disabled={working} onClick={() => void runRefresh()}>
            {working ? 'Working…' : 'Refresh index'}
          </button>
        </div>
      </div>
      <div className="agent-composer">
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Ask about the project, e.g. "where is authentication implemented"'
          rows={2}
        />
        <div className="composer-footer">
          <span className="muted">{result ? `${result.results.length} results` : 'Deterministic search'}</span>
          <span className="spacer" />
          <button className="secondary-button" disabled={working || !query.trim()} onClick={() => void runSearch()}>
            Search
          </button>
        </div>
      </div>
      {result && (
        <div className="plan-commands">
          {result.results.length === 0 && <p className="muted">No matches found.</p>}
          {result.results.map((hit, index) => (
            <div key={`${hit.file}-${hit.line}-${index}`} className="command-row">
              <button
                className="secondary-button"
                title={hit.why}
                onClick={() => props.onOpenFile?.(hit.file, hit.line)}
              >
                {hit.file}:{hit.line}
              </button>
              <span className="muted">[{hit.kind} · {hit.score}] {hit.why}</span>
            </div>
          ))}
          {result.stale.length > 0 && (
            <p className="muted">{result.stale.length} stale file(s) excluded — refresh the index.</p>
          )}
        </div>
      )}
      <div className="agent-composer">
        <textarea
          value={impactPaths}
          onChange={(event) => setImpactPaths(event.target.value)}
          placeholder="Impact analysis: workspace-relative paths, one per line"
          rows={2}
        />
        <div className="composer-footer">
          <span className="spacer" />
          <button className="secondary-button" disabled={working || !impactPaths.trim()} onClick={() => void runImpact()}>
            Analyze impact
          </button>
          <button className="secondary-button" disabled={working} onClick={() => void runArchitecture()}>
            Architecture
          </button>
        </div>
      </div>
      {impact && (
        <div className="plan-commands">
          <div className="command-row">
            <span>
              {impact.directDependents.length} direct · {impact.indirectDependents.length} indirect dependent(s)
            </span>
          </div>
          {impact.affectedFiles.slice(0, 12).map((file) => (
            <div key={file} className="command-row">
              <button className="secondary-button" onClick={() => props.onOpenFile?.(file)}>{file}</button>
            </div>
          ))}
          {impact.risks.map((risk, index) => (
            <p key={index} className="muted">[{risk.level}] {risk.reason}</p>
          ))}
          {impact.relatedTests.length > 0 && (
            <p className="muted">Related tests: {impact.relatedTests.join(', ')}</p>
          )}
        </div>
      )}
      {architecture && (
        <div className="plan-commands">
          <div className="command-row"><span>Language: {architecture.primaryLanguage}</span></div>
          <div className="command-row"><span>Frameworks: {architecture.frameworks.join(', ') || 'none'}</span></div>
          <div className="command-row"><span>Entry points: {architecture.entryPoints.map((entry) => entry.path).join(', ') || 'unknown'}</span></div>
          <div className="command-row"><span>Modules: {architecture.modules.map((entry) => `${entry.name} (${entry.files})`).join(', ')}</span></div>
          {architecture.boundaries.map((entry) => (
            <p key={entry.name} className="muted">Boundary — {entry.name}: {entry.detail}</p>
          ))}
          {architecture.conventions.map((entry) => (
            <p key={entry.name} className="muted">Convention — {entry.name} ({entry.evidence})</p>
          ))}
        </div>
      )}
    </div>
  )
}

function PlanView(props: { workspaceRoot: string; defaultModel: string; onStatus: (status: string) => void; onOpenConnections?: () => void }) {
  const [requirement, setRequirement] = useState('')
  const [contextPaths, setContextPaths] = useState('')
  const [built, setBuilt] = useState<KryomImplPlan | null>(null)
  const [reviseChange, setReviseChange] = useState('')
  const [revised, setRevised] = useState<KryomImplRevision | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [keyMissing, setKeyMissing] = useState(false)

  async function runBuild() {
    setWorking(true)
    setError('')
    setKeyMissing(false)
    setBuilt(null)
    setRevised(null)

    try {
      const plan = await kryom().buildImplPlan({
        requirement,
        model: props.defaultModel,
        contextPaths: splitPaths(contextPaths),
      })

      setBuilt(plan)
      props.onStatus(`Implementation plan ready: ${plan.plan.id}.`)
    } catch (err) {
      const message = errorMessage(err)

      setError(message)
      setKeyMissing(/API key is not configured/i.test(message))
    } finally {
      setWorking(false)
    }
  }

  async function runCancel() {
    try {
      await kryom().cancelImplPlan()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function runRevise() {
    if (!built) {
      return
    }

    setWorking(true)
    setError('')
    setRevised(null)

    try {
      const revision = await kryom().reviseImplPlan({
        planId: built.plan.id,
        change: reviseChange,
        model: props.defaultModel,
      })

      setRevised(revision)
      props.onStatus(`Plan revised: ${revision.plan.id}.`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  const shown = revised ?? built

  return (
    <div className="plan-view">
      {keyMissing && !working && (
        <AiKeyNotice onOpenConnections={props.onOpenConnections} />
      )}
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <div className="agent-composer">
        <textarea
          value={requirement}
          onChange={(event) => setRequirement(event.target.value)}
          placeholder="Describe the requirement, e.g. Add user login with session cookies"
          rows={3}
        />
        <textarea
          value={contextPaths}
          onChange={(event) => setContextPaths(event.target.value)}
          placeholder="Context paths (optional, one per line)"
          rows={2}
        />
        <div className="composer-footer">
          <span className="muted">{requirement.length}/4000</span>
          <span className="spacer" />
          {working && (
            <button className="secondary-button" onClick={() => void runCancel()}>Cancel</button>
          )}
          <button className="secondary-button" disabled={working || !requirement.trim()} onClick={() => void runBuild()}>
            {working ? 'Planning…' : 'Build plan'}
          </button>
        </div>
      </div>
      {shown && (
        <div className="plan-commands">
          <div className="command-row">
            <span>Plan {shown.plan.id} · {shown.decomposition.subtasks.length} subtask(s) · order: {shown.executionOrder.join(' → ')}</span>
          </div>
          {shown.decomposition.subtasks.map((subtask) => (
            <div key={subtask.index} className="command-row">
              <span>
                [{subtask.index}] {subtask.title} — files: {subtask.files.map((file) => file.path).join(', ') || 'none'};
                depends: {subtask.dependsOn.join(', ') || 'none'}; verify: {subtask.verification || '—'}
              </span>
            </div>
          ))}
          {shown.parallelGroups.map((group) => (
            <p key={group.wave} className="muted">
              Wave {group.wave}: tasks {group.subtasks.join(', ')} {group.parallel ? '(parallel-safe)' : '(sequential)'}
            </p>
          ))}
          {shown.sharedFileConflicts.map((conflict, index) => (
            <p key={index} className="muted">Shared-file conflict: {conflict.file} — {conflict.resolution}</p>
          ))}
          {shown.decomposition.risks.map((risk, index) => (
            <p key={index} className="muted">[{risk.severity}] {risk.explanation} → {risk.mitigation}</p>
          ))}
          {shown.evidence.failures.map((failure, index) => (
            <p key={index} className="muted">Evidence gap: {failure}</p>
          ))}
          {revised && (
            <p className="muted">
              Revises {revised.revises} · preserved {revised.preservedCompleted.length} completed step(s) ·
              invalidated {revised.invalidatedAssumptions.length} context file(s).
            </p>
          )}
        </div>
      )}
      {built && !revised && (
        <div className="agent-composer">
          <textarea
            value={reviseChange}
            onChange={(event) => setReviseChange(event.target.value)}
            placeholder="Describe what changed (revision keeps completed work)"
            rows={2}
          />
          <div className="composer-footer">
            <span className="spacer" />
            <button className="secondary-button" disabled={working || !reviseChange.trim()} onClick={() => void runRevise()}>
              Revise plan
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SpecialistsView(props: { workspaceRoot: string; defaultModel: string; onStatus: (status: string) => void; onOpenConnections?: () => void }) {
  const [specialist, setSpecialist] = useState<KryomSpecialistId>('research')
  const [task, setTask] = useState('')
  const [contextPaths, setContextPaths] = useState('')
  const [run, setRun] = useState<KryomSpecialistRun | null>(null)
  const [runs, setRuns] = useState<KryomSpecialistRun[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [keyMissing, setKeyMissing] = useState(false)
  const pollRef = useRef<number | null>(null)

  const refreshList = useCallback(async () => {
    try {
      setRuns((await kryom().listSpecialistRuns()).runs)
    } catch {
      // List is auxiliary; the run view reports its own errors.
    }
  }, [])

  useEffect(() => {
    void refreshList()
  }, [refreshList, props.workspaceRoot])

  useEffect(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }

    if (!run || run.state !== 'running') {
      return
    }

    pollRef.current = window.setInterval(() => {
      kryom()
        .getSpecialistRun({ runId: run.id })
        .then((updated) => {
          setRun(updated)

          if (updated.state !== 'running') {
            void refreshList()
          }
        })
        .catch((err: unknown) => setError(errorMessage(err)))
    }, 2000)

    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [run, refreshList])

  async function startRun() {
    setWorking(true)
    setError('')
    setKeyMissing(false)

    try {
      const started = await kryom().runSpecialist({
        specialist,
        task,
        model: props.defaultModel,
        contextPaths: splitPaths(contextPaths),
      })

      setRun(started)
      props.onStatus(`Specialist ${specialist} started.`)
    } catch (err) {
      const message = errorMessage(err)

      setError(message)
      setKeyMissing(/API key is not configured/i.test(message))
    } finally {
      setWorking(false)
    }
  }

  async function cancelRun() {
    if (!run) {
      return
    }

    try {
      await kryom().cancelSpecialistRun({ runId: run.id })
      setRun(await kryom().getSpecialistRun({ runId: run.id }))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="plan-view">
      {keyMissing && !working && (
        <AiKeyNotice onOpenConnections={props.onOpenConnections} />
      )}
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <div className="agent-composer">
        <div className="composer-footer">
          <select
            value={specialist}
            onChange={(event) => setSpecialist(event.target.value as KryomSpecialistId)}
            aria-label="Specialist"
          >
            {SPECIALIST_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <span className="muted">Coding proposes only · testing never executes</span>
        </div>
        <textarea
          value={task}
          onChange={(event) => setTask(event.target.value)}
          placeholder="Specialist task, e.g. Review src/auth.ts for injection risks"
          rows={3}
        />
        <textarea
          value={contextPaths}
          onChange={(event) => setContextPaths(event.target.value)}
          placeholder="Context paths (optional, one per line)"
          rows={2}
        />
        <div className="composer-footer">
          <span className="spacer" />
          <button className="secondary-button" disabled={working || !task.trim()} onClick={() => void startRun()}>
            {working ? 'Starting…' : 'Run specialist'}
          </button>
        </div>
      </div>
      {run && (
        <div className="plan-commands">
          <div className="command-row">
            <span>{run.specialist} · {run.state}{run.error ? ` — ${run.error}` : ''}</span>
            {run.state === 'running' && (
              <button className="secondary-button" onClick={() => void cancelRun()}>Cancel</button>
            )}
          </div>
          {run.result !== undefined && (
            <pre className="muted padded">{renderUnknown(run.result)}</pre>
          )}
          {(run.evidenceNotes?.length ?? 0) > 0 && (
            <p className="muted">Notes: {run.evidenceNotes?.join('; ')}</p>
          )}
        </div>
      )}
      {runs.length > 0 && (
        <details className="sessions-disclosure">
          <summary>Recent specialist runs ({runs.length})</summary>
          <div className="plan-commands">
            {runs.slice(0, 10).map((entry) => (
              <div key={entry.id} className="command-row">
                <button
                  className="secondary-button"
                  onClick={() => {
                    kryom()
                      .getSpecialistRun({ runId: entry.id })
                      .then(setRun)
                      .catch((err: unknown) => setError(errorMessage(err)))
                  }}
                >
                  {entry.id}
                </button>
                <span className="muted">{entry.specialist} · {entry.state}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

interface DraftTask {
  specialist: KryomSpecialistId
  title: string
  files: string
  dependsOn: string
}

function RunsView(props: {
  workspaceRoot: string
  onStatus: (status: string) => void
  onOpenConnections?: () => void
  onFilesChanged?: (changedPaths: string[]) => void
}) {
  const [planId, setPlanId] = useState('')
  const [drafts, setDrafts] = useState<DraftTask[]>([
    { specialist: 'coding', title: '', files: '', dependsOn: '' },
  ])
  const [run, setRun] = useState<KryomOrchRun | null>(null)
  const [runs, setRuns] = useState<KryomOrchRun[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [keyMissing, setKeyMissing] = useState(false)
  const pollRef = useRef<number | null>(null)

  const refreshList = useCallback(async () => {
    try {
      setRuns((await kryom().listOrchRuns()).runs)
    } catch {
      // List is auxiliary; the run view reports its own errors.
    }
  }, [])

  useEffect(() => {
    void refreshList()
  }, [refreshList, props.workspaceRoot])

  useEffect(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }

    if (!run || run.state !== 'active') {
      return
    }

    pollRef.current = window.setInterval(() => {
      kryom()
        .advanceOrchRun({ runId: run.id })
        .then((updated) => {
          setRun(updated)

          if (updated.state !== 'active') {
            void refreshList()
          }
        })
        .catch((err: unknown) => setError(errorMessage(err)))
    }, 3000)

    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [run, refreshList])

  function updateDraft(index: number, patch: Partial<DraftTask>) {
    setDrafts((current) => current.map((entry, position) =>
      position === index ? { ...entry, ...patch } : entry
    ))
  }

  async function startRun() {
    setWorking(true)
    setError('')
    setKeyMissing(false)

    try {
      const tasks = drafts.map((draft, index) => {
        const dependsOn = draft.dependsOn
          .split(/[,\s]+/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
          .map((entry) => Number(entry))

        if (dependsOn.some((entry) => !Number.isInteger(entry) || entry < 0 || entry >= drafts.length || entry === index)) {
          throw new Error(`Task ${index + 1} has an invalid dependency; use task numbers 0–${drafts.length - 1}.`)
        }

        return {
          specialist: draft.specialist,
          title: draft.title.trim(),
          files: splitPaths(draft.files),
          dependsOn,
        }
      })

      const started = await kryom().startOrchRun({ planId: planId.trim(), tasks })

      setRun(started)
      props.onStatus(`Orchestration run started: ${started.id}.`)
      void refreshList()
    } catch (err) {
      const message = errorMessage(err)

      setError(message)
      setKeyMissing(/API key is not configured/i.test(message))
    } finally {
      setWorking(false)
    }
  }

  async function advance() {
    if (!run) {
      return
    }

    try {
      setRun(await kryom().advanceOrchRun({ runId: run.id }))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function approve(taskId: string) {
    if (!run) {
      return
    }

    try {
      const updated = await kryom().approveOrchTask({ runId: run.id, taskId })
      const task = updated.tasks.find((entry) => entry.id === taskId)

      setRun(updated)

      if (task?.state === 'merged' && task.merge?.files?.length) {
        props.onFilesChanged?.(task.merge.files)
      }

      props.onStatus(`Task ${taskId} ${task?.state ?? 'updated'}.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function retry(taskId: string) {
    if (!run) {
      return
    }

    try {
      setRun(await kryom().retryOrchTask({ runId: run.id, taskId }))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function cancel() {
    if (!run) {
      return
    }

    try {
      setRun(await kryom().cancelOrchRun({ runId: run.id }))
      void refreshList()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="plan-view">
      {keyMissing && !working && (
        <AiKeyNotice onOpenConnections={props.onOpenConnections} />
      )}
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <p className="muted padded">
        Runs start from approved plans only. Specialists propose; you approve each merge.
        Parallel proposal generation, strictly sequential merges.
      </p>
      <div className="agent-composer">
        <input
          value={planId}
          onChange={(event) => setPlanId(event.target.value)}
          placeholder="Approved plan id (review step completed)"
          aria-label="Plan id"
        />
        {drafts.map((draft, index) => (
          <div key={index} className="composer-footer">
            <span className="muted">#{index}</span>
            <select
              value={draft.specialist}
              onChange={(event) => updateDraft(index, { specialist: event.target.value as KryomSpecialistId })}
              aria-label={`Task ${index} specialist`}
            >
              {SPECIALIST_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <input
              value={draft.title}
              onChange={(event) => updateDraft(index, { title: event.target.value })}
              placeholder="Task title"
              aria-label={`Task ${index} title`}
            />
            <input
              value={draft.files}
              onChange={(event) => updateDraft(index, { files: event.target.value })}
              placeholder="Files (comma separated)"
              aria-label={`Task ${index} files`}
            />
            <input
              value={draft.dependsOn}
              onChange={(event) => updateDraft(index, { dependsOn: event.target.value })}
              placeholder="Depends (0,1)"
              aria-label={`Task ${index} dependencies`}
            />
          </div>
        ))}
        <div className="composer-footer">
          <button
            className="secondary-button"
            disabled={drafts.length >= 8}
            onClick={() => setDrafts((current) => [...current, { specialist: 'coding', title: '', files: '', dependsOn: '' }])}
          >
            Add task
          </button>
          <span className="spacer" />
          <button className="secondary-button" disabled={working || !planId.trim()} onClick={() => void startRun()}>
            {working ? 'Starting…' : 'Start run'}
          </button>
        </div>
      </div>
      {run && (
        <div className="plan-commands">
          <div className="command-row">
            <span>
              Run {run.id} · {run.state}
              {run.outcome ? ` · merged ${run.outcome.merged}/${run.outcome.total}${run.outcome.partial ? ' (partial)' : ''}` : ''}
            </span>
            <span>
              <button className="secondary-button" disabled={run.state !== 'active'} onClick={() => void advance()}>Advance</button>{' '}
              <button className="secondary-button" disabled={run.state !== 'active'} onClick={() => void cancel()}>Cancel run</button>
            </span>
          </div>
          {run.tasks.map((task) => (
            <div key={task.id} className="command-row">
              <span>
                {task.id} [{task.specialist}] {task.title} — {task.state}
                {task.error ? ` — ${task.error}` : ''}
                {task.merge?.checkpoint ? ` · checkpoint ${task.merge.checkpoint}` : ''}
              </span>
              <span>
                {task.state === 'proposed' && (
                  <button className="secondary-button" onClick={() => void approve(task.id)}>Approve + merge</button>
                )}{' '}
                {['failed', 'timeout', 'stale', 'blocked', 'rejected'].includes(task.state) && (
                  <button className="secondary-button" onClick={() => void retry(task.id)}>Retry</button>
                )}
              </span>
            </div>
          ))}
          {run.tasks.some((task) => task.state === 'proposed' && task.proposal) && (
            <details className="sessions-disclosure">
              <summary>Proposals under review</summary>
              {run.tasks.filter((task) => task.state === 'proposed' && task.proposal).map((task) => (
                <pre key={task.id} className="muted padded">{task.id}: {renderUnknown(task.proposal?.result)}</pre>
              ))}
            </details>
          )}
        </div>
      )}
      {runs.length > 0 && (
        <details className="sessions-disclosure">
          <summary>Recent runs ({runs.length})</summary>
          <div className="plan-commands">
            {runs.slice(0, 10).map((entry) => (
              <div key={entry.id} className="command-row">
                <button
                  className="secondary-button"
                  onClick={() => {
                    kryom()
                      .getOrchRun({ runId: entry.id })
                      .then(setRun)
                      .catch((err: unknown) => setError(errorMessage(err)))
                  }}
                >
                  {entry.id}
                </button>
                <span className="muted">{entry.state} · {entry.planTitle}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function QualityView(props: { workspaceRoot: string; onStatus: (status: string) => void; onOpenFile?: (path: string, line?: number) => void }) {
  const [paths, setPaths] = useState('')
  const [planId, setPlanId] = useState('')
  const [report, setReport] = useState<KryomQualityReport | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function runReport() {
    setWorking(true)
    setError('')
    setReport(null)

    try {
      const built = await kryom().buildQualityReport({
        planId: planId.trim() || undefined,
        paths: splitPaths(paths),
      })

      setReport(built)
      props.onStatus(`Quality report ready: ${built.verdict.verdict}.`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="plan-view">
      {error && (
        <div className="ai-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} className="secondary-button">Dismiss</button>
        </div>
      )}
      <p className="muted padded">Computed from project evidence only — no model calls, no invented scores.</p>
      <div className="agent-composer">
        <textarea
          value={paths}
          onChange={(event) => setPaths(event.target.value)}
          placeholder="Scope paths (optional; git changes are added automatically)"
          rows={2}
        />
        <input
          value={planId}
          onChange={(event) => setPlanId(event.target.value)}
          placeholder="Plan id (optional, for verification history)"
          aria-label="Plan id"
        />
        <div className="composer-footer">
          <span className="spacer" />
          <button className="secondary-button" disabled={working} onClick={() => void runReport()}>
            {working ? 'Analyzing…' : 'Build report'}
          </button>
        </div>
      </div>
      {report && (
        <div className="plan-commands">
          <div className="command-row">
            <span>Verdict: {report.verdict.verdict} — {report.verdict.reasons.join('; ')}</span>
          </div>
          <p className="muted">
            Regression: {report.regression.affectedFiles.length} affected file(s),{' '}
            {report.regression.relatedTests.length} related test(s),{' '}
            {report.regression.failures.length} failing check(s).
          </p>
          {report.regression.failures.map((failure) => (
            <p key={failure.check} className="muted">
              [{failure.status}] {failure.check} ({failure.history} report(s))
            </p>
          ))}
          {report.testSuggestions.map((suggestion) => (
            <div key={`${suggestion.file}-${suggestion.symbol}`} className="command-row">
              <button
                className="secondary-button"
                onClick={() => props.onOpenFile?.(suggestion.file, suggestion.line)}
              >
                {suggestion.file}:{suggestion.line}
              </button>
              <span className="muted">Test {suggestion.kind} “{suggestion.symbol}” — {suggestion.rationale}</span>
            </div>
          ))}
          {report.security.findings.map((finding, index) => (
            <div key={index} className="command-row">
              <button
                className="secondary-button"
                onClick={() => props.onOpenFile?.(finding.file, finding.line)}
              >
                {finding.file}:{finding.line}
              </button>
              <span className="muted">
                [{finding.severity}/{finding.confidence}] {finding.title} — {finding.recommendation}
              </span>
            </div>
          ))}
          {report.performance.notes.map((note, index) => (
            <p key={index} className="muted">Performance: {note}</p>
          ))}
          {report.remainingRisks.map((risk, index) => (
            <p key={index} className="muted">Remaining risk: {risk}</p>
          ))}
        </div>
      )}
    </div>
  )
}
