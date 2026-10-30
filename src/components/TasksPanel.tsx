// Tasks bottom-panel tab (Level 3C, Phase 8): task and verification
// output drawn from real records — tracked agent plans with their
// verification reports, orchestration runs with task states, and
// quality reports with explainable verdicts. Read-only with refresh;
// execution stays in the Meta AI workspace and the agent flows.
import { useCallback, useEffect, useState } from 'react'
import { kryom, errorMessage } from '../api/kryom'

export interface TasksPanelProps {
  workspaceRoot: string | null
  onStatus: (status: string) => void
  onOpenFile: (path: string, line?: number) => void
}

function planStateLabel(plan: KryomTrackedPlan): string {
  return `${plan.status} · ${plan.verification}`
}

export function TasksPanel(props: TasksPanelProps) {
  const [plans, setPlans] = useState<KryomTrackedPlan[]>([])
  const [corruptPlans, setCorruptPlans] = useState<string[]>([])
  const [orchRuns, setOrchRuns] = useState<KryomOrchRun[]>([])
  const [quality, setQuality] = useState<
    Array<{
      id: string
      createdAt: string
      verdict: KryomQualityReport['verdict']
      scopeFiles: number
    }>
  >([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!props.workspaceRoot) {
      setPlans([])
      setOrchRuns([])
      setQuality([])
      setCorruptPlans([])
      return
    }

    setLoading(true)
    setError('')

    try {
      const [listedPlans, listedOrch, listedQuality] = await Promise.all([
        kryom().listAgentPlans(),
        kryom().listOrchRuns(),
        kryom().listQualityReports(),
      ])

      setPlans(listedPlans.plans)
      setCorruptPlans(listedPlans.corrupt)
      setOrchRuns(listedOrch.runs)
      setQuality(listedQuality.reports)
      setRefreshedAt(new Date().toISOString())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [props.workspaceRoot])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!props.workspaceRoot) {
    return (
      <section className="bottom-tab-panel" aria-label="Tasks">
        <p className="muted padded">
          Open a project to see its plans, orchestration runs, and
          verification output.
        </p>
      </section>
    )
  }

  return (
    <section className="bottom-tab-panel tasks-panel" aria-label="Tasks">
      <div className="tasks-head">
        <span className="muted">
          {plans.length} plan(s) · {orchRuns.length} orchestration run(s) ·{' '}
          {quality.length} quality report(s)
          {refreshedAt
            ? ` · refreshed ${new Date(refreshedAt).toLocaleTimeString('en-GB', { hour12: false })}`
            : ''}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="mini-btn"
          onClick={() => {
            void refresh()
            props.onStatus('Tasks refreshed')
          }}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="inline-error padded" role="alert">
          {error}
        </p>
      )}

      {corruptPlans.length > 0 && (
        <p className="inline-error padded">
          {corruptPlans.length} plan record(s) unreadable:{' '}
          {corruptPlans.slice(0, 4).join(', ')}
        </p>
      )}

      <div className="tasks-columns">
        <div>
          <strong>Plans</strong>
          {plans.length === 0 ? (
            <p className="muted">No tracked plans yet.</p>
          ) : (
            <ul className="tasks-list">
              {plans.slice(0, 12).map((plan) => (
                <li key={plan.id} className="tasks-row">
                  <span title={plan.objective}>
                    {plan.title} · {planStateLabel(plan)}
                  </span>
                  <span className="muted">
                    {plan.steps.filter((step) => step.state === 'verified').length}/
                    {plan.steps.length} verified · {plan.reports.length} report(s)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <strong>Orchestration</strong>
          {orchRuns.length === 0 ? (
            <p className="muted">No orchestration runs yet.</p>
          ) : (
            <ul className="tasks-list">
              {orchRuns.slice(0, 12).map((run) => (
                <li key={run.id} className="tasks-row">
                  <span title={run.planTitle}>
                    {run.id} · {run.state}
                  </span>
                  <span className="muted">
                    {run.tasks.filter((task) => task.state === 'merged').length}/
                    {run.tasks.length} merged
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <strong>Quality &amp; verification</strong>
          {quality.length === 0 ? (
            <p className="muted">No quality reports yet.</p>
          ) : (
            <ul className="tasks-list">
              {quality.slice(0, 12).map((report) => (
                <li key={report.id} className="tasks-row">
                  <span>
                    {report.id} · {report.verdict.verdict}
                  </span>
                  <span className="muted">
                    {report.scopeFiles} file(s) ·{' '}
                    {new Date(report.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {plans.some((plan) => plan.reports.length > 0) && (
            <ul className="tasks-list">
              {plans
                .flatMap((plan) =>
                  plan.reports.map((report) => ({ plan, report }))
                )
                .slice(-6)
                .reverse()
                .map(({ plan, report }) => (
                  <li key={report.id} className="tasks-row">
                    <span title={plan.title}>
                      {report.check}: {report.conclusion.replace(/_/g, ' ')}
                    </span>
                    <span className="muted">
                      {report.origin}
                      {report.execution
                        ? ` · exit ${report.execution.exitCode}`
                        : ''}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      <p className="muted padded">
        Plans run from Meta AI sessions; open one from the editor tab
        bar.
      </p>
    </section>
  )
}
