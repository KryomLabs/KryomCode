// Repair cycle tests (Level 3B.4): backend-orchestrated bounded
// repair with a fixed attempt cap, a non-resetting time budget,
// durable attempt records, and safe stop conditions. The model is a
// MockProvider; no network, no Meta calls.
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
const { MockProvider } = require('../ai/providers/mock.provider.cjs')
const {
  createPlan,
  getPlan,
} = require('./plan-store.cjs')
const { undoCheckpoint } = require('./checkpoint-store.cjs')
const { diagnoseRun } = require('../diagnostics/diagnosis.cjs')
const { runDiagnostics } = require('../diagnostics/diagnostics.service.cjs')
const {
  MAX_REPAIR_ATTEMPTS,
  REPAIR_BUDGET_MS,
  startRepairCycle,
  proposeRepair,
  applyRepair,
  recordRepair,
  cancelRepair,
  getRepairCycle,
} = require('./repair.service.cjs')

function useTestKey() {
  const saved = process.env.MODEL_API_KEY

  process.env.MODEL_API_KEY = 'test-key'

  return () => {
    if (saved === undefined) {
      delete process.env.MODEL_API_KEY
    } else {
      process.env.MODEL_API_KEY = saved
    }
  }
}

async function openWorkspace(prefix = 'kryom-repair-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))

  await setWorkspaceRoot(root)

  return root
}

async function makePlan(task = 'Fix the build.') {
  return createPlan({
    model: 'muse-spark-1.3',
    task,
    edits: [],
    commands: ['npm test'],
    notes: '',
  })
}

function failDiagnosis(overrides = {}) {
  return diagnoseRun({
    command: 'npm test',
    exitCode: 1,
    timedOut: false,
    cancelled: false,
    output: 'not ok 1 - adds\n',
    diagnostics: [],
    durationMs: 800,
    provenance: 'executed',
    planId: null,
    stepId: null,
    ...overrides,
  })
}

async function passingRun() {
  return runDiagnostics('node --version')
}

async function failingRun() {
  return runDiagnostics(
    'node -e "console.log(\'not ok 1 - adds\'); process.exit(1)"'
  )
}

function fixProvider(target, content) {
  return new MockProvider({
    answer: JSON.stringify({
      edits: [{ path: target, action: 'modify', content, reason: 'Fix it.' }],
      commands: [],
      notes: '',
    }),
  })
}

async function startCycle(plan, overrides = {}, options = {}) {
  const { cycle } = await startRepairCycle(
    {
      planId: plan.id,
      check: 'npm test',
      diagnosis: failDiagnosis(),
      ...overrides,
    },
    options
  )

  return cycle
}

