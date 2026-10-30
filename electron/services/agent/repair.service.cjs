// Bounded repair cycles (Level 3B.4). The renderer used to own the
// retry loop (a counter plus a follow-up prompt); this module moves
// orchestration into the backend: at most MAX_REPAIR_ATTEMPTS model
// proposals per cycle, one fixed time budget that never resets, and
// every attempt persisted as a linked verification report.
//
// This is a state machine advanced by explicit user-approved IPC
// calls, NOT an autonomous loop. Each step re-validates cycle state,
// the attempt cap, and the deadline before doing anything:
//   start → awaiting-proposal → propose → awaiting-approval → apply
//   → awaiting-verification → record → (awaiting-proposal | terminal)
// Approval stays in the renderer (diff review + explicit apply);
// verification commands still run through the confirmed diagnostics
// path. Nothing here writes source, commits, or installs anything.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  ensureStorageDir,
  writeStorageFile,
  readStorageFile,
} = require('../../security/storage-path.cjs')
const { redactText, createLogger } = require('../../utils/logger.cjs')
const { boundDetail } = require('../../utils/errors.cjs')
const {
  planTask,
  applyEdits,
} = require('./agent.service.cjs')
const {
  getPlan,
  recordVerification,
} = require('./plan-store.cjs')
const {
  sanitizeDiagnosis,
} = require('../diagnostics/diagnosis.cjs')
const {
  getObservedRun,
} = require('../diagnostics/diagnostics.service.cjs')

const log = createLogger('repair')

const REPAIRS_SEGMENTS = ['.kryom', 'repairs']
const CYCLE_VERSION = 1
const MAX_REPAIR_ATTEMPTS = 2
const REPAIR_BUDGET_MS = 10 * 60 * 1000
const MAX_CYCLES = 20
const MAX_CHECK_CHARS = 200
const MAX_DETAIL_CHARS = 1000
const MAX_PROMPT_CHARS = 4000
const MAX_CONTEXT_PATHS = 8

const CYCLE_ID_PATTERN = /^rc-[0-9a-z]+-[0-9a-f]+$/

const TERMINAL_STATES = [
  'passed',
  'exhausted',
  'expired',
  'cancelled',
  'approval-denied',
  'stale',
  'checkpoint-failed',
  'error',
]

const MID_FLIGHT_STATES = ['proposing', 'applying', 'recording']

// Process-local liveness: a cycle persisted mid-flight that this
// process is not actively working is reported interrupted (crash or
// restart) and only cancellation may touch it afterwards.
const liveCycles = new Set()

// In-flight abort controllers per cycle. cancelRepair aborts ONLY
// the target cycle's controllers: the agent module's controllers are
// global, so the old global cancelPlan() call also aborted any
// unrelated user plan/apply in flight (even from another session).
const liveControllers = new Map()

function trackController(cycleId, controller) {
  const set = liveControllers.get(cycleId) ?? new Set()

  set.add(controller)
  liveControllers.set(cycleId, set)
}

function untrackController(cycleId, controller) {
  const set = liveControllers.get(cycleId)

  if (!set) {
    return
  }

  set.delete(controller)

  if (set.size === 0) {
    liveControllers.delete(cycleId)
  }
}

function abortCycleControllers(cycleId) {
  const set = liveControllers.get(cycleId)

  if (!set) {
    return
  }

  liveControllers.delete(cycleId)

  for (const controller of set) {
    try {
      controller.abort()
    } catch {
      // Already settled; the outcome section stands down on state.
    }
  }
}

// Synchronous re-entry guard: duplicate propose/apply/record calls
// for one cycle fail fast instead of queueing behind each other.
const busyCycles = new Set()

// Per-cycle promise mutex for state transitions. Busy alone cannot
// serialize cancellation (cancel must work even while a step runs),
// so every read-decide-write section takes this lock while the long
// operations (model call, apply, verification record) run outside
// it and re-lock to land their outcome on a fresh read. A cancel
// racing an in-flight step therefore wins deterministically instead
// of having its terminal state clobbered by a stale write.
const cycleLocks = new Map()

async function withCycleLock(cycleId, section) {
  const previous = cycleLocks.get(cycleId) || Promise.resolve()
  let releaseLock = null
  const current = new Promise((resolve) => {
    releaseLock = resolve
  })
  const chained = previous.then(() => current)

  cycleLocks.set(cycleId, chained)

  await previous

  try {
    return await section()
  } finally {
    releaseLock()

    if (cycleLocks.get(cycleId) === chained) {
      cycleLocks.delete(cycleId)
    }
  }
}

