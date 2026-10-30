// Plan store tests (Level 3A.3): schema v2, v1 migration,
// transitions, evidence rules, verification reports, cancel,
// recovery, isolation, retention. No network, no Meta calls.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  writeStorageFile,
  readStorageFile,
} = require('../../security/storage-path.cjs')
const {
  PLANS_SEGMENTS,
  STEP_STATES,
  MAX_PLANS,
  newPlanId,
  assertPlanId,
  sanitizeRecord,
  normalizeProposal,
  createPlan,
  listPlans,
  getPlan,
  setStepState,
  attachEvidence,
  recordVerification,
  cancelPlan,
  resumePlan,
  completePlan,
} = require('./plan-store.cjs')
const {
  runDiagnostics,
} = require('../diagnostics/diagnostics.service.cjs')

async function openWorkspace(prefix = 'kryom-plan-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))

  await setWorkspaceRoot(root)

  return root
}

function v1Proposal(overrides = {}) {
  return {
    model: 'muse-spark-1.3',
    task: 'Add a health check.',
    edits: [],
    commands: ['npm test'],
    notes: 'Keep it small.',
    ...overrides,
  }
}

// Simulates an app restart: a fresh module has empty liveness while
// the workspace root (separate module) stays put.
function freshPlanStore() {
  const resolved = require.resolve('./plan-store.cjs')

  delete require.cache[resolved]

  return require('./plan-store.cjs')
}

