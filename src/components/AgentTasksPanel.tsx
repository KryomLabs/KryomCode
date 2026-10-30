// Session Tasks panel (Advanced Agent, Part A). A read-only bottom
// panel for one Meta AI Agent tab: the session's tracked plan with
// step states, its changed-file manifest grouped by action,
// approvals/execution state, verification reports, linked research,
// and real errors. Every row derives from a backend record fetched
// by id (tracked plan, research session, orchestration runs) or from
// the session manifest — nothing is invented. Execution and approvals
// stay in the Implementation panel and the INTEL stage; this panel
// only reports. Collapse and height are owned by the parent.
import { useEffect, useRef, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'
import { baseName } from '../utils/paths'
import type { HistoryRef, MetaSession } from '../state/meta-sessions'

export interface AgentTasksPanelProps {
  session: MetaSession
  workspaceRoot: string | null
  refreshToken: number
  onOpenFile: (path: string, line?: number) => void
  onStatus: (status: string) => void
}

interface TasksData {
  plan: KryomTrackedPlan | null
  planError: string
  research: KryomResearchSession | null
  researchError: string
  orchRuns: KryomOrchRun[]
  orchError: string
  refreshedAt: string | null
}

function emptyData(): TasksData {
  return {
    plan: null,
    planError: '',
    research: null,
    researchError: '',
    orchRuns: [],
    orchError: '',
    refreshedAt: null,
  }
}

function stepLabel(step: KryomPlanStep): string {
  return `${step.label}: ${step.state.replace(/_/g, ' ')}${step.interrupted ? ' (interrupted)' : ''}`
}

export function AgentTasksPanel(props: AgentTasksPanelProps) {
  const [data, setData] = useState<TasksData>(emptyData)
  const [loading, setLoading] = useState(false)
  const [manualToken, setManualToken] = useState(0)
  const generationRef = useRef(0)

  const session = props.session

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation

    if (!props.workspaceRoot) {
      setData(emptyData())
      return
    }

    const planId = session.planId
    const researchSessionId = session.researchSessionId

    if (!planId && !researchSessionId) {
      setData({ ...emptyData(), refreshedAt: new Date().toISOString() })
      return
    }

    setLoading(true)

    void (async () => {
      const next = emptyData()

      if (planId) {
        try {
          next.plan = await kryom().getAgentPlan({ id: planId })
        } catch (e) {
          next.planError = errorMessage(e)
        }

        try {
          const runs = await kryom().listOrchRuns()

          next.orchRuns = runs.runs.filter((run) => run.planId === planId)
        } catch (e) {
          next.orchError = errorMessage(e)
        }
      }

      if (researchSessionId) {
        try {
          next.research = await kryom().getResearch({ id: researchSessionId })
        } catch (e) {
          next.researchError = errorMessage(e)
        }
      }

      if (generation !== generationRef.current) {
        return
      }

      next.refreshedAt = new Date().toISOString()
      setData(next)
      setLoading(false)
    })()
  }, [
    props.workspaceRoot,
    session.planId,
    session.researchSessionId,
    props.refreshToken,
    manualToken,
  ])

  const added = session.changedFiles.filter((file) => file.action === 'added')
  const modified = session.changedFiles.filter(
    (file) => file.action === 'modified'
  )
  const deleted = session.changedFiles.filter(
    (file) => file.action === 'deleted'
  )

  const reviewStep = data.plan?.steps.find((step) => step.id === 'review')
  const proposedOrch = data.orchRuns.flatMap((run) =>
    run.tasks
      .filter((task) => task.state === 'proposed')
      .map((task) => ({ run, task }))
  )
  const orchErrors = data.orchRuns.flatMap((run) =>
    run.tasks
      .filter((task) => task.error)
      .map((task) => ({ run, task }))
  )
  const failedReports = (data.plan?.reports ?? []).filter(
    (report) => report.conclusion === 'failed'
  )

  function renderFileRow(file: { path: string; action: string }) {
    return (
      <li key={file.path} className="tasks-row">
        <span title={file.path}>{baseName(file.path)}</span>
        <span className="spacer" />
        <button
          type="button"
          className="mini-btn"
          onClick={() => props.onOpenFile(file.path)}
          title={`Open ${file.path}`}
        >
          Open
        </button>
      </li>
    )
  }

  return (
    <section className="agent-tasks" aria-label={`Tasks for ${session.title}`}>
      <div className="tasks-head">
        <span className="muted">
          {session.changedFiles.length} file(s) changed ·{' '}
          {data.plan
            ? `plan ${data.plan.status} · ${data.plan.verification}`
            : 'no tracked plan'}
          {data.orchRuns.length > 0
            ? ` · ${data.orchRuns.length} orch run(s)`
            : ''}
          {data.refreshedAt
            ? ` · ${new Date(data.refreshedAt).toLocaleTimeString('en-GB', { hour12: false })}`
            : ''}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="mini-btn"
          disabled={loading}
          onClick={() => {
            props.onStatus('Tasks refreshed')
            setManualToken((token) => token + 1)
          }}
          title="Re-read the linked plan, research, and runs"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!props.workspaceRoot && (
        <p className="muted padded">
          Open a project to track plans, files, and verification.
        </p>
      )}

      {props.workspaceRoot &&
        !session.planId &&
        !session.researchSessionId &&
        session.changedFiles.length === 0 && (
          <p className="muted padded">
            No task activity yet. Start an Implementation or Research task
            above and its steps, files, approvals, and checks appear here.
          </p>
        )}

      <div className="tasks-columns">
        <div>
          <strong>Current task</strong>
          {!data.plan && !data.planError && (
            <p className="muted">No tracked plan for this session.</p>
          )}
          {data.planError && (
            <p className="inline-error" role="alert">
              Plan unreadable: {data.planError}
            </p>
          )}
          {data.plan && (
            <>
              <p className="muted" title={data.plan.objective}>
                {data.plan.title} · {data.plan.status} ·{' '}
                {data.plan.verification}
              </p>
              <ul className="tasks-list">
                {data.plan.steps.map((step) => (
                  <li key={step.id} className="tasks-row">
                    <span title={step.detail || step.id}>
                      {stepLabel(step)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <strong>
            Files · {added.length} created · {modified.length} modified ·{' '}
            {deleted.length} deleted
          </strong>
          {session.changedFiles.length === 0 ? (
            <p className="muted">Nothing changed by this session yet.</p>
          ) : (
            <ul className="tasks-list">
              {added.map(renderFileRow)}
              {modified.map(renderFileRow)}
              {deleted.map(renderFileRow)}
            </ul>
          )}
        </div>

        <div>
          <strong>Approvals &amp; execution</strong>
          {!data.plan && proposedOrch.length === 0 && (
            <p className="muted">Nothing awaiting approval.</p>
          )}
          {reviewStep && (
            <p className="muted">
              Plan review step: {reviewStep.state.replace(/_/g, ' ')}
              {reviewStep.state === 'in_progress'
                ? ' — approve or adjust edits in Implementation above'
                : ''}
            </p>
          )}
          {proposedOrch.length > 0 && (
            <ul className="tasks-list">
              {proposedOrch.map(({ run, task }) => (
                <li key={task.id} className="tasks-row">
                  <span title={`${run.id} · ${task.specialist}`}>
                    Approval: {task.title}
                  </span>
                  <span className="muted">orch {run.id}</span>
                </li>
              ))}
            </ul>
          )}
          {data.research && (
            <p className="muted" title={data.research.objective}>
              Research: {data.research.status}
              {data.research.brief.generatedAt
                ? ` · brief v${data.research.brief.version}`
                : ' · no brief yet'}{' '}
              · {data.research.sources.length} source(s)
            </p>
          )}
          {data.researchError && (
            <p className="inline-error" role="alert">
              Research unreadable: {data.researchError}
            </p>
          )}
          {data.orchError && (
            <p className="inline-error" role="alert">
              Orchestration unreadable: {data.orchError}
            </p>
          )}
        </div>

        <div>
          <strong>Verification &amp; errors</strong>
          {!data.plan && (
            <p className="muted">No verification records.</p>
          )}
          {data.plan && data.plan.reports.length === 0 && (
            <p className="muted">
              No checks recorded for this plan yet.
            </p>
          )}
          {data.plan && data.plan.reports.length > 0 && (
            <ul className="tasks-list">
              {data.plan.reports
                .slice(-8)
                .reverse()
                .map((report) => (
                  <li key={report.id} className="tasks-row">
                    <span title={report.outputSummary || report.id}>
                      {report.check}: {report.conclusion.replace(/_/g, ' ')}
                    </span>
                    <span className="muted">
                      {report.execution
                        ? `exit ${report.execution.exitCode}`
                        : report.origin}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          {failedReports.length > 0 && (
            <p className="muted">
              {failedReports.length} failed check(s) — open Implementation
              above to repair.
            </p>
          )}
          {(data.research?.errors ?? []).slice(-4).map((entry, index) => (
            <p
              key={`${entry.at}-${index}`}
              className="inline-error"
              role="alert"
              title={entry.where}
            >
              Research: {entry.message}
            </p>
          ))}
          {orchErrors.slice(0, 4).map(({ run, task }) => (
            <p
              key={task.id}
              className="inline-error"
              role="alert"
              title={`orch ${run.id}`}
            >
              {task.title}: {task.error}
            </p>
          ))}
        </div>
      </div>

      {session.historyRefs.length > 0 && (
        <HistoryAttachNote refs={session.historyRefs} />
      )}
    </section>
  )
}

function HistoryAttachNote(props: { refs: HistoryRef[] }) {
  return (
    <p className="muted padded">
      {props.refs.length} histor
      {props.refs.length === 1 ? 'y item' : 'y items'} attached as task
      context: {props.refs.map((ref) => ref.label).join(' · ')}
    </p>
  )
}