function newCycleId() {
  return `rc-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function nowIso() {
  return new Date().toISOString()
}

function openRoot() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  return root
}

function assertCycleId(value) {
  if (typeof value !== 'string' || !CYCLE_ID_PATTERN.test(value)) {
    throw new Error('Invalid repair cycle id.')
  }

  return value
}

function cycleSegments(id) {
  return [...REPAIRS_SEGMENTS, assertCycleId(id), 'cycle.json']
}

function isTerminal(cycle) {
  return TERMINAL_STATES.includes(cycle.state)
}

function isInterrupted(cycle) {
  return (
    !isTerminal(cycle) &&
    MID_FLIGHT_STATES.includes(cycle.state) &&
    !liveCycles.has(cycle.id)
  )
}

function remainingMs(cycle, now = Date.now()) {
  return cycle.deadline - now
}

// Proposal snapshots come back from planTask validated; the storage
// boundary re-checks the load-bearing shape so a damaged cycle file
// fails loudly instead of feeding garbage to the apply path (which
// re-validates every field again before touching the disk).
function sanitizeProposal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Repair cycle is corrupt.')
  }

  if (!Array.isArray(raw.edits) || raw.edits.length > 20) {
    throw new Error('Repair cycle is corrupt.')
  }

  for (const edit of raw.edits) {
    if (
      !edit ||
      typeof edit !== 'object' ||
      typeof edit.path !== 'string' ||
      typeof edit.action !== 'string'
    ) {
      throw new Error('Repair cycle is corrupt.')
    }
  }

  return raw
}

function sanitizeAttempt(raw, cycleId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Repair cycle is corrupt.')
  }

  if (
    typeof raw.n !== 'number' ||
    !Number.isInteger(raw.n) ||
    raw.n < 1 ||
    raw.n > MAX_REPAIR_ATTEMPTS
  ) {
    throw new Error('Repair cycle is corrupt.')
  }

  if (raw.attemptId !== `${cycleId}-a${raw.n}`) {
    throw new Error('Repair cycle is corrupt.')
  }

  if (
    (raw.checkpointId !== null && typeof raw.checkpointId !== 'string') ||
    (raw.reportId !== null && typeof raw.reportId !== 'string') ||
    !Array.isArray(raw.appliedFiles) ||
    raw.appliedFiles.some((entry) => typeof entry !== 'string') ||
    typeof raw.startedAt !== 'string' ||
    (raw.endedAt !== null && typeof raw.endedAt !== 'string') ||
    (raw.durationMs !== null && typeof raw.durationMs !== 'number')
  ) {
    throw new Error('Repair cycle is corrupt.')
  }

  return {
    n: raw.n,
    attemptId: raw.attemptId,
    proposal: raw.proposal === null ? null : sanitizeProposal(raw.proposal),
    checkpointId: raw.checkpointId,
    appliedFiles: [...raw.appliedFiles],
    reportId: raw.reportId,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    durationMs: raw.durationMs,
  }
}

function sanitizeCycle(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Repair cycle is corrupt.')
  }

  if (raw.version !== CYCLE_VERSION) {
    throw new Error('Unsupported repair cycle version.')
  }

  assertCycleId(raw.id)

  const states = [
    'awaiting-proposal',
    'proposing',
    'awaiting-approval',
    'applying',
    'awaiting-verification',
    'recording',
    ...TERMINAL_STATES,
  ]

  if (!states.includes(raw.state)) {
    throw new Error('Repair cycle is corrupt.')
  }

  if (
    typeof raw.planId !== 'string' ||
    !raw.planId ||
    typeof raw.stepId !== 'string' ||
    !raw.stepId ||
    typeof raw.check !== 'string' ||
    !raw.check.trim() ||
    raw.check.length > MAX_CHECK_CHARS ||
    typeof raw.createdAt !== 'string' ||
    typeof raw.deadline !== 'number' ||
    !Number.isFinite(raw.deadline) ||
    typeof raw.budgetMs !== 'number' ||
    !Number.isFinite(raw.budgetMs) ||
    raw.budgetMs <= 0 ||
    !Array.isArray(raw.attempts) ||
    raw.attempts.length > MAX_REPAIR_ATTEMPTS ||
    (raw.stopReason !== null && !TERMINAL_STATES.includes(raw.stopReason)) ||
    (raw.stoppedAt !== null && typeof raw.stoppedAt !== 'string') ||
    typeof raw.detail !== 'string' ||
    raw.detail.length > MAX_DETAIL_CHARS
  ) {
    throw new Error('Repair cycle is corrupt.')
  }

  let diagnosis = null

  if (raw.diagnosis !== null && raw.diagnosis !== undefined) {
    try {
      diagnosis = sanitizeDiagnosis(raw.diagnosis)
    } catch {
      throw new Error('Repair cycle is corrupt.')
    }
  }

  const attempts = raw.attempts.map((entry) => sanitizeAttempt(entry, raw.id))

  for (const [index, attempt] of attempts.entries()) {
    if (attempt.n !== index + 1) {
      throw new Error('Repair cycle is corrupt.')
    }
  }

  return {
    version: CYCLE_VERSION,
    id: raw.id,
    planId: raw.planId,
    stepId: raw.stepId,
    check: raw.check,
    diagnosis,
    budgetMs: raw.budgetMs,
    createdAt: raw.createdAt,
    deadline: raw.deadline,
    state: raw.state,
    stopReason: raw.stopReason,
    stoppedAt: raw.stoppedAt,
    detail: raw.detail,
    attempts,
  }
}

async function readCycle(root, id) {
  const { found, data } = await readStorageFile(root, cycleSegments(id))

  if (!found) {
    throw new Error('Repair cycle was not found.')
  }

  let parsed = null

  try {
    parsed = JSON.parse(data)
  } catch {
    throw new Error('Repair cycle is corrupt.')
  }

  return sanitizeCycle(parsed)
}

async function writeCycle(root, cycle) {
  await writeStorageFile(root, cycleSegments(cycle.id), JSON.stringify(cycle))
}

async function pruneCycles(root) {
  const dir = await ensureStorageDir(root, REPAIRS_SEGMENTS)
  const entries = await fs.readdir(dir)
  const ids = entries.filter((entry) => CYCLE_ID_PATTERN.test(entry))

  if (ids.length <= MAX_CYCLES) {
    return
  }

  const stamped = []

  // Only terminal records and fresh cycles (awaiting-proposal: a
  // diagnosis with no attempts yet) are prunable. In-flight cycles,
  // interrupted mid-flight work, and cycles holding a proposal or
  // apply the user has not reviewed yet are protected.
  for (const id of ids) {
    if (liveCycles.has(id)) {
      continue
    }

    try {
      const cycle = await readCycle(root, id)

      if (!isTerminal(cycle) && cycle.state !== 'awaiting-proposal') {
        continue
      }

      stamped.push({ id, createdAt: cycle.createdAt })
    } catch {
      continue
    }
  }

  stamped.sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt.localeCompare(b.createdAt)
  )

  for (const victim of stamped.slice(0, stamped.length - MAX_CYCLES)) {
    await fs.rm(path.join(dir, victim.id), { recursive: true, force: true })
  }
}

// Files named by the triggering diagnosis plus files changed by
// earlier attempts: exactly the context the repair model needs.
// gatherSourceContext re-validates containment, so quoted paths that
// wander outside the project are excluded with reasons, never sent.
function repairContextPaths(cycle) {
  const paths = []

  for (const finding of cycle.diagnosis?.findings ?? []) {
    if (finding.file && !paths.includes(finding.file)) {
      paths.push(finding.file)
    }
  }

  for (const attempt of cycle.attempts) {
    for (const file of attempt.appliedFiles) {
      if (!paths.includes(file)) {
        paths.push(file)
      }
    }
  }

  return paths.slice(0, MAX_CONTEXT_PATHS)
}

function findingLine(finding) {
  return (
    `- ${finding.category} (${finding.confidence} confidence)` +
    (finding.test ? ` in ${finding.test}` : '') +
    (finding.file ? ` at ${finding.file}:${finding.line ?? '?'}` : '') +
    `: ${finding.summary}`
  )
}

function buildRepairPrompt(cycle, attemptNumber) {
  const lines = [
    'The previous change failed verification. Analyze the failure and propose a fix.',
    `Failing command: ${cycle.check}`,
  ]

  if (cycle.diagnosis) {
    lines.push(`Diagnosis: ${cycle.diagnosis.summary}`)

    for (const finding of cycle.diagnosis.findings) {
      lines.push(findingLine(finding))
    }
  } else {
    lines.push('No structured diagnosis is available; rely on the provided source.')
  }

  const prior = cycle.attempts[cycle.attempts.length - 1]

  if (prior) {
    lines.push(
      `Earlier repair attempt ${prior.n} changed: ` +
        (prior.appliedFiles.length > 0 ? prior.appliedFiles.join(', ') : '(no files)') +
        '. Verification still fails; try a different fix.'
    )
  }

  lines.push(
    `This is repair attempt ${attemptNumber} of ${MAX_REPAIR_ATTEMPTS}. ` +
      'Base every modify edit on the provided original source and preserve unrelated code.'
  )

  return lines.join('\n').slice(0, MAX_PROMPT_CHARS)
}

function toTerminal(cycle, stopReason, detail) {
  return {
    ...cycle,
    state: stopReason,
    stopReason,
    stoppedAt: nowIso(),
    detail: redactText(detail).slice(0, MAX_DETAIL_CHARS),
  }
}

function present(cycle) {
  const now = Date.now()

  return {
    ...cycle,
    interrupted: isInterrupted(cycle),
    remainingAttempts: isTerminal(cycle)
      ? 0
      : MAX_REPAIR_ATTEMPTS - cycle.attempts.length,
    remainingMs: isTerminal(cycle) ? 0 : Math.max(0, remainingMs(cycle, now)),
    elapsedMs: Math.max(0, now - Date.parse(cycle.createdAt)),
  }
}

function guardBusy(cycleId) {
  if (busyCycles.has(cycleId)) {
    throw new Error('A repair step is already running for this cycle.')
  }

  busyCycles.add(cycleId)
}

function releaseBusy(cycleId) {
  busyCycles.delete(cycleId)
}

async function startRepairCycle(input, options = {}) {
  const root = openRoot()

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid repair request.')
  }

  if (typeof input.planId !== 'string' || !input.planId.trim()) {
    throw new Error('Invalid repair plan id.')
  }

  // The plan must exist in THIS project: unknown or foreign ids are
  // rejected instead of starting an orphan cycle.
  const plan = await getPlan(input.planId)
  const stepId =
    input.stepId === undefined || input.stepId === null ? 'verify' : input.stepId

  if (typeof stepId !== 'string' || !plan.steps.some((step) => step.id === stepId)) {
    throw new Error('Invalid repair step id.')
  }

  if (
    typeof input.check !== 'string' ||
    !input.check.trim() ||
    input.check.length > MAX_CHECK_CHARS
  ) {
    throw new Error('Invalid repair check command.')
  }

  let diagnosis = null

  if (input.diagnosis !== undefined && input.diagnosis !== null) {
    try {
      diagnosis = sanitizeDiagnosis(input.diagnosis)
    } catch {
      throw new Error('Invalid repair diagnosis.')
    }
  }

  // The budget is server-fixed: IPC never passes options, so forged
  // requests cannot buy extra time. Tests inject short budgets here.
  const budgetMs =
    options.budgetMs === undefined || options.budgetMs === null
      ? REPAIR_BUDGET_MS
      : options.budgetMs

  if (typeof budgetMs !== 'number' || !Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error('Invalid repair budget.')
  }

  const createdAt = nowIso()
  const cycle = {
    version: CYCLE_VERSION,
    id: newCycleId(),
    planId: plan.id,
    stepId,
    check: input.check.trim(),
    diagnosis,
    budgetMs,
    createdAt,
    deadline: Date.now() + budgetMs,
    state: 'awaiting-proposal',
    stopReason: null,
    stoppedAt: null,
    detail: '',
    attempts: [],
  }

  await writeCycle(root, cycle)
  await pruneCycles(root)

  log.info(`Repair cycle ${cycle.id} started for plan ${plan.id}.`)

  return { cycle: present(cycle) }
}

async function loadActiveCycle(root, cycleId) {
  const cycle = await readCycle(root, assertCycleId(cycleId))

  if (isTerminal(cycle)) {
    throw new Error(`Repair cycle is ${cycle.state}; start a new cycle to retry.`)
  }

  // Callers hold the busy guard, so no step is running in this
  // process: a mid-flight state here is always crash residue, never
  // a live step. (The live set exists only for get() display.)
  if (MID_FLIGHT_STATES.includes(cycle.state)) {
    throw new Error('Repair cycle was interrupted; cancel it or start a new cycle.')
  }

  return cycle
}

async function expireIfOverdue(root, cycle) {
  if (remainingMs(cycle) > 0) {
    return null
  }

  const expired = toTerminal(cycle, 'expired', 'The repair time budget expired.')

  await writeCycle(root, expired)

  return expired
}

async function proposeRepair(input, options = {}) {
  const root = openRoot()

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid repair request.')
  }

  const cycleId = assertCycleId(input.cycleId)

  guardBusy(cycleId)
  liveCycles.add(cycleId)

  // Created before the model call, aborted by cancelRepair, released
  // in the finally: scoped to this cycle, never global.
  const controller = new AbortController()

  trackController(cycleId, controller)

  try {
    // Locked open: validate and mark proposing atomically, so a
    // cancel racing this call either lands first (we throw below)
    // or after (it overwrites our mark, and our outcome section
    // stands down on the terminal read).
    const opened = await withCycleLock(cycleId, async () => {
      const cycle = await loadActiveCycle(root, cycleId)

      if (cycle.state !== 'awaiting-proposal') {
        throw new Error(`Repair cycle cannot propose while ${cycle.state}.`)
      }

      // The cap is enforced here, not in the renderer: forged or
      // repeated requests past attempt two always land here.
      if (cycle.attempts.length >= MAX_REPAIR_ATTEMPTS) {
        const exhausted = toTerminal(cycle, 'exhausted', 'Repair attempts exhausted.')

        await writeCycle(root, exhausted)

        throw new Error('Repair attempts exhausted. Adjust the task or files and plan again.')
      }

      const expired = await expireIfOverdue(root, cycle)

      if (expired) {
        throw new Error('The repair time budget expired.')
      }

      const attemptNumber = cycle.attempts.length + 1

      await writeCycle(root, { ...cycle, state: 'proposing' })

      return {
        cycle,
        attemptNumber,
        attemptId: `${cycleId}-a${attemptNumber}`,
        startedAt: nowIso(),
      }
    })

    // The deadline also aborts the model call itself: a slow
    // provider cannot silently overrun the budget.
    let deadlineFired = false
    const timer = setTimeout(() => {
      deadlineFired = true
      controller.abort()
    }, Math.max(1, remainingMs(opened.cycle)))

    let proposal = null

    try {
      proposal = await planTask(
        {
          task: buildRepairPrompt(opened.cycle, opened.attemptNumber),
          contextPaths: repairContextPaths(opened.cycle),
        },
        { provider: options.provider, signal: controller.signal }
      )
    } catch (error) {
      return withCycleLock(cycleId, async () => {
        const fresh = await readCycle(root, cycleId)

        // A concurrent cancel already landed the terminal state;
        // never overwrite its reason.
        if (isTerminal(fresh)) {
          throw new Error(`Repair cycle is ${fresh.state}; start a new cycle to retry.`)
        }

        if (deadlineFired || remainingMs(fresh) <= 0) {
          const terminal = toTerminal(fresh, 'expired', 'The repair time budget expired.')

          await writeCycle(root, terminal)

          throw new Error('The repair time budget expired.')
        }

        if (error && error.name === 'AbortError') {
          const terminal = toTerminal(fresh, 'cancelled', 'Repair proposal was cancelled.')

          await writeCycle(root, terminal)

          throw new Error('Repair proposal was cancelled.')
        }

        const terminal = toTerminal(
          fresh,
          'error',
          `Repair proposal failed: ${boundDetail(error.message, 300)}`
        )

        await writeCycle(root, terminal)

        throw new Error(
          `Repair proposal failed: ${boundDetail(error.message, 300) || 'the model call failed.'}`
        )
      })
    } finally {
      clearTimeout(timer)
    }

    return withCycleLock(cycleId, async () => {
      const fresh = await readCycle(root, cycleId)

      if (isTerminal(fresh)) {
        throw new Error(`Repair cycle is ${fresh.state}; start a new cycle to retry.`)
      }

      if (remainingMs(fresh) <= 0) {
        const terminal = toTerminal(fresh, 'expired', 'The repair time budget expired.')

        await writeCycle(root, terminal)

        throw new Error('The repair time budget expired.')
      }

      const attempt = {
        n: opened.attemptNumber,
        attemptId: opened.attemptId,
        proposal,
        checkpointId: null,
        appliedFiles: [],
        reportId: null,
        startedAt: opened.startedAt,
        endedAt: null,
        durationMs: null,
      }

      const advanced = {
        ...fresh,
        state: 'awaiting-approval',
        attempts: [...fresh.attempts, attempt],
      }

      await writeCycle(root, advanced)

      log.info(`Repair cycle ${cycleId} proposed attempt ${opened.attemptNumber}.`)

      return { cycle: present(advanced), proposal }
    })
  } finally {
    liveCycles.delete(cycleId)
    untrackController(cycleId, controller)
    releaseBusy(cycleId)
  }
}

// Maps a change-set order (edit indexes, possibly sparse) back
// onto the caller's edits. Members missing from the order keep
// plan order at the end, so the result is always a full
// permutation of the input.
function orderEditsByManifest(edits, order) {
  const byIndex = new Map()

  edits.forEach((edit, position) => {
    byIndex.set(
      edit && typeof edit.index === 'number' ? edit.index : position,
      edit
    )
  })

  const ordered = []

  for (const index of order) {
    if (byIndex.has(index)) {
      ordered.push(byIndex.get(index))
    }
  }

  for (const edit of edits) {
    if (!ordered.includes(edit)) {
      ordered.push(edit)
    }
  }

  return ordered
}

async function applyRepair(input) {
  const root = openRoot()

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid repair request.')
  }

  const cycleId = assertCycleId(input.cycleId)

  guardBusy(cycleId)
  liveCycles.add(cycleId)

  // Scoped abort for this cycle's apply batch (see cancelRepair).
  const applyController = new AbortController()

  trackController(cycleId, applyController)

  try {
    const opened = await withCycleLock(cycleId, async () => {
      const cycle = await loadActiveCycle(root, cycleId)

      if (cycle.state !== 'awaiting-approval') {
        throw new Error(`Repair cycle cannot apply while ${cycle.state}.`)
      }

      const attempt = cycle.attempts[cycle.attempts.length - 1]

      if (!attempt || input.attemptId !== attempt.attemptId) {
        throw new Error('Repair attempt does not match this cycle.')
      }

      const expired = await expireIfOverdue(root, cycle)

      if (expired) {
        throw new Error('The repair time budget expired.')
      }

      await writeCycle(root, { ...cycle, state: 'applying' })

      return { attempt }
    })

    // Change-set integration (3B.7): attempt edits apply in
    // dependencies-first order, and conflicting or
    // dependency-breaking batches return to awaiting-approval
    // without consuming the attempt. Freshness blockers are
    // deliberately left for applyEdits so stale attempts keep
    // their terminal mapping; a manifest that cannot build falls
    // through so malformed input keeps its canonical errors.
    let orderedEdits = input.edits
    let manifest = null

    try {
      const { buildChangeSet } = require('./change-set.cjs')

      manifest = await buildChangeSet(input.edits)
    } catch {
      manifest = null
    }

    if (manifest) {
      const hard = manifest.validation.blockers.filter(
        (entry) => entry.kind === 'conflict' || entry.kind === 'delete-dependent'
      )

      if (hard.length > 0) {
        await withCycleLock(cycleId, async () => {
          const fresh = await readCycle(root, cycleId)

          if (!isTerminal(fresh)) {
            await writeCycle(root, { ...fresh, state: 'awaiting-approval' })
          }
        })

        throw new Error(`Repair blocked by change-set check: ${hard[0].reason}`)
      }

      orderedEdits = orderEditsByManifest(input.edits, manifest.order)
    }

    // Freshness, containment, rollback, and checkpointing all come
    // from applyEdits; this wrapper only routes its honest result
    // into the cycle record.
    let applied = null

    try {
      applied = await applyEdits(
        {
          edits: orderedEdits,
          task: input.task ?? `Repair attempt ${opened.attempt.n}.`,
        },
        { signal: applyController.signal }
      )
    } catch (error) {
      // Malformed caller input rejects WITHOUT consuming the
      // attempt: nothing executed, so the cycle returns to
      // awaiting-approval for a corrected call.
      await withCycleLock(cycleId, async () => {
        const fresh = await readCycle(root, cycleId)

        if (!isTerminal(fresh)) {
          await writeCycle(root, { ...fresh, state: 'awaiting-approval' })
        }
      })

      throw error
    }

    return withCycleLock(cycleId, async () => {
      const fresh = await readCycle(root, cycleId)

      // A concurrent cancel already landed the terminal state; the
      // apply's own result (cancelled + checkpointed partial work)
      // stands, and the reason is left untouched.
      if (isTerminal(fresh)) {
        return { cycle: present(fresh), apply: applied }
      }

      const withAttempt = (patch) => ({
        ...fresh,
        attempts: fresh.attempts.map((entry) =>
          entry.attemptId === opened.attempt.attemptId
            ? { ...entry, ...patch }
            : entry
        ),
      })

      if (applied.cancelled) {
        const terminal = toTerminal(
          withAttempt({ endedAt: nowIso() }),
          'cancelled',
          'Repair application was cancelled.'
        )

        await writeCycle(root, terminal)

        return { cycle: present(terminal), apply: applied }
      }

      if (applied.stale && applied.stale.length > 0) {
        const terminal = toTerminal(
          withAttempt({ endedAt: nowIso() }),
          'stale',
          `Repair blocked by stale files: ${applied.stale.map((entry) => entry.path).join(', ')}.`
        )

        await writeCycle(root, terminal)

        return { cycle: present(terminal), apply: applied }
      }

      if (!applied.completed) {
        const terminal = toTerminal(
          withAttempt({ endedAt: nowIso() }),
          'error',
          `Repair apply failed: ${boundDetail(applied.failed?.message, 300)}`
        )

        await writeCycle(root, terminal)

        return { cycle: present(terminal), apply: applied }
      }

      if (!applied.checkpoint || applied.checkpoint.error) {
        const terminal = toTerminal(
          withAttempt({
            endedAt: nowIso(),
            appliedFiles: applied.applied.map((entry) => entry.path),
          }),
          'checkpoint-failed',
          `Repair checkpoint was not saved: ${boundDetail(applied.checkpoint?.error, 300)}`
        )

        await writeCycle(root, terminal)

        return { cycle: present(terminal), apply: applied }
      }

      const advanced = withAttempt({
        checkpointId: applied.checkpoint.id,
        appliedFiles: applied.applied.map((entry) => entry.path),
      })

      advanced.state = 'awaiting-verification'

      await writeCycle(root, advanced)

      log.info(`Repair cycle ${cycleId} applied attempt ${opened.attempt.n}.`)

      return { cycle: present(advanced), apply: applied }
    })
  } finally {
    liveCycles.delete(cycleId)
    untrackController(cycleId, applyController)
    releaseBusy(cycleId)
  }
}

function resultForDiagnosis(diagnosis) {
  if (diagnosis.status === 'passed') {
    return 'pass'
  }

  if (diagnosis.status === 'timeout' || diagnosis.status === 'cancelled') {
    return 'error'
  }

  return 'fail'
}

async function recordRepair(input) {
  const root = openRoot()

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid repair request.')
  }

  const cycleId = assertCycleId(input.cycleId)

  guardBusy(cycleId)
  liveCycles.add(cycleId)

  try {
    // The caller cites an observed run id; the facts resolve from
    // the registry inside recordVerification. Unknown ids reject
    // WITHOUT moving the cycle: the user can re-run verification
    // and record again.
    if (
      typeof input.executionRunId !== 'string' ||
      !input.executionRunId.trim()
    ) {
      throw new Error('Invalid repair execution run id.')
    }

    const observed = getObservedRun(input.executionRunId)

    if (!observed) {
      throw new Error(
        'Unknown verification run: the cited execution was not observed in this session.'
      )
    }

    // Verdict guard (3B.7): cancelled and timed-out runs carry no
    // verdict, so they must not consume an attempt or move the
    // cycle. The user re-runs the check; the time budget still
    // bounds retries. Rejected before any state moves, like an
    // unknown run id.
    if (
      observed.diagnosis.status === 'cancelled' ||
      observed.diagnosis.status === 'timeout'
    ) {
      throw new Error(
        `Verification ${observed.diagnosis.status}: re-run the check to record this attempt.`
      )
    }

    const opened = await withCycleLock(cycleId, async () => {
      const cycle = await loadActiveCycle(root, cycleId)

      if (cycle.state !== 'awaiting-verification') {
        throw new Error(`Repair cycle cannot record while ${cycle.state}.`)
      }

      const attempt = cycle.attempts[cycle.attempts.length - 1]

      if (!attempt || input.attemptId !== attempt.attemptId) {
        throw new Error('Repair attempt does not match this cycle.')
      }

      await writeCycle(root, { ...cycle, state: 'recording' })

      return { cycle, attempt }
    })

    // The proposal notes are model-generated interpretation of the
    // fix: stored as explanation, never as evidence.
    const notes =
      typeof opened.attempt.proposal?.notes === 'string'
        ? opened.attempt.proposal.notes.trim()
        : ''

    let report = null
    let plan = null

    try {
      ;({ report, plan } = await recordVerification({
        planId: opened.cycle.planId,
        stepId: opened.cycle.stepId,
        check: opened.cycle.check,
        result: resultForDiagnosis(observed.diagnosis),
        executionRunId: observed.runId,
        modelExplanation: notes
          ? { summary: `Repair proposal notes: ${notes}` }
          : undefined,
        repair: {
          cycleId: opened.cycle.id,
          attempt: opened.attempt.n,
          attemptId: opened.attempt.attemptId,
          checkpointId: opened.attempt.checkpointId,
          appliedFiles: [...opened.attempt.appliedFiles],
        },
      }))
    } catch (error) {
      // The report was not stored, so the cycle returns to
      // awaiting-verification for a retry instead of stranding.
      await withCycleLock(cycleId, async () => {
        const fresh = await readCycle(root, cycleId)

        if (!isTerminal(fresh)) {
          await writeCycle(root, { ...fresh, state: 'awaiting-verification' })
        }
      })

      throw error
    }

    return withCycleLock(cycleId, async () => {
      const endedAt = nowIso()
      const fresh = await readCycle(root, cycleId)
      const stamped = {
        ...fresh,
        attempts: fresh.attempts.map((entry) =>
          entry.attemptId === opened.attempt.attemptId
            ? {
                ...entry,
                reportId: report.id,
                endedAt,
                durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(entry.startedAt)),
              }
            : entry
        ),
      }

      // A concurrent cancel already landed the terminal state: keep
      // its reason, but still stamp the report linkage so the stored
      // verification evidence is never orphaned.
      if (isTerminal(fresh)) {
        await writeCycle(root, stamped)

        return { cycle: present(stamped), report, plan }
      }

      // Expiry is checked BEFORE the pass: a budget overrun never
      // reports success, but the verification evidence stays stored.
      if (remainingMs(stamped) <= 0) {
        const terminal = toTerminal(stamped, 'expired', 'The repair time budget expired.')

        await writeCycle(root, terminal)

        return { cycle: present(terminal), report, plan }
      }

      if (observed.diagnosis.status === 'passed') {
        const terminal = toTerminal(stamped, 'passed', 'Verification passed after repair.')

        await writeCycle(root, terminal)

        log.info(`Repair cycle ${cycleId} passed on attempt ${opened.attempt.n}.`)

        return { cycle: present(terminal), report, plan }
      }

      if (stamped.attempts.length >= MAX_REPAIR_ATTEMPTS) {
        const terminal = toTerminal(stamped, 'exhausted', 'Repair attempts exhausted.')

        await writeCycle(root, terminal)

        return { cycle: present(terminal), report, plan }
      }

      const continuing = { ...stamped, state: 'awaiting-proposal' }

      await writeCycle(root, continuing)

      return { cycle: present(continuing), report, plan }
    })
  } finally {
    liveCycles.delete(cycleId)
    releaseBusy(cycleId)
  }
}

async function cancelRepair(input) {
  const root = openRoot()

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid repair request.')
  }

  const cycleId = assertCycleId(input.cycleId)
  const reason =
    input.reason === undefined || input.reason === null ? 'cancelled' : input.reason

  if (!['cancelled', 'approval-denied'].includes(reason)) {
    throw new Error('Invalid repair cancel reason.')
  }

  // Best-effort abort of THIS cycle's in-flight proposal/apply
  // work, issued BEFORE taking the lock so a slow step cannot delay
  // the abort; the awaiting call then stands down when it reaches
  // its outcome section and reads the terminal state. Scoped per
  // cycle: unrelated user plans/applies keep running.
  abortCycleControllers(cycleId)

  return withCycleLock(cycleId, async () => {
    const cycle = await readCycle(root, cycleId)

    if (isTerminal(cycle)) {
      return { cycle: present(cycle) }
    }

    const terminal = toTerminal(
      cycle,
      reason,
      reason === 'approval-denied'
        ? 'The user denied approval for the repair.'
        : 'The repair cycle was cancelled.'
    )

    await writeCycle(root, terminal)

    return { cycle: present(terminal) }
  })
}

async function getRepairCycle(cycleId) {
  const root = openRoot()
  const cycle = await readCycle(root, assertCycleId(cycleId))

  return { cycle: present(cycle) }
}

module.exports = {
  MAX_REPAIR_ATTEMPTS,
  REPAIR_BUDGET_MS,
  MAX_CYCLES,
  TERMINAL_STATES,
  startRepairCycle,
  proposeRepair,
  applyRepair,
  recordRepair,
  cancelRepair,
  getRepairCycle,
}