describe('plan-store', () => {
  it('exposes stable ids and the documented step states', () => {
    assert.deepEqual([...STEP_STATES], [
      'pending',
      'in_progress',
      'completed',
      'verified',
      'blocked',
      'failed',
      'cancelled',
    ])

    const id = newPlanId()

    assert.match(id, /^pl-[a-z0-9-]{1,64}$/)
    assert.equal(assertPlanId(id), id)
    assert.throws(() => assertPlanId('../x'), /Invalid plan id/)
    assert.throws(() => assertPlanId('pl-ok/../x'), /Invalid plan id/)
  })

  it('migrates v1 proposals with honest defaults', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())

    assert.equal(plan.version, 2)
    assert.equal(plan.objective, 'Add a health check.')
    assert.equal(plan.expectedOutcome, '')
    assert.deepEqual(plan.risks, [])
    assert.deepEqual(
      plan.steps.map((step) => step.id),
      ['review', 'apply', 'verify']
    )
    assert.ok(plan.steps.every((step) => step.state === 'pending'))
    assert.equal(plan.status, 'active')
    assert.equal(plan.verification, 'unverified')
    assert.deepEqual(plan.reports, [])
    assert.equal(plan.proposal.task, 'Add a health check.')

    await assert.rejects(() => createPlan(null), /Invalid plan proposal/)
    await assert.rejects(
      () => createPlan(v1Proposal({ task: '  ' })),
      /Invalid plan objective/
    )
  })

  it('carries risks, outcomes, and suggested steps', async () => {
    await openWorkspace()

    const plan = await createPlan(
      v1Proposal({
        expectedOutcome: 'Health endpoint returns 200.',
        risks: [
          {
            severity: 'high',
            explanation: 'May break startup.',
            mitigation: 'Gate behind a flag.',
          },
          {
            severity: 'bogus',
            explanation: 'Unknown label.',
            mitigation: 'Still recorded.',
          },
        ],
        suggestedSteps: ['Write the endpoint', 'Add a test', '', 42],
      }),
      { title: 'Health check plan' }
    )

    assert.equal(plan.title, 'Health check plan')
    assert.equal(plan.expectedOutcome, 'Health endpoint returns 200.')
    assert.equal(plan.risks.length, 2)
    assert.equal(plan.risks[0].severity, 'high')
    assert.equal(plan.risks[1].severity, 'medium')
    assert.deepEqual(
      plan.steps.map((step) => step.id),
      ['review', 'task-1', 'task-2', 'apply', 'verify']
    )
    assert.equal(plan.steps[1].label, 'Write the endpoint')

    await assert.rejects(
      () =>
        createPlan(
          v1Proposal({ risks: [{ severity: 'low' }] })
        ),
      /Invalid plan risk/
    )
  })

  it('enforces the step transition map', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())

    await assert.rejects(
      () => setStepState(plan.id, 'review', 'completed'),
      /cannot move from pending to completed/
    )
    await assert.rejects(
      () => setStepState(plan.id, 'review', 'done'),
      /Invalid step state/
    )
    await assert.rejects(
      () => setStepState(plan.id, 'nope', 'in_progress'),
      /Plan step not found/
    )

    const started = await setStepState(plan.id, 'review', 'in_progress')

    assert.equal(
      started.steps.find((step) => step.id === 'review').state,
      'in_progress'
    )
    assert.ok(started.steps.find((step) => step.id === 'review').startedAt)

    const done = await setStepState(plan.id, 'review', 'completed', 'Looks good.')

    assert.equal(
      done.steps.find((step) => step.id === 'review').state,
      'completed'
    )
    assert.equal(
      done.steps.find((step) => step.id === 'review').detail,
      'Looks good.'
    )

    await assert.rejects(
      () => setStepState(plan.id, 'review', 'failed'),
      /cannot move from completed to failed/
    )

    // Rework is explicit and honest: back to in_progress, finish cleared.
    const rework = await setStepState(plan.id, 'review', 'in_progress')

    assert.equal(
      rework.steps.find((step) => step.id === 'review').finishedAt,
      null
    )
  })

  it('refuses verified steps without a passing report', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())

    await setStepState(plan.id, 'verify', 'in_progress')
    await assert.rejects(
      () => setStepState(plan.id, 'verify', 'verified'),
      /without a passing verification report/
    )

    const run = await runDiagnostics('node --version')

    const { report } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'pass',
      executionRunId: run.diagnosis.runId,
    })

    assert.equal(report.result, 'pass')
    assert.equal(report.conclusion, 'passed')
    assert.equal(report.liveProvider, false)
    assert.equal(report.origin, 'command')

    const verified = await setStepState(plan.id, 'verify', 'verified')

    assert.equal(
      verified.steps.find((step) => step.id === 'verify').state,
      'verified'
    )
    assert.equal(verified.verification, 'verified')
  })

  it('persists the observed diagnosis on verification reports', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())
    const run = await runDiagnostics(
      'node -e "console.log(\'not ok 1 - adds\'); process.exit(1)"'
    )

    const { report } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'fail',
      executionRunId: run.diagnosis.runId,
      diagnosis: run.diagnosis,
    })

    // The diagnosis rides along but never flips the result.
    assert.equal(report.result, 'fail')
    assert.equal(report.conclusion, 'failed')
    assert.equal(report.diagnosis.status, 'failed')
    assert.equal(report.diagnosis.findings[0].category, 'assertion_failure')

    const loaded = await getPlan(plan.id)
    const stored = loaded.reports.find((entry) => entry.id === report.id)

    assert.equal(stored.diagnosis.runId, run.diagnosis.runId)
    assert.deepEqual(stored.diagnosis.findings, run.diagnosis.findings)

    // Reports without a caller diagnosis still carry the observed
    // one: facts come from the run, not the payload.
    const passing = await runDiagnostics('node --version')
    const { report: plain } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'lint',
      result: 'pass',
      executionRunId: passing.diagnosis.runId,
    })

    assert.equal(plain.diagnosis.runId, passing.diagnosis.runId)

    // A corrupt diagnosis rejects the report instead of persisting.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: run.diagnosis.runId,
          diagnosis: { ...run.diagnosis, status: 'gremlins' },
        }),
      /Invalid verification diagnosis/
    )

    // A diagnosis naming a different run is rejected as mixed
    // evidence.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: run.diagnosis.runId,
          diagnosis: passing.diagnosis,
        }),
      /does not match the observed execution/
    )
  })

  it('links verification reports to repair attempts', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())
    const repair = {
      cycleId: 'rc-abc123-def456',
      attempt: 1,
      attemptId: 'rc-abc123-def456-a1',
    }

    const run = await runDiagnostics('node -e "process.exit(1)"')

    const { report } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'fail',
      executionRunId: run.diagnosis.runId,
      repair,
    })

    // Linkage without checkpoint/files defaults honestly.
    assert.deepEqual(report.repair, {
      ...repair,
      checkpointId: null,
      appliedFiles: [],
    })

    const loaded = await getPlan(plan.id)
    const stored = loaded.reports.find((entry) => entry.id === report.id)

    assert.deepEqual(stored.repair, {
      ...repair,
      checkpointId: null,
      appliedFiles: [],
    })

    // Reports without linkage (legacy + adhoc) load with null.
    const passing = await runDiagnostics('node --version')
    const { report: plain } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'lint',
      result: 'pass',
      executionRunId: passing.diagnosis.runId,
    })

    assert.equal(plain.repair, null)

    // Inconsistent linkage is rejected, not stored.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: run.diagnosis.runId,
          repair: { ...repair, attemptId: 'rc-other-a1' },
        }),
      /Invalid verification repair linkage/
    )
  })

  it('links verification reports to repair checkpoints and changed files', async () => {
    const root = await openWorkspace()

    const plan = await createPlan(v1Proposal())
    const run = await runDiagnostics('node -e "process.exit(1)"')
    const repair = {
      cycleId: 'rc-abc123-def456',
      attempt: 1,
      attemptId: 'rc-abc123-def456-a1',
      checkpointId: 'cp-abc123-def456',
      appliedFiles: ['src/broken.ts', 'src/other.ts'],
    }

    const { report } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'fail',
      executionRunId: run.diagnosis.runId,
      repair,
    })

    assert.deepEqual(report.repair, repair)

    const loaded = await getPlan(plan.id)
    const stored = loaded.reports.find((entry) => entry.id === report.id)

    assert.deepEqual(stored.repair, repair)

    // Forged checkpoint and file linkage is rejected, not stored.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: run.diagnosis.runId,
          repair: { ...repair, checkpointId: '../evil' },
        }),
      /Invalid verification repair linkage/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: run.diagnosis.runId,
          repair: { ...repair, appliedFiles: ['ok.ts', ''] },
        }),
      /Invalid verification repair linkage/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: run.diagnosis.runId,
          repair: { ...repair, appliedFiles: new Array(21).fill('x.ts') },
        }),
      /Invalid verification repair linkage/
    )

    // Linkage written before 3B.5 (no checkpoint/files) loads with
    // null/empty instead of failing.
    await writeStorageFile(
      root,
      [...PLANS_SEGMENTS, plan.id, 'reports', 'vr-old-repair.json'],
      JSON.stringify({
        version: 1,
        id: 'vr-old-repair',
        planId: plan.id,
        stepId: 'verify',
        check: 'legacy repair',
        result: 'fail',
        exitCode: 1,
        timedOut: false,
        outputSummary: '',
        at: new Date().toISOString(),
        liveProvider: false,
        origin: 'command',
        repair: {
          cycleId: 'rc-abc123-def456',
          attempt: 1,
          attemptId: 'rc-abc123-def456-a1',
        },
      })
    )

    const reloaded = await getPlan(plan.id)
    const old = reloaded.reports.find((entry) => entry.id === 'vr-old-repair')

    assert.equal(old.repair.checkpointId, null)
    assert.deepEqual(old.repair.appliedFiles, [])
  })

  it('records truthful conclusions from observed executions', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())
    const passing = await runDiagnostics('node --version')
    const failing = await runDiagnostics('node -e "process.exit(3)"')

    const { report: passReport } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'node version',
      result: 'pass',
      executionRunId: passing.diagnosis.runId,
    })

    assert.equal(passReport.conclusion, 'passed')
    assert.equal(passReport.result, 'pass')
    assert.equal(passReport.legacyProvenance, false)
    assert.equal(passReport.exitCode, 0)
    assert.equal(passReport.timedOut, false)
    assert.equal(passReport.execution.runId, passing.diagnosis.runId)
    assert.equal(passReport.execution.command, 'node --version')
    assert.equal(passReport.execution.source, 'diagnostics')
    assert.ok(passReport.execution.startedAt)
    assert.ok(passReport.execution.completedAt)
    assert.equal(passReport.diagnosis.status, 'passed')
    assert.equal(passReport.modelExplanation, null)

    const { report: failReport } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'exit three',
      result: 'fail',
      executionRunId: failing.diagnosis.runId,
    })

    assert.equal(failReport.conclusion, 'failed')
    assert.equal(failReport.result, 'fail')
    assert.equal(failReport.exitCode, 3)
    assert.equal(failReport.execution.runId, failing.diagnosis.runId)
  })

  it('rejects claims that contradict the observed execution', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())
    const passing = await runDiagnostics('node --version')
    const failing = await runDiagnostics('node -e "process.exit(3)"')

    // A model claiming success while the command failed.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'pass',
          executionRunId: failing.diagnosis.runId,
        }),
      /does not match the observed execution/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: passing.diagnosis.runId,
        }),
      /does not match the observed execution/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'error',
          executionRunId: passing.diagnosis.runId,
        }),
      /does not match the observed execution/
    )

    // Exit-code and timeout mismatches.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: failing.diagnosis.runId,
          exitCode: 0,
        }),
      /exit code does not match/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: failing.diagnosis.runId,
          timedOut: true,
        }),
      /timeout flag does not match/
    )

    // Forged and malformed run ids.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'pass',
          executionRunId: 'dg-forged-00000000',
        }),
      /not observed in this session/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'pass',
          executionRunId: 'nope',
        }),
      /Invalid verification run id/
    )

    // Nothing was persisted by the rejected claims.
    const loaded = await getPlan(plan.id)

    assert.deepEqual(loaded.reports, [])
  })

  it('rejects passing or failing reports without an observed execution', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())

    // A model claiming tests ran when they never executed.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'pass',
          exitCode: 0,
          output: 'all green, trust me',
        }),
      /requires an observed execution/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          output: 'not ok',
        }),
      /requires an observed execution/
    )

    // Exit facts cannot be claimed without an execution.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'error',
          exitCode: 1,
          output: 'broke',
        }),
      /cannot be claimed without an observed execution/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'error',
          timedOut: true,
          output: 'slow',
        }),
      /cannot be claimed without an observed execution/
    )
  })

  it('records skipped, blocked, and not-executed checks distinctly', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())
    await setStepState(plan.id, 'verify', 'in_progress')

    const { report: skipped } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'slow e2e',
      result: 'skip',
      output: 'Skipped by the user: e2e runs in CI only.',
    })

    assert.equal(skipped.conclusion, 'skipped')
    assert.equal(skipped.result, 'error')
    assert.equal(skipped.execution, null)
    assert.equal(skipped.diagnosis, null)
    assert.equal(skipped.exitCode, null)
    assert.match(skipped.outputSummary, /Skipped by the user/)

    const { report: blocked } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'error',
      output: 'Diagnostics failed to start: no project is open.',
      markStep: 'blocked',
    })

    assert.equal(blocked.conclusion, 'blocked')
    assert.equal(blocked.execution, null)

    const { report: neverRan } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'manual review',
      result: 'not_executed',
      output: 'Planned but never run before the plan completed.',
    })

    assert.equal(neverRan.conclusion, 'not_executed')

    const loaded = await getPlan(plan.id)

    assert.equal(
      loaded.steps.find((step) => step.id === 'verify').state,
      'blocked'
    )

    // Non-execution claims need a stated reason and cannot cite a
    // run, attach a diagnosis, or move the step to verified/failed.
    const run = await runDiagnostics('node --version')

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'x',
          result: 'skip',
        }),
      /requires a stated reason/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'x',
          result: 'skip',
          executionRunId: run.diagnosis.runId,
          output: 'reason',
        }),
      /cannot cite an execution/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'x',
          result: 'skip',
          output: 'reason',
          diagnosis: run.diagnosis,
        }),
      /without an observed execution/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'x',
          result: 'skip',
          output: 'reason',
          markStep: 'failed',
        }),
      /can fail a step/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'x',
          result: 'skip',
          output: 'reason',
          markStep: 'verified',
        }),
      /Only a passing check can verify/
    )
  })

  it('keeps skipped and blocked checks from failing the plan', async () => {
    await openWorkspace()

    const skipped = await createPlan(v1Proposal())

    await recordVerification({
      planId: skipped.id,
      stepId: 'verify',
      check: 'slow e2e',
      result: 'skip',
      output: 'Skipped by the user.',
    })

    assert.equal((await getPlan(skipped.id)).verification, 'unverified')

    const blocked = await createPlan(v1Proposal())

    await recordVerification({
      planId: blocked.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'error',
      output: 'Diagnostics failed to start.',
    })

    assert.equal((await getPlan(blocked.id)).verification, 'unverified')

    // Executed failures still fail the plan.
    const failed = await createPlan(v1Proposal())
    const run = await runDiagnostics('node -e "process.exit(1)"')

    await recordVerification({
      planId: failed.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'fail',
      executionRunId: run.diagnosis.runId,
    })

    assert.equal((await getPlan(failed.id)).verification, 'failed')
  })

  it('records cancelled executions honestly', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())
    const controller = new AbortController()
    const pending = runDiagnostics('node -e "setTimeout(() => {}, 30000)"', {
      signal: controller.signal,
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort()

    const run = await pending

    assert.equal(run.cancelled, true)

    const { report } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'slow suite',
      result: 'error',
      executionRunId: run.diagnosis.runId,
    })

    assert.equal(report.conclusion, 'cancelled')
    assert.equal(report.result, 'error')
    assert.equal(report.execution.cancelled, true)

    // A cancelled run can never back a passing report.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'slow suite',
          result: 'pass',
          executionRunId: run.diagnosis.runId,
        }),
      /does not match the observed execution/
    )
  })

  it('records timed-out executions honestly', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())
    const run = await runDiagnostics('node -e "setTimeout(() => {}, 30000)"', {
      timeoutMs: 300,
    })

    assert.equal(run.timedOut, true)
    assert.equal(run.diagnosis.status, 'timeout')

    const { report } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'slow suite',
      result: 'error',
      executionRunId: run.diagnosis.runId,
    })

    assert.equal(report.conclusion, 'timed_out')
    assert.equal(report.result, 'error')
    assert.equal(report.execution.timedOut, true)
    assert.equal(report.execution.cancelled, false)
    assert.equal(report.diagnosis.status, 'timeout')

    // A timed-out run can never back a passing report, and a
    // timed-out check cannot verify a step.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'slow suite',
          result: 'pass',
          executionRunId: run.diagnosis.runId,
        }),
      /does not match the observed execution/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'slow suite',
          result: 'error',
          executionRunId: run.diagnosis.runId,
          markStep: 'verified',
        }),
      /Only a passing check can verify/
    )

    await assert.rejects(
      () => runDiagnostics('node --version', { timeoutMs: 0 }),
      /Invalid diagnostics timeout/
    )
  })

  it('stores model explanations as display-only interpretation', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())
    const run = await runDiagnostics('node -e "process.exit(1)"')

    const { report } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'fail',
      executionRunId: run.diagnosis.runId,
      modelExplanation: {
        summary: 'Tests pass on my machine, ship it.',
        failureAnalysis: 'Analysis with Bearer abcdefghijklmnop inside.',
        suggestedNextSteps: 'Run npm test again.',
      },
    })

    // The explanation is stored but never flips the conclusion.
    assert.equal(report.conclusion, 'failed')
    assert.equal(report.modelExplanation.summary, 'Tests pass on my machine, ship it.')
    assert.ok(
      !JSON.stringify(report.modelExplanation).includes('abcdefghijklmnop')
    )
    assert.ok(report.modelExplanation.failureAnalysis.includes('[redacted]'))

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: run.diagnosis.runId,
          modelExplanation: { summary: '' },
        }),
      /Invalid verification model explanation/
    )

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: run.diagnosis.runId,
          modelExplanation: 'looks good',
        }),
      /Invalid verification model explanation/
    )
  })

  it('loads legacy reports with derived conclusions and provenance flags', async () => {
    const root = await openWorkspace()
    const plan = await createPlan(v1Proposal())
    const observed = await runDiagnostics('node -e "process.exit(1)"')

    const seed = async (id, fields) => {
      await writeStorageFile(
        root,
        [...PLANS_SEGMENTS, plan.id, 'reports', `${id}.json`],
        JSON.stringify({
          version: 1,
          id,
          planId: plan.id,
          stepId: 'verify',
          check: 'legacy',
          outputSummary: '',
          at: new Date().toISOString(),
          liveProvider: false,
          origin: 'command',
          ...fields,
        })
      )
    }

    await seed('vr-legacy-pass', { result: 'pass', exitCode: 0, timedOut: false })
    await seed('vr-legacy-fail', { result: 'fail', exitCode: 1, timedOut: false })
    await seed('vr-legacy-diagnosed', {
      result: 'fail',
      exitCode: 1,
      timedOut: false,
      diagnosis: observed.diagnosis,
    })
    await seed('vr-legacy-timeout', { result: 'error', exitCode: null, timedOut: true })
    await seed('vr-legacy-error', { result: 'error', exitCode: null, timedOut: false })

    const loaded = await getPlan(plan.id)
    const byId = new Map(loaded.reports.map((entry) => [entry.id, entry]))

    assert.equal(byId.get('vr-legacy-pass').conclusion, 'passed')
    assert.equal(byId.get('vr-legacy-fail').conclusion, 'failed')
    assert.equal(byId.get('vr-legacy-diagnosed').conclusion, 'failed')
    assert.equal(byId.get('vr-legacy-timeout').conclusion, 'timed_out')
    assert.equal(byId.get('vr-legacy-error').conclusion, 'not_executed')

    for (const report of loaded.reports) {
      assert.equal(report.legacyProvenance, true)
      assert.equal(report.execution, null)
    }
  })

  it('recovers past tampered and interrupted report files', async () => {
    const root = await openWorkspace()
    const plan = await createPlan(v1Proposal())
    const run = await runDiagnostics('node --version')

    const { report } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'node version',
      result: 'pass',
      executionRunId: run.diagnosis.runId,
    })

    // A flipped stored conclusion without matching facts.
    await writeStorageFile(
      root,
      [...PLANS_SEGMENTS, plan.id, 'reports', 'vr-tampered.json'],
      JSON.stringify({
        ...JSON.parse(
          (await readStorageFile(root, [...PLANS_SEGMENTS, plan.id, 'reports', `${report.id}.json`])).data
        ),
        id: 'vr-tampered',
        conclusion: 'failed',
      })
    )

    // An interrupted (truncated) write from a crash.
    await writeStorageFile(
      root,
      [...PLANS_SEGMENTS, plan.id, 'reports', 'vr-partial.json'],
      '{"version": 1, "id": "vr-partial", "planId":'
    )

    const loaded = await getPlan(plan.id)

    assert.deepEqual(
      loaded.reports.map((entry) => entry.id),
      [report.id]
    )
  })

  it('allows duplicate citations of one run without corrupting linkage', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())
    const run = await runDiagnostics('node -e "process.exit(1)"')

    const first = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'fail',
      executionRunId: run.diagnosis.runId,
    })
    const second = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'npm test again',
      result: 'fail',
      executionRunId: run.diagnosis.runId,
    })

    // Both cite the same observed run; each stays internally
    // consistent (the UI busy-guards against accidental doubles).
    assert.notEqual(first.report.id, second.report.id)
    assert.equal(first.report.execution.runId, second.report.execution.runId)
    assert.equal(first.report.diagnosis.runId, run.diagnosis.runId)
    assert.equal(second.report.conclusion, 'failed')
  })

  it('rejects stale evicted run ids', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())
    const first = await runDiagnostics('node --version')

    for (let index = 0; index < 50; index += 1) {
      await runDiagnostics('node --version')
    }

    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'pass',
          executionRunId: first.diagnosis.runId,
        }),
      /not observed in this session/
    )

    const fresh = await runDiagnostics('node --version')
    const { report } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'pass',
      executionRunId: fresh.diagnosis.runId,
    })

    assert.equal(report.conclusion, 'passed')
  })

  it('records verification failures without losing progress', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())

    await setStepState(plan.id, 'review', 'in_progress')
    await setStepState(plan.id, 'review', 'completed')
    await setStepState(plan.id, 'apply', 'in_progress')
    await setStepState(plan.id, 'apply', 'completed')
    await setStepState(plan.id, 'verify', 'in_progress')

    const run = await runDiagnostics(
      'node -e "console.log(\'FAIL x\'); console.log(\'Authorization: Bearer abcdefghijklmnop\'); process.exit(1)"'
    )

    const { report, plan: failed } = await recordVerification({
      planId: plan.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'fail',
      executionRunId: run.diagnosis.runId,
      markStep: 'failed',
    })

    assert.equal(report.result, 'fail')
    assert.equal(report.conclusion, 'failed')
    assert.ok(report.outputSummary.length <= 4000)
    assert.ok(!report.outputSummary.includes('abcdefghijklmnop'))
    assert.ok(report.outputSummary.includes('[redacted]'))

    const verify = failed.steps.find((step) => step.id === 'verify')

    assert.equal(verify.state, 'failed')
    assert.equal(verify.evidence.length, 1)
    assert.equal(verify.evidence[0].kind, 'report')
    assert.equal(failed.verification, 'failed')

    // Earlier completed work is untouched.
    assert.equal(
      failed.steps.find((step) => step.id === 'apply').state,
      'completed'
    )

    // A failing check can never verify, and retry is explicit.
    await assert.rejects(
      () =>
        recordVerification({
          planId: plan.id,
          stepId: 'verify',
          check: 'npm test',
          result: 'fail',
          executionRunId: run.diagnosis.runId,
          markStep: 'verified',
        }),
      /Only a passing check can verify/
    )

    const retried = await setStepState(plan.id, 'verify', 'in_progress')

    assert.equal(
      retried.steps.find((step) => step.id === 'verify').state,
      'in_progress'
    )
  })

  it('attaches evidence with validated references', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())

    const noted = await attachEvidence(plan.id, 'apply', {
      kind: 'note',
      ref: 'checkpoint-cp-123',
      summary: 'Pre-apply snapshot.',
    })

    assert.equal(noted.steps.find((step) => step.id === 'apply').evidence.length, 1)

    await assert.rejects(
      () => attachEvidence(plan.id, 'apply', { kind: 'url', ref: 'x' }),
      /Invalid evidence kind/
    )
    await assert.rejects(
      () =>
        attachEvidence(plan.id, 'apply', {
          kind: 'report',
          ref: 'vr-missing',
        }),
      /Verification report not found/
    )
  })

  it('cancels active work and completes only finished plans', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())

    await setStepState(plan.id, 'review', 'in_progress')
    await setStepState(plan.id, 'review', 'completed')
    await setStepState(plan.id, 'apply', 'in_progress')

    await assert.rejects(
      () => completePlan(plan.id),
      /open step\(s\): apply, verify/
    )

    const cancelled = await cancelPlan(plan.id, 'User stopped it.')

    assert.equal(cancelled.status, 'cancelled')
    assert.equal(
      cancelled.steps.find((step) => step.id === 'review').state,
      'completed'
    )
    assert.equal(
      cancelled.steps.find((step) => step.id === 'apply').state,
      'cancelled'
    )
    assert.equal(
      cancelled.steps.find((step) => step.id === 'verify').state,
      'cancelled'
    )

    // Terminal plans are locked and cancel is idempotent.
    await assert.rejects(
      () => setStepState(plan.id, 'apply', 'in_progress'),
      /Plan is cancelled/
    )

    const again = await cancelPlan(plan.id)

    assert.equal(again.status, 'cancelled')

    const done = await createPlan(v1Proposal({ task: 'Finish me.' }))

    await setStepState(done.id, 'review', 'in_progress')
    await setStepState(done.id, 'review', 'completed')
    await setStepState(done.id, 'apply', 'in_progress')
    await setStepState(done.id, 'apply', 'completed')
    await setStepState(done.id, 'verify', 'in_progress')
    const doneRun = await runDiagnostics('node --version')

    await recordVerification({
      planId: done.id,
      stepId: 'verify',
      check: 'npm test',
      result: 'pass',
      executionRunId: doneRun.diagnosis.runId,
      markStep: 'verified',
    })

    const completed = await completePlan(done.id)

    assert.equal(completed.status, 'completed')
  })

  it('flags interrupted steps after restart instead of completing them', async () => {
    await openWorkspace()

    const plan = await createPlan(v1Proposal())

    await setStepState(plan.id, 'apply', 'in_progress')

    const restarted = freshPlanStore()
    const loaded = await restarted.getPlan(plan.id)
    const apply = loaded.steps.find((step) => step.id === 'apply')

    assert.equal(apply.state, 'in_progress')
    assert.equal(apply.interrupted, true)

    // Explicit resume (user-confirmed) clears the flag; nothing else does.
    const resumed = await restarted.resumePlan(plan.id)

    assert.equal(
      resumed.steps.find((step) => step.id === 'apply').interrupted,
      false
    )

    const restartedAgain = freshPlanStore()
    const blocked = await restartedAgain.setStepState(
      plan.id,
      'apply',
      'blocked',
      'Waiting on review.'
    )

    assert.equal(
      blocked.steps.find((step) => step.id === 'apply').state,
      'blocked'
    )
  })

  it('isolates plans per project and rejects bad ids', async () => {
    const rootA = await openWorkspace('kryom-plan-a-')
    const created = await createPlan(v1Proposal({ task: 'Project A.' }))

    await openWorkspace('kryom-plan-b-')

    assert.deepEqual((await listPlans()).plans, [])
    await assert.rejects(() => getPlan(created.id), /Plan not found/)
    await assert.rejects(
      () => setStepState('../x', 'review', 'in_progress'),
      /Invalid plan id/
    )

    const { found } = await (async () => {
      const {
        readStorageFile,
      } = require('../../security/storage-path.cjs')

      return readStorageFile(rootA, [
        ...PLANS_SEGMENTS,
        created.id,
        'plan.json',
      ])
    })()

    assert.equal(found, true)
  })

  it('requires an open project', async () => {
    const { closeWorkspace } = require('../workspace/workspace.service.cjs')

    await openWorkspace()
    await closeWorkspace()

    await assert.rejects(() => listPlans(), /Open a project/)
    await assert.rejects(() => getPlan(newPlanId()), /Open a project/)
    await assert.rejects(() => createPlan(v1Proposal()), /Open a project/)
    await assert.rejects(
      () => setStepState(newPlanId(), 'review', 'in_progress'),
      /Open a project/
    )
    await assert.rejects(
      () => cancelPlan(newPlanId()),
      /Open a project/
    )
  })

  it('reports corrupt stored plans without breaking the list', async () => {
    const root = await openWorkspace()

    const good = await createPlan(v1Proposal({ task: 'Survivor.' }))

    await writeStorageFile(
      root,
      [...PLANS_SEGMENTS, 'pl-rotten', 'plan.json'],
      '{"version":2,"id":"pl-rotten"'
    )
    await writeStorageFile(
      root,
      [...PLANS_SEGMENTS, 'pl-old', 'plan.json'],
      JSON.stringify({ version: 1, id: 'pl-old' })
    )

    const listed = await listPlans()

    assert.deepEqual(
      listed.plans.map((plan) => plan.id),
      [good.id]
    )
    assert.deepEqual(listed.corrupt, ['pl-old', 'pl-rotten'])

    await assert.rejects(() => getPlan('pl-rotten'), /corrupt/)
    assert.throws(() => sanitizeRecord(null), /corrupt/)
    assert.throws(
      () => normalizeProposal(v1Proposal({ risks: 'many' })),
      /Invalid plan risks/
    )
  })

  it('bounds stored plans and reports', async () => {
    await openWorkspace()

    const ids = []

    for (let index = 0; index < MAX_PLANS + 1; index += 1) {
      const plan = await createPlan(v1Proposal({ task: `Plan ${index}.` }))

      ids.push(plan.id)
      await cancelPlan(plan.id)
    }

    const listed = await listPlans()

    assert.equal(listed.plans.length, MAX_PLANS)
    assert.ok(!listed.plans.some((plan) => plan.id === ids[0]))

    // Active work is never pruned to make room.
    const active = await createPlan(v1Proposal({ task: 'Stay alive.' }))
    const relisted = await listPlans()

    assert.ok(relisted.plans.some((plan) => plan.id === active.id))

    for (let index = 0; index < 50; index += 1) {
      await attachEvidence(active.id, 'review', {
        kind: 'note',
        ref: `note-${index}`,
      })
    }

    await assert.rejects(
      () =>
        attachEvidence(active.id, 'review', { kind: 'note', ref: 'overflow' }),
      /Step evidence is full/
    )
    await assert.rejects(
      () =>
        recordVerification({
          planId: active.id,
          stepId: 'review',
          check: 'late',
          result: 'pass',
        }),
      /Step evidence is full/
    )

    // Seed 51 report files directly (fast), then one API write must
    // prune the oldest back to the cap.
    const root = await openWorkspace('kryom-plan-seed-')
    const seeded = await createPlan(v1Proposal({ task: 'Seeded.' }))

    for (let index = 0; index < 51; index += 1) {
      const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()

      await writeStorageFile(
        root,
        [...PLANS_SEGMENTS, seeded.id, 'reports', `vr-seed-${index}.json`],
        JSON.stringify({
          version: 1,
          id: `vr-seed-${index}`,
          planId: seeded.id,
          stepId: 'verify',
          check: `seed-${index}`,
          result: 'pass',
          exitCode: 0,
          timedOut: false,
          outputSummary: '',
          at: stamp,
          liveProvider: false,
          origin: 'command',
        })
      )
    }

    const triggerRun = await runDiagnostics('node --version')

    await recordVerification({
      planId: seeded.id,
      stepId: 'verify',
      check: 'trigger',
      result: 'pass',
      executionRunId: triggerRun.diagnosis.runId,
    })

    const loaded = await getPlan(seeded.id)

    assert.equal(loaded.reports.length, 50)
    assert.ok(loaded.reports.every((report) => report.planId === seeded.id))
    assert.ok(!loaded.reports.some((report) => report.id === 'vr-seed-0'))
    assert.ok(loaded.reports.some((report) => report.check === 'trigger'))
  })

  it('persists context snapshots with freshness statuses', async () => {
    const root = await openWorkspace()
    const { buildContextSnapshot } = require('./context-snapshot.cjs')
    const { createSession } = require('../research/session-store.cjs')

    await fs.writeFile(path.join(root, 'keep.ts'), 'same\n')

    const session = await createSession('Context plan.')
    const snapshot = await buildContextSnapshot({
      files: [{ relativePath: 'keep.ts', bytes: 5, content: 'same\n' }],
      researchSessionId: session.id,
      includeChat: false,
      workspaceBrief: 'Project type: node.',
      projectName: path.basename(root),
    })

    const plan = await createPlan({ ...v1Proposal(), contextSnapshot: snapshot })

    assert.equal(plan.context.files[0].status, 'current')
    assert.equal(plan.context.research.freshness, 'current')
    assert.equal(plan.context.workspace.status, 'reference')

    // Sources are preserved as review-step evidence.
    const kinds = plan.steps[0].evidence.map((item) => item.kind).sort()

    assert.deepEqual(kinds, ['file', 'research'])
    assert.equal(plan.verification, 'unverified')

    await fs.writeFile(path.join(root, 'keep.ts'), 'changed content here\n')

    const stale = await getPlan(plan.id)

    assert.equal(stale.context.files[0].status, 'stale')

    // Cross-project reads degrade honestly: the file is absent here.
    await openWorkspace('kryom-plan-ctx-b-')

    await assert.rejects(() => getPlan(plan.id), /Plan not found/)
  })

  it('tolerates legacy plans without context and rejects malformed snapshots', async () => {
    const root = await openWorkspace()

    const legacy = await createPlan(v1Proposal())

    assert.equal(legacy.context, null)

    await assert.rejects(
      () =>
        createPlan({
          ...v1Proposal(),
          contextSnapshot: { at: 'now', files: [{ relativePath: '../../evil' }] },
        }),
      /Invalid context snapshot/
    )

    await writeStorageFile(
      root,
      [...PLANS_SEGMENTS, legacy.id, 'plan.json'],
      JSON.stringify({
        version: 2,
        id: legacy.id,
        projectName: 'x',
        title: 't',
        objective: 'o',
        expectedOutcome: '',
        risks: [],
        steps: [
          {
            id: 'review',
            kind: 'review',
            label: 'Review plan',
            state: 'pending',
            startedAt: null,
            finishedAt: null,
            detail: '',
            evidence: [],
          },
        ],
        proposal: {
          model: 'm',
          task: 'o',
          edits: [],
          commands: [],
          notes: '',
        },
        context: { at: 'now', projectName: 'x', files: 'nope' },
        status: 'active',
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
      })
    )

    await assert.rejects(() => getPlan(legacy.id), /corrupt/)
  })

  it('never treats context evidence as verification', async () => {
    await openWorkspace()

    const { buildContextSnapshot } = require('./context-snapshot.cjs')
    const snapshot = await buildContextSnapshot({
      files: [{ relativePath: 'a.ts', bytes: 3, content: 'abc' }],
      researchSessionId: null,
      includeChat: false,
      workspaceBrief: 'brief',
      projectName: 'proj',
    })

    const plan = await createPlan({ ...v1Proposal(), contextSnapshot: snapshot })

    assert.ok(plan.steps[0].evidence.length > 0)
    assert.equal(plan.verification, 'unverified')

    await setStepState(plan.id, 'verify', 'in_progress')
    await assert.rejects(
      () => setStepState(plan.id, 'verify', 'verified'),
      /without a passing verification report/
    )
  })
})