describe('repair.service', () => {
  it('exposes a two-attempt cap and a fixed ten-minute budget', () => {
    assert.equal(MAX_REPAIR_ATTEMPTS, 2)
    assert.equal(REPAIR_BUDGET_MS, 600000)
  })

  it('rejects invalid start requests without persisting', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      const plan = await makePlan()

      await assert.rejects(
        () => startRepairCycle({ planId: 'pl-nope-nope', check: 'npm test' }),
        /not found|Invalid plan/i
      )
      await assert.rejects(
        () => startRepairCycle({ planId: plan.id, check: 'npm test', stepId: 'nope' }),
        /Invalid repair step/
      )
      await assert.rejects(
        () => startRepairCycle({ planId: plan.id, check: '' }),
        /Invalid repair check/
      )
      await assert.rejects(
        () =>
          startRepairCycle({
            planId: plan.id,
            check: 'npm test',
            diagnosis: { status: 'gremlins' },
          }),
        /Invalid repair diagnosis/
      )
    } finally {
      restore()
    }
  })

  it('runs a full repair cycle to a passing verification', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()
      const started = await startCycle(plan)

      assert.equal(started.state, 'awaiting-proposal')
      assert.equal(started.remainingAttempts, 2)
      assert.ok(started.remainingMs > 0)
      assert.match(started.id, /^rc-/)

      const { cycle: proposed, proposal } = await proposeRepair(
        { cycleId: started.id },
        { provider: fixProvider(target, 'fixed\n') }
      )

      assert.equal(proposed.state, 'awaiting-approval')
      assert.equal(proposed.attempts.length, 1)
      assert.equal(proposal.edits.length, 1)

      const { cycle: applied, apply } = await applyRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        edits: proposal.edits,
      })

      assert.equal(apply.completed, true)
      assert.equal(applied.state, 'awaiting-verification')
      assert.ok(applied.attempts[0].checkpointId)
      assert.deepEqual(applied.attempts[0].appliedFiles, [target])
      assert.equal(await fs.readFile(target, 'utf8'), 'fixed\n')

      const pass = await passingRun()
      const { cycle: recorded, report } = await recordRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        executionRunId: pass.diagnosis.runId,
      })

      assert.equal(recorded.state, 'passed')
      assert.equal(recorded.stopReason, 'passed')
      assert.equal(recorded.remainingAttempts, 0)
      assert.equal(report.result, 'pass')
      assert.equal(report.repair.cycleId, started.id)
      assert.equal(report.repair.attempt, 1)
      assert.equal(
        report.repair.checkpointId,
        applied.attempts[0].checkpointId
      )
      assert.deepEqual(report.repair.appliedFiles, [target])
      assert.equal(recorded.attempts[0].reportId, report.id)
      assert.ok(recorded.attempts[0].durationMs !== null)

      // The attempt checkpoint undoes through the normal path.
      const undone = await undoCheckpoint(applied.attempts[0].checkpointId)

      assert.equal(undone.restored.length, 1)
      assert.equal(await fs.readFile(target, 'utf8'), 'broken\n')

      // Terminal cycles reject further work, including forgeries.
      await assert.rejects(
        () => proposeRepair({ cycleId: started.id }, { provider: fixProvider(target, 'x') }),
        /Repair cycle is passed/
      )
    } finally {
      restore()
    }
  })

  it('exhausts the cap after two failed attempts', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()
      const started = await startCycle(plan)
      const failed = await failingRun()

      for (let n = 1; n <= 2; n += 1) {
        const { cycle: proposed, proposal } = await proposeRepair(
          { cycleId: started.id },
          { provider: fixProvider(target, `fix ${n}\n`) }
        )
        const { cycle: applied } = await applyRepair({
          cycleId: started.id,
          attemptId: proposed.attempts[n - 1].attemptId,
          edits: proposal.edits,
        })

        assert.equal(applied.state, 'awaiting-verification')

        const { cycle: recorded, report } = await recordRepair({
          cycleId: started.id,
          attemptId: proposed.attempts[n - 1].attemptId,
          executionRunId: failed.diagnosis.runId,
        })

        assert.equal(report.result, 'fail')
        assert.equal(report.repair.attempt, n)
        assert.equal(
          report.repair.checkpointId,
          applied.attempts[n - 1].checkpointId
        )
        assert.deepEqual(report.repair.appliedFiles, [target])

        if (n === 1) {
          assert.equal(recorded.state, 'awaiting-proposal')
          assert.equal(recorded.remainingAttempts, 1)
        } else {
          assert.equal(recorded.state, 'exhausted')
          assert.equal(recorded.stopReason, 'exhausted')
        }
      }

      // Both attempt reports stay linked and distinct.
      const loaded = await getPlan(plan.id)
      const linked = loaded.reports.filter(
        (entry) => entry.repair && entry.repair.cycleId === started.id
      )

      assert.equal(linked.length, 2)

      // A forged third proposal is rejected at the backend.
      await assert.rejects(
        () => proposeRepair({ cycleId: started.id }, { provider: fixProvider(target, 'x') }),
        /Repair cycle is exhausted/
      )
    } finally {
      restore()
    }
  })

  it('rejects duplicate and mismatched execution', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()
      const started = await startCycle(plan)
      const slow = fixProvider(target, 'fixed\n')

      slow.delayMs = 200

      // Two concurrent proposals: exactly one runs.
      const first = proposeRepair({ cycleId: started.id }, { provider: slow })
      const second = proposeRepair({ cycleId: started.id }, { provider: slow })

      const [won, lost] = await Promise.allSettled([first, second])
      const fulfilled = [won, lost].filter((entry) => entry.status === 'fulfilled')
      const rejected = [won, lost].filter((entry) => entry.status === 'rejected')

      assert.equal(fulfilled.length, 1)
      assert.equal(rejected.length, 1)
      assert.match(rejected[0].reason.message, /already running/)

      const after = await getRepairCycle(started.id)

      assert.equal(after.cycle.attempts.length, 1)

      // A forged attempt id cannot apply or record.
      await assert.rejects(
        () =>
          applyRepair({
            cycleId: started.id,
            attemptId: `${started.id}-a9`,
            edits: [],
          }),
        /does not match/
      )

      // A repeated propose while approval is pending is rejected.
      await assert.rejects(
        () => proposeRepair({ cycleId: started.id }, { provider: slow }),
        /cannot propose while awaiting-approval/
      )
    } finally {
      restore()
    }
  })

  it('expires overdue cycles and never reports expired success', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()

      // The deadline runs from creation: idling past it expires the
      // cycle even though no attempt ever ran.
      const idle = await startCycle(plan, {}, { budgetMs: 50 })

      await new Promise((resolve) => setTimeout(resolve, 150))
      await assert.rejects(
        () => proposeRepair({ cycleId: idle.id }, { provider: fixProvider(target, 'x') }),
        /time budget expired/
      )

      const expired = await getRepairCycle(idle.id)

      assert.equal(expired.cycle.state, 'expired')

      // A passing verification recorded after the deadline still
      // expires: success is never claimed on an overrun.
      const slow = await startCycle(plan, {}, { budgetMs: 400 })
      const { cycle: proposed, proposal } = await proposeRepair(
        { cycleId: slow.id },
        { provider: fixProvider(target, 'fixed\n') }
      )
      await applyRepair({
        cycleId: slow.id,
        attemptId: proposed.attempts[0].attemptId,
        edits: proposal.edits,
      })

      const pass = await passingRun()

      await new Promise((resolve) => setTimeout(resolve, 500))

      const { cycle: recorded, report } = await recordRepair({
        cycleId: slow.id,
        attemptId: proposed.attempts[0].attemptId,
        executionRunId: pass.diagnosis.runId,
      })

      assert.equal(recorded.state, 'expired')
      assert.equal(report.result, 'pass')
    } finally {
      restore()
    }
  })

  it('aborts a slow proposal at the deadline', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      const plan = await makePlan()
      const started = await startCycle(plan, {}, { budgetMs: 60 })
      const slow = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [], notes: '' }),
        delayMs: 5000,
      })

      await assert.rejects(
        () => proposeRepair({ cycleId: started.id }, { provider: slow }),
        /time budget expired/
      )

      const cycle = await getRepairCycle(started.id)

      assert.equal(cycle.cycle.state, 'expired')
      assert.equal(cycle.cycle.attempts.length, 0)
    } finally {
      restore()
    }
  })

  it('cancels cleanly at every workflow stage', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()

      // Before any proposal.
      const early = await startCycle(plan)
      const cancelledEarly = await cancelRepair({ cycleId: early.id })

      assert.equal(cancelledEarly.cycle.state, 'cancelled')
      assert.equal(cancelledEarly.cycle.stopReason, 'cancelled')

      // Mid-proposal: the model call aborts.
      const mid = await startCycle(plan)
      const slow = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [], notes: '' }),
        delayMs: 5000,
      })
      const pending = proposeRepair({ cycleId: mid.id }, { provider: slow })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const cancelledMid = await cancelRepair({ cycleId: mid.id })

      assert.equal(cancelledMid.cycle.state, 'cancelled')
      await assert.rejects(() => pending, /cancelled/i)

      // At approval time, denial is distinct from cancellation.
      const approval = await startCycle(plan)
      await proposeRepair(
        { cycleId: approval.id },
        { provider: fixProvider(target, 'fixed\n') }
      )

      const denied = await cancelRepair({ cycleId: approval.id, reason: 'approval-denied' })

      assert.equal(denied.cycle.state, 'approval-denied')
      assert.equal(await fs.readFile(target, 'utf8'), 'broken\n')

      // While awaiting verification.
      const verifying = await startCycle(plan)
      const { cycle: proposed, proposal } = await proposeRepair(
        { cycleId: verifying.id },
        { provider: fixProvider(target, 'fixed\n') }
      )
      await applyRepair({
        cycleId: verifying.id,
        attemptId: proposed.attempts[0].attemptId,
        edits: proposal.edits,
      })

      const cancelledLate = await cancelRepair({ cycleId: verifying.id })

      assert.equal(cancelledLate.cycle.state, 'cancelled')

      const pass = await passingRun()

      await assert.rejects(
        () =>
          recordRepair({
            cycleId: verifying.id,
            attemptId: proposed.attempts[0].attemptId,
            executionRunId: pass.diagnosis.runId,
          }),
        /Repair cycle is cancelled/
      )
    } finally {
      restore()
    }
  })

  it('cancelling one cycle does not abort another cycle proposal', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      const plan = await makePlan()
      const first = await startCycle(plan)
      const second = await startCycle(plan)
      const emptyAnswer = JSON.stringify({ edits: [], commands: [], notes: '' })

      // First proposal goes in flight, then the second (last writer
      // owns the agent module's global plan controller).
      const firstPending = proposeRepair(
        { cycleId: first.id },
        { provider: new MockProvider({ answer: emptyAnswer, delayMs: 5000 }) }
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      const secondPending = proposeRepair(
        { cycleId: second.id },
        { provider: new MockProvider({ answer: emptyAnswer }) }
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Cancelling the first cycle must not touch the second: a
      // global abort would kill the second proposal (it owns the
      // shared controller), failing the assertion below.
      const cancelled = await cancelRepair({ cycleId: first.id })

      assert.equal(cancelled.cycle.state, 'cancelled')
      await assert.rejects(() => firstPending, /cancelled/i)

      const completed = await secondPending

      assert.equal(completed.cycle.state, 'awaiting-approval')
    } finally {
      restore()
    }
  })

  it('keeps a mid-proposal cancel from being clobbered', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()

      const plan = await makePlan()
      const started = await startCycle(plan)

      let releaseGate = null
      const gate = new Promise((resolve) => {
        releaseGate = resolve
      })
      const gated = {
        chat: ({ signal } = {}) =>
          new Promise((resolve, reject) => {
            const aborted = () => {
              const error = new Error('Gated request was cancelled.')

              error.name = 'AbortError'

              reject(error)
            }

            if (signal?.aborted) {
              aborted()
              return
            }

            signal?.addEventListener('abort', aborted, { once: true })
            void gate.then(() => {
              signal?.removeEventListener('abort', aborted)
              resolve({
                answer: JSON.stringify({ edits: [], commands: [], notes: '' }),
                model: 'gated',
              })
            })
          }),
      }

      const pending = proposeRepair({ cycleId: started.id }, { provider: gated })

      // Wait for the backend to mark proposing: no sleep guessing.
      const segments = ['.kryom', 'repairs', started.id, 'cycle.json']

      for (let poll = 0; poll < 500; poll += 1) {
        const { data } = await readStorageFile(root, segments)

        if (JSON.parse(data).state === 'proposing') {
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      const cancelled = await cancelRepair({ cycleId: started.id })

      assert.equal(cancelled.cycle.state, 'cancelled')

      releaseGate()

      await assert.rejects(() => pending, /cancelled/i)

      // The terminal state stands: no awaiting-approval clobber, no
      // recorded attempt.
      const final = await getRepairCycle(started.id)

      assert.equal(final.cycle.state, 'cancelled')
      assert.equal(final.cycle.attempts.length, 0)
    } finally {
      restore()
    }
  })

  it('stops on stale files without overwriting user edits', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()
      const started = await startCycle(plan)
      const { cycle: proposed, proposal } = await proposeRepair(
        { cycleId: started.id },
        { provider: fixProvider(target, 'fixed\n') }
      )

      // The user edits the file after the proposal is generated.
      await fs.writeFile(target, 'user rewrite\n')

      const { cycle: blocked, apply } = await applyRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        edits: proposal.edits,
      })

      assert.equal(apply.stale.length, 1)
      assert.equal(blocked.state, 'stale')
      assert.equal(await fs.readFile(target, 'utf8'), 'user rewrite\n')
    } finally {
      restore()
    }
  })

  it('stops when the attempt checkpoint cannot be saved', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      // A file where the checkpoints directory belongs makes every
      // checkpoint write fail deterministically.
      await fs.mkdir(path.join(root, '.kryom'), { recursive: true })
      await fs.writeFile(path.join(root, '.kryom', 'checkpoints'), 'blocked')

      const plan = await makePlan()
      const started = await startCycle(plan)
      const { cycle: proposed, proposal } = await proposeRepair(
        { cycleId: started.id },
        { provider: fixProvider(target, 'fixed\n') }
      )
      const { cycle: failed, apply } = await applyRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        edits: proposal.edits,
      })

      assert.equal(apply.completed, true)
      assert.ok(apply.checkpoint.error)
      assert.equal(failed.state, 'checkpoint-failed')
    } finally {
      restore()
    }
  })

  it('recovers malformed calls without consuming the attempt', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()
      const started = await startCycle(plan)
      const { cycle: proposed, proposal } = await proposeRepair(
        { cycleId: started.id },
        { provider: fixProvider(target, 'fixed\n') }
      )

      await assert.rejects(
        () =>
          applyRepair({
            cycleId: started.id,
            attemptId: proposed.attempts[0].attemptId,
            edits: 'nope',
          }),
        /No approved edits/
      )

      // The cycle is back at approval; the corrected call proceeds.
      const waiting = await getRepairCycle(started.id)

      assert.equal(waiting.cycle.state, 'awaiting-approval')

      const { cycle: applied } = await applyRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        edits: proposal.edits,
      })

      assert.equal(applied.state, 'awaiting-verification')

      await assert.rejects(
        () =>
          recordRepair({
            cycleId: started.id,
            attemptId: proposed.attempts[0].attemptId,
            executionRunId: 'dg-forged-00000000',
          }),
        /not observed in this session/
      )

      const stillWaiting = await getRepairCycle(started.id)

      assert.equal(stillWaiting.cycle.state, 'awaiting-verification')

      const pass = await passingRun()
      const { cycle: recorded } = await recordRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        executionRunId: pass.diagnosis.runId,
      })

      assert.equal(recorded.state, 'passed')
    } finally {
      restore()
    }
  })

  it('blocks conflicting attempt edits without consuming the attempt', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()
      const started = await startCycle(plan)
      const { cycle: proposed, proposal } = await proposeRepair(
        { cycleId: started.id },
        { provider: fixProvider(target, 'fixed\n') }
      )

      await assert.rejects(
        () =>
          applyRepair({
            cycleId: started.id,
            attemptId: proposed.attempts[0].attemptId,
            edits: [
              proposal.edits[0],
              { ...proposal.edits[0], index: 1, content: 'other fix\n' },
            ],
          }),
        /Repair blocked by change-set check/
      )

      // Nothing wrote; the attempt is preserved for a corrected call.
      const waiting = await getRepairCycle(started.id)

      assert.equal(waiting.cycle.state, 'awaiting-approval')
      assert.equal(waiting.cycle.attempts[0].checkpointId, null)
      assert.equal(await fs.readFile(target, 'utf8'), 'broken\n')

      const { cycle: applied } = await applyRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        edits: proposal.edits,
      })

      assert.equal(applied.state, 'awaiting-verification')
      assert.equal(await fs.readFile(target, 'utf8'), 'fixed\n')
    } finally {
      restore()
    }
  })

  it('applies multi-file attempts in dependency order', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const base = path.join(root, 'base.ts')
      const top = path.join(root, 'top.ts')

      await fs.writeFile(base, 'export const b = 1\n')
      await fs.writeFile(top, "import './base'\n")

      const plan = await makePlan()
      const started = await startCycle(plan)
      const provider = new MockProvider({
        answer: JSON.stringify({
          edits: [
            {
              path: top,
              action: 'modify',
              content: "import './base'\nexport const t = 1\n",
              reason: 'Wire up.',
            },
            {
              path: base,
              action: 'modify',
              content: 'export const b = 2\n',
              reason: 'Fix base.',
            },
          ],
          commands: [],
          notes: '',
        }),
      })
      const { cycle: proposed, proposal } = await proposeRepair(
        { cycleId: started.id },
        { provider }
      )

      // Proposed dependent-first; the change set reorders base first.
      assert.deepEqual(
        proposal.edits.map((edit) => path.basename(edit.path)),
        ['top.ts', 'base.ts']
      )

      const { apply } = await applyRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        edits: proposal.edits,
      })

      assert.equal(apply.completed, true)
      assert.deepEqual(
        apply.applied.map((entry) => path.basename(entry.path)),
        ['base.ts', 'top.ts']
      )
    } finally {
      restore()
    }
  })

  it('rejects cancelled and timed-out runs without moving the cycle', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()
      const started = await startCycle(plan)
      const { cycle: proposed, proposal } = await proposeRepair(
        { cycleId: started.id },
        { provider: fixProvider(target, 'fixed\n') }
      )
      const { cycle: applied } = await applyRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        edits: proposal.edits,
      })

      assert.equal(applied.state, 'awaiting-verification')

      const controller = new AbortController()
      const pending = runDiagnostics('node -e "setTimeout(() => {}, 30000)"', {
        signal: controller.signal,
      })

      await new Promise((resolve) => setTimeout(resolve, 100))
      controller.abort()

      const cancelled = await pending

      assert.equal(cancelled.cancelled, true)

      await assert.rejects(
        () =>
          recordRepair({
            cycleId: started.id,
            attemptId: proposed.attempts[0].attemptId,
            executionRunId: cancelled.diagnosis.runId,
          }),
        /re-run the check/
      )

      const timedOut = await runDiagnostics(
        'node -e "setTimeout(() => {}, 30000)"',
        { timeoutMs: 300 }
      )

      assert.equal(timedOut.timedOut, true)

      await assert.rejects(
        () =>
          recordRepair({
            cycleId: started.id,
            attemptId: proposed.attempts[0].attemptId,
            executionRunId: timedOut.diagnosis.runId,
          }),
        /re-run the check/
      )

      // Neither verdict-less run moved the cycle or linked a report.
      const waiting = await getRepairCycle(started.id)

      assert.equal(waiting.cycle.state, 'awaiting-verification')
      assert.equal(waiting.cycle.attempts[0].reportId, null)

      const pass = await passingRun()
      const { cycle: recorded } = await recordRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        executionRunId: pass.diagnosis.runId,
      })

      assert.equal(recorded.state, 'passed')
    } finally {
      restore()
    }
  })

  it('reports interrupted cycles and allows only cancellation', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()

      const plan = await makePlan()
      const started = await startCycle(plan)

      // Simulate a crash between persisting mid-flight state and
      // finishing the step: rewrite the stored state directly.
      const segments = ['.kryom', 'repairs', started.id, 'cycle.json']
      const { data } = await readStorageFile(root, segments)
      const stored = JSON.parse(data)

      await writeStorageFile(
        root,
        segments,
        JSON.stringify({ ...stored, state: 'proposing' })
      )

      const fetched = await getRepairCycle(started.id)

      assert.equal(fetched.cycle.interrupted, true)

      await assert.rejects(
        () => proposeRepair({ cycleId: started.id }, { provider: fixProvider('x', 'y') }),
        /interrupted/
      )

      const cancelled = await cancelRepair({ cycleId: started.id })

      assert.equal(cancelled.cycle.state, 'cancelled')

      // A fresh cycle starts cleanly; the interrupted record keeps
      // its evidence.
      const retry = await startCycle(plan)

      assert.equal(retry.state, 'awaiting-proposal')

      const kept = await getRepairCycle(started.id)

      assert.equal(kept.cycle.attempts.length, 0)
      assert.ok(kept.cycle.diagnosis)
    } finally {
      restore()
    }
  })

  it('rejects forged execution run ids without moving the cycle', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()
      const started = await startCycle(plan)
      const { cycle: proposed, proposal } = await proposeRepair(
        { cycleId: started.id },
        { provider: fixProvider(target, 'fixed\n') }
      )
      await applyRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        edits: proposal.edits,
      })

      // A forged run id (valid shape, never observed) is rejected;
      // forged execution facts can no longer be laundered into a
      // report at all.
      await assert.rejects(
        () =>
          recordRepair({
            cycleId: started.id,
            attemptId: proposed.attempts[0].attemptId,
            executionRunId: 'dg-forged-00000000',
          }),
        /not observed in this session/
      )

      await assert.rejects(
        () =>
          recordRepair({
            cycleId: started.id,
            attemptId: proposed.attempts[0].attemptId,
            executionRunId: '',
          }),
        /Invalid repair execution run id/
      )

      const waiting = await getRepairCycle(started.id)

      assert.equal(waiting.cycle.state, 'awaiting-verification')

      const failed = await failingRun()
      const { cycle: recorded, report } = await recordRepair({
        cycleId: started.id,
        attemptId: proposed.attempts[0].attemptId,
        executionRunId: failed.diagnosis.runId,
      })

      assert.equal(recorded.state, 'awaiting-proposal')
      assert.equal(report.conclusion, 'failed')
      assert.equal(report.execution.runId, failed.diagnosis.runId)
    } finally {
      restore()
    }
  })

  it('rejects unknown and malformed cycle reads', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      await assert.rejects(
        () => getRepairCycle('rc-missing-abcdef'),
        /was not found/
      )
      await assert.rejects(() => getRepairCycle('nope'), /Invalid repair cycle id/)
    } finally {
      restore()
    }
  })

  it('prunes cycles beyond the retention cap', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const plan = await makePlan()

      for (let index = 0; index < 21; index += 1) {
        await startCycle(plan)
      }

      const entries = await fs.readdir(path.join(root, '.kryom', 'repairs'))

      assert.equal(entries.length, 20)
    } finally {
      restore()
    }
  })

  it('retention spares cycles holding unreviewed proposals', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const plan = await makePlan()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      // One cycle with a proposal the user has not reviewed yet.
      const guarded = await startCycle(plan)

      await proposeRepair(
        { cycleId: guarded.id },
        { provider: fixProvider(target, 'fixed\n') }
      )

      // Fill past the cap with fresh cycles.
      for (let index = 0; index < 20; index += 1) {
        await startCycle(plan)
      }

      // The guarded cycle survives; only fresh cycles prune.
      const survived = await getRepairCycle(guarded.id)

      assert.equal(survived.cycle.state, 'awaiting-approval')

      const entries = await fs.readdir(path.join(root, '.kryom', 'repairs'))

      assert.ok(entries.includes(guarded.id))
      assert.equal(entries.length, 21)
    } finally {
      restore()
    }
  })

  it('feeds the persisted diagnosis to the repair model', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'broken.ts')

      await fs.writeFile(target, 'broken\n')

      const plan = await makePlan()
      const started = await startCycle(plan)
      const provider = fixProvider(target, 'fixed\n')

      await proposeRepair({ cycleId: started.id }, { provider })

      const sent = JSON.stringify(provider.lastCall.messages)

      assert.ok(sent.includes('Failing command: npm test'))
      assert.ok(sent.includes('Diagnosis:'))
      assert.ok(sent.includes('assertion_failure'))
      assert.ok(sent.includes('repair attempt 1 of 2'))
    } finally {
      restore()
    }
  })
})
