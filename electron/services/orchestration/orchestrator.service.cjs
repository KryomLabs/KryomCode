// Controlled multi-agent orchestration (Level 3C.4). Coordinates
// specialist agents over an approved implementation plan.
//
// Safety architecture (read before modifying):
// - Proposals only: specialists never write project sources. The
//   coding specialist returns edit proposals; the orchestrator merges
//   them through the SAME guarded path as single-agent work
//   (ownership checks, change-set analysis, freshness gate,
//   checkpoints, atomic apply with rollback).
// - No concurrent disk writes, ever: parallelism covers proposal
//   generation only (at most MAX_PARALLEL specialist runs), and
//   merges are strictly sequential through a per-run mutex.
// - File ownership by construction: tasks declare their files
//   upfront; overlapping scopes without a dependency edge reject the
//   run at start. Proposals touching unowned files are rejected, not
//   merged.
// - Centralized approval: every task proposal needs an explicit
//   approve call. Ambiguous conflicts stop for human review; nothing
//   is silently merged, overwritten, or retried.
// - No autonomous loops: the run is a state machine advanced by
//   explicit start/advance/approve/retry/cancel calls. No terminal
//   execution, no commits, no network beyond the configured provider.
// - Recovery: every transition persists; partial completion keeps
//   its checkpoints; interrupted runs are cancel-only.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
  assertStringArray,
  assertEnum,
} = require('../../security/validate-input.cjs')
const {
  ensureStorageDir,
  writeStorageFile,
  readStorageFile,
} = require('../../security/storage-path.cjs')
const {
  getPlan,
  attachEvidence,
} = require('../agent/plan-store.cjs')
const {
  applyEdits,
} = require('../agent/agent.service.cjs')
const {
  buildChangeSet,
  canonicalTargetKey,
} = require('../agent/change-set.cjs')
const {
  runSpecialist,
  getSpecialistRun,
  cancelSpecialistRun,
} = require('../specialists/specialist.service.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('orchestrator')

const ORCHESTRATION_SEGMENTS = ['.kryom', 'orchestration']
const RUN_VERSION = 1
const RUN_ID_PATTERN = /^or-[0-9a-z]+-[0-9a-f]+$/
const MAX_TASKS = 8
const MAX_PARALLEL = 2
const MAX_ATTEMPTS = 2
const MAX_TASK_TITLE = 200
const MAX_TASK_TEXT = 4000
const MAX_FILES_PER_TASK = 10
const MAX_HISTORY = 200

const TERMINAL_TASK_STATES = [
  'merged',
  'failed',
  'timeout',
  'cancelled',
  'rejected',
  'blocked',
  'stale',
]

const TERMINAL_RUN_STATES = ['completed', 'cancelled', 'interrupted']

// Process-local liveness: runs this process started. A persisted
// active run this process never touched is reported interrupted.
const liveRuns = new Set()

// Per-run promise mutex for merge sections: merges are sequential
// per run even if two approve calls race.
const runLocks = new Map()

async function withRunLock(runId, section) {
  const previous = runLocks.get(runId) || Promise.resolve()
  let releaseLock = null
  const current = new Promise((resolve) => {
    releaseLock = resolve
  })
  const chained = previous.then(() => current)

  runLocks.set(runId, chained)

  await previous

  try {
    return await section()
  } finally {
    releaseLock()

    if (runLocks.get(runId) === chained) {
      runLocks.delete(runId)
    }
  }
}

function newRunId() {
  return `or-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
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

function assertRunId(value) {
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
    throw new Error('Invalid orchestration run id.')
  }

  return value
}

function runSegments(runId) {
  return [...ORCHESTRATION_SEGMENTS, assertRunId(runId), 'run.json']
}

async function writeRun(root, record) {
  await ensureStorageDir(root, [...ORCHESTRATION_SEGMENTS, record.id])
  await writeStorageFile(root, runSegments(record.id), JSON.stringify(record, null, 2))
}

async function readRun(root, runId) {
  const { found, data } = await readStorageFile(root, runSegments(assertRunId(runId)))

  if (!found || !data) {
    throw new Error('Orchestration run not found.')
  }

  try {
    return JSON.parse(data)
  } catch {
    throw new Error('Orchestration run record is corrupt.')
  }
}

function recordHistory(record, event) {
  record.history.push({ at: nowIso(), ...event })

  if (record.history.length > MAX_HISTORY) {
    record.history = record.history.slice(-MAX_HISTORY)
  }
}

function validateTasks(rawTasks) {
  if (!Array.isArray(rawTasks) || rawTasks.length === 0 || rawTasks.length > MAX_TASKS) {
    throw new Error(`Invalid tasks: provide 1 to ${MAX_TASKS} tasks.`)
  }

  const tasks = rawTasks.map((entry, index) => {
    assertPlainObject(entry, `tasks[${index}]`)

    const files = entry.files === undefined || entry.files === null
      ? []
      : assertStringArray(entry.files, `tasks[${index}].files`, {
          maxItems: MAX_FILES_PER_TASK,
          maxLength: 1000,
        })

    const dependsOn = entry.dependsOn === undefined || entry.dependsOn === null
      ? []
      : entry.dependsOn

    if (!Array.isArray(dependsOn)) {
      throw new Error(`Invalid tasks[${index}].dependsOn: an array is required.`)
    }

    for (const dep of dependsOn) {
      if (
        typeof dep !== 'number' ||
        !Number.isInteger(dep) ||
        dep < 0 ||
        dep >= rawTasks.length ||
        dep === index
      ) {
        throw new Error(`Invalid tasks[${index}].dependsOn: bad reference ${String(dep)}.`)
      }
    }

    return {
      index,
      id: `task-${index + 1}`,
      specialist: assertEnum(entry.specialist, `tasks[${index}].specialist`, [
        'research',
        'coding',
        'testing',
        'debugging',
        'security',
        'review',
      ]),
      title: assertNonEmptyString(entry.title, `tasks[${index}].title`, MAX_TASK_TITLE).trim(),
      detail: typeof entry.detail === 'string' ? entry.detail.slice(0, MAX_TASK_TEXT) : '',
      files: [...new Set(files)],
      dependsOn: [...new Set(dependsOn)],
      planStepId: typeof entry.planStepId === 'string' && entry.planStepId
        ? entry.planStepId.slice(0, 32)
        : null,
      state: 'pending',
      attempts: 0,
      specialistRunId: null,
      proposal: null,
      merge: null,
      error: null,
    }
  })

  // Cycle check.
  const incoming = new Map(tasks.map((task) => [task.index, 0]))

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      incoming.set(task.index, incoming.get(task.index) + 1)
    }
  }

  const queue = [...incoming.entries()].filter(([, count]) => count === 0).map(([index]) => index)
  let consumed = 0

  while (queue.length > 0) {
    const next = queue.shift()

    consumed += 1

    for (const task of tasks) {
      if (task.dependsOn.includes(next)) {
        incoming.set(task.index, incoming.get(task.index) - 1)

        if (incoming.get(task.index) === 0) {
          queue.push(task.index)
        }
      }
    }
  }

  if (consumed !== tasks.length) {
    throw new Error('Invalid tasks: dependencies contain a cycle.')
  }

  // Ownership by construction: overlapping file scopes are allowed
  // only with a dependency edge ordering them.
  const owners = new Map()

  for (const task of tasks) {
    for (const file of task.files) {
      if (!owners.has(file)) {
        owners.set(file, [])
      }

      owners.get(file).push(task.index)
    }
  }

  const reachable = (from, to, seen = new Set()) => {
    if (from === to) {
      return true
    }

    if (seen.has(from)) {
      return false
    }

    seen.add(from)

    for (const task of tasks) {
      if (task.dependsOn.includes(from) && reachable(task.index, to, seen)) {
        return true
      }
    }

    return false
  }

  for (const [file, indexes] of owners) {
    for (let i = 0; i < indexes.length; i += 1) {
      for (let j = i + 1; j < indexes.length; j += 1) {
        const ordered =
          reachable(indexes[i], indexes[j]) || reachable(indexes[j], indexes[i])

        if (!ordered) {
          throw new Error(
            `Conflicting task scopes: tasks ${indexes[i] + 1} and ${indexes[j] + 1} ` +
              `both own "${file}" with no dependency edge. Narrow the scopes or order them.`
          )
        }
      }
    }
  }

  return { tasks, ownership: [...owners.entries()].map(([file, indexes]) => ({ file, tasks: indexes })) }
}

// Starts a run from an APPROVED plan: the plan must be active and its
// review step completed or verified. Returns the persisted run.
async function startRun(payload) {
  assertPlainObject(payload, 'orchestration request')

  const planId = assertNonEmptyString(payload.planId, 'plan id', 80)
  const plan = await getPlan(planId)

  if (plan.status !== 'active') {
    throw new Error(`Plan is ${plan.status}; only active plans can orchestrate.`)
  }

  const review = plan.steps.find((step) => step.id === 'review')

  if (!review || (review.state !== 'completed' && review.state !== 'verified')) {
    throw new Error(
      'The plan is not approved yet. Complete the review step before orchestrating.'
    )
  }

  const { tasks, ownership } = validateTasks(payload.tasks)
  const root = openRoot()
  const record = {
    version: RUN_VERSION,
    id: newRunId(),
    planId,
    planTitle: plan.title,
    state: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    tasks,
    ownership,
    outcome: null,
    history: [],
  }

  recordHistory(record, { kind: 'started', planId, taskCount: tasks.length })
  await writeRun(root, record)
  liveRuns.add(record.id)

  log.info(`Orchestration run ${record.id} started for plan ${planId}.`)

  return record
}

function present(root, record) {
  if (record.state === 'active' && !liveRuns.has(record.id)) {
    return { ...record, state: 'interrupted', interrupted: true }
  }

  return record
}

async function getRun(runId) {
  const root = openRoot()

  return present(root, await readRun(root, assertRunId(runId)))
}

async function listRuns() {
  const root = openRoot()
  const dir = await ensureStorageDir(root, ORCHESTRATION_SEGMENTS)
  const entries = await fs.readdir(dir)
  const runs = []
  const corrupt = []

  for (const entry of entries) {
    if (!RUN_ID_PATTERN.test(entry)) {
      continue
    }

    try {
      runs.push(present(root, await readRun(root, entry)))
    } catch (error) {
      log.warn(`Orchestration run ${entry} unreadable: ${error.message}`)
      corrupt.push(entry)
    }
  }

  runs.sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : b.createdAt.localeCompare(a.createdAt)
  )
  corrupt.sort()

  return { runs, corrupt }
}

// Collects finished specialist runs and starts ready tasks, up to
// MAX_PARALLEL concurrent generations. Never writes project sources.
async function advanceRun(runId, options = {}) {
  const root = openRoot()

  return withRunLock(assertRunId(runId), async () => {
    const record = await readRun(root, runId)

    if (record.state !== 'active') {
      throw new Error(`Run is ${record.state}; it cannot advance.`)
    }

    if (!liveRuns.has(record.id)) {
      record.state = 'interrupted'
      record.updatedAt = nowIso()
      recordHistory(record, { kind: 'interrupted', reason: 'Run was started by another process.' })
      await writeRun(root, record)

      return present(root, record)
    }

    // Collect: poll running tasks' specialist records.
    for (const task of record.tasks) {
      if (task.state !== 'running' || !task.specialistRunId) {
        continue
      }

      let specialist = null

      try {
        specialist = await getSpecialistRun(task.specialistRunId)
      } catch (error) {
        task.state = 'failed'
        task.error = `Specialist record unreadable: ${error.message}`.slice(0, 500)
        recordHistory(record, { kind: 'task-failed', task: task.id, reason: task.error })
        continue
      }

      if (specialist.state === 'running') {
        continue
      }

      if (specialist.state === 'succeeded') {
        task.state = 'proposed'
        task.proposal = {
          specialistRunId: specialist.id,
          result: specialist.result,
          finishedAt: specialist.finishedAt,
        }
        recordHistory(record, { kind: 'task-proposed', task: task.id })
      } else if (specialist.state === 'cancelled') {
        task.state = 'cancelled'
        task.error = 'Specialist run was cancelled.'
        recordHistory(record, { kind: 'task-cancelled', task: task.id })
      } else if (specialist.state === 'timeout') {
        task.state = 'timeout'
        task.error = specialist.error || 'Specialist run timed out.'
        recordHistory(record, { kind: 'task-timeout', task: task.id })
      } else {
        task.state = 'failed'
        task.error = (specialist.error || 'Specialist run failed.').slice(0, 500)
        recordHistory(record, { kind: 'task-failed', task: task.id, reason: task.error })
      }
    }

    // Start: ready tasks whose dependencies all merged.
    const live = record.tasks.filter((task) => task.state === 'running').length
    let budget = MAX_PARALLEL - live

    const merged = new Set(
      record.tasks.filter((task) => task.state === 'merged').map((task) => task.index)
    )

    for (const task of record.tasks) {
      if (budget <= 0) {
        break
      }

      if (task.state !== 'pending') {
        continue
      }

      if (!task.dependsOn.every((dep) => merged.has(dep))) {
        continue
      }

      if (task.attempts >= MAX_ATTEMPTS) {
        task.state = 'failed'
        task.error = `Attempt budget exhausted (${MAX_ATTEMPTS}).`
        recordHistory(record, { kind: 'task-failed', task: task.id, reason: task.error })
        continue
      }

      task.attempts += 1

      const prompt =
        `${task.title}\n\n${task.detail}\n\n` +
        `Scope: work ONLY within these files: ${task.files.join(', ') || '(no files declared; analysis only)'}. ` +
        `Plan reference: ${record.planId}. Task ${task.id} of run ${record.id}.`

      try {
        const started = await runSpecialist(
          {
            specialist: task.specialist,
            task: prompt.slice(0, MAX_TASK_TEXT),
            contextPaths: task.files.slice(0, 10),
            planId: record.planId,
          },
          { provider: options.provider, timeoutMs: options.timeoutMs }
        )

        task.state = 'running'
        task.specialistRunId = started.id
        task.error = null
        budget -= 1
        recordHistory(record, {
          kind: 'task-started',
          task: task.id,
          specialist: task.specialist,
          attempt: task.attempts,
        })
      } catch (error) {
        task.state = 'failed'
        task.error = `Specialist start failed: ${error.message}`.slice(0, 500)
        recordHistory(record, { kind: 'task-failed', task: task.id, reason: task.error })
      }
    }

    // Completion: every task terminal AND no task awaiting a
    // retry-or-cancel decision. Failed and timed-out tasks hold the
    // run open deliberately: the operator retries or cancels them
    // explicitly instead of the run silently completing underneath.
    // Partial completion is an honest outcome, not a failure to hide.
    const awaitingDecision = record.tasks.some(
      (task) => task.state === 'failed' || task.state === 'timeout'
    )

    if (
      !awaitingDecision &&
      record.tasks.every((task) => TERMINAL_TASK_STATES.includes(task.state))
    ) {
      const mergedCount = record.tasks.filter((task) => task.state === 'merged').length

      record.state = 'completed'
      record.outcome = {
        merged: mergedCount,
        total: record.tasks.length,
        partial: mergedCount !== record.tasks.length,
        byState: record.tasks.reduce((acc, task) => {
          acc[task.state] = (acc[task.state] || 0) + 1

          return acc
        }, {}),
      }
      recordHistory(record, { kind: 'completed', ...record.outcome })
      liveRuns.delete(record.id)
    }

    record.updatedAt = nowIso()
    await writeRun(root, record)

    return present(root, record)
  })
}

function editDisplayPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/')
}

// Approves one proposed task and merges it. Coding proposals merge
// through ownership checks, change-set analysis, and the guarded
// apply path; other specialists merge as accepted findings with zero
// disk writes. Sequential per run via the run mutex.
async function approveTask(runId, taskId) {
  const root = openRoot()

  return withRunLock(assertRunId(runId), async () => {
    const record = await readRun(root, runId)

    if (record.state !== 'active') {
      throw new Error(`Run is ${record.state}; nothing can be approved.`)
    }

    const task = record.tasks.find((entry) => entry.id === taskId)

    if (!task) {
      throw new Error('Task not found.')
    }

    if (task.state !== 'proposed' || !task.proposal) {
      throw new Error(`Task is ${task.state}; only proposed tasks can be approved.`)
    }

    if (task.specialist !== 'coding') {
      task.state = 'merged'
      task.merge = { edits: 0, note: 'Findings accepted; no disk writes for this specialist.' }
      record.updatedAt = nowIso()
      recordHistory(record, { kind: 'task-merged', task: task.id, edits: 0 })
      await attachPlanEvidence(record, task, 'Findings accepted.')
      await writeRun(root, record)

      return present(root, record)
    }

    const edits = task.proposal.result && task.proposal.result.edits

    if (!Array.isArray(edits)) {
      task.state = 'rejected'
      task.error = 'Proposal holds no edits.'
      recordHistory(record, { kind: 'task-rejected', task: task.id, reason: task.error })
      await writeRun(root, record)

      return present(root, record)
    }

    // Ownership check: every edit must target a file this task owns.
    const owned = new Set(task.files)
    const overreach = []

    for (const edit of edits) {
      const display = editDisplayPath(root, edit.path)

      if (!owned.has(display) && !owned.has(edit.path)) {
        overreach.push(display)
      }
    }

    if (overreach.length > 0) {
      task.state = 'rejected'
      task.error =
        `Proposal touches files outside this task's scope: ${overreach.join(', ')}. ` +
        'Rejected; nothing was written.'
      recordHistory(record, { kind: 'task-rejected', task: task.id, reason: task.error })
      await writeRun(root, record)

      return present(root, record)
    }

    // Cross-task conflict check: no other UNMERGED task may own the
    // same files (a merged task's files are guarded by the freshness
    // gate at apply time instead).
    const myKeys = new Set(edits.map((edit) => canonicalTargetKey(edit.path)))

    for (const other of record.tasks) {
      if (other.index === task.index || other.state === 'merged') {
        continue
      }

      for (const file of other.files) {
        let key = null

        try {
          key = canonicalTargetKey(path.join(root, file))
        } catch {
          continue
        }

        if (myKeys.has(key)) {
          task.state = 'blocked'
          task.error =
            `Merge conflict: task ${other.id} (${other.state}) also owns "${file}". ` +
            'Resolve the scopes before approving.'
          recordHistory(record, { kind: 'task-blocked', task: task.id, reason: task.error })
          await writeRun(root, record)

          return present(root, record)
        }
      }
    }

    // Change-set analysis: blockers stop the merge for human review.
    let manifest = null

    try {
      manifest = await buildChangeSet(
        edits.map((edit) => ({
          path: edit.path,
          action: edit.action,
          content: edit.content,
          originalDigest: edit.originalDigest,
          originalLength: edit.originalLength,
        }))
      )
    } catch (error) {
      task.state = 'rejected'
      task.error = `Change-set analysis failed: ${error.message}`.slice(0, 500)
      recordHistory(record, { kind: 'task-rejected', task: task.id, reason: task.error })
      await writeRun(root, record)

      return present(root, record)
    }

    if (manifest && manifest.validation && manifest.validation.ok === false) {
      const blockers = manifest.validation.blockers || []

      task.state = 'blocked'
      task.error =
        `Change-set blockers: ${blockers.map((entry) => entry.reason || entry.kind).join('; ') || 'see manifest'}. ` +
        'Resolve before approving.'
      task.merge = { manifest: manifestSummary(manifest) }
      recordHistory(record, { kind: 'task-blocked', task: task.id, reason: task.error })
      await writeRun(root, record)

      return present(root, record)
    }

    // Ordered apply through the guarded path: freshness gate,
    // checkpoints, atomic rollback, and cancellation all enforced.
    const order = manifest && Array.isArray(manifest.order) ? manifest.order : null
    const byEditIndex = new Map(edits.map((edit) => [edit.index, edit]))
    const ordered = order
      ? order.map((index) => byEditIndex.get(index)).filter(Boolean)
      : edits

    if (ordered.length !== edits.length) {
      task.state = 'rejected'
      task.error = 'Change-set order does not cover every edit; rejected without writing.'
      recordHistory(record, { kind: 'task-rejected', task: task.id, reason: task.error })
      await writeRun(root, record)

      return present(root, record)
    }

    const applied = await applyEdits(
      {
        task: `Orchestrated task ${task.id}: ${task.title}`.slice(0, 4000),
        edits: ordered.map((edit) => ({
          path: edit.path,
          action: edit.action,
          content: edit.content,
          originalDigest: edit.originalDigest,
          originalLength: edit.originalLength,
        })),
      }
    )

    if (applied.cancelled) {
      task.state = 'cancelled'
      task.error = 'Merge was cancelled during apply.'
      recordHistory(record, { kind: 'task-cancelled', task: task.id })
      await writeRun(root, record)

      return present(root, record)
    }

    if (!applied.completed) {
      if (applied.stale && applied.stale.length > 0) {
        task.state = 'stale'
        task.error =
          `Stale files at merge: ${applied.stale.map((entry) => entry.path).join(', ')}. ` +
          'Nothing was written.'
      } else if (applied.conflicts && applied.conflicts.length > 0) {
        task.state = 'blocked'
        task.error =
          `Conflicting edits at merge: ${applied.conflicts.map((entry) => entry.path).join(', ')}. ` +
          'Nothing was written.'
      } else {
        task.state = 'failed'
        task.error = (applied.failed && applied.failed.message) || 'Apply failed without writing.'
      }

      recordHistory(record, { kind: 'task-merge-stopped', task: task.id, reason: task.error })
      await writeRun(root, record)

      return present(root, record)
    }

    task.state = 'merged'
    task.merge = {
      edits: applied.applied ? applied.applied.length : edits.length,
      checkpoint: applied.checkpoint ? applied.checkpoint.id : null,
      files: edits.map((edit) => editDisplayPath(root, edit.path)),
    }
    record.updatedAt = nowIso()
    recordHistory(record, { kind: 'task-merged', task: task.id, edits: task.merge.edits })
    await attachPlanEvidence(record, task, `Merged ${task.merge.edits} edit(s).`)
    await writeRun(root, record)

    return present(root, record)
  })
}

function manifestSummary(manifest) {
  return {
    order: manifest.order || [],
    conflicts: manifest.conflicts || [],
    cycles: manifest.cycles || [],
    blockers: (manifest.validation && manifest.validation.blockers) || [],
  }
}

async function attachPlanEvidence(record, task, summary) {
  if (!task.planStepId) {
    return
  }

  try {
    await attachEvidence(record.planId, task.planStepId, {
      kind: 'note',
      ref: `orchestration:${record.id}:${task.id}`,
      summary: `${task.title}: ${summary} (run ${record.id})`.slice(0, 500),
    })
  } catch (error) {
    log.warn(`Plan evidence attach failed: ${error.message}`)
  }
}

// Retries a failed, timed-out, stale, blocked, or rejected task with
// a fresh specialist run. Attempt budget enforced; merged tasks are
// never retried.
async function retryTask(runId, taskId, options = {}) {
  const root = openRoot()

  return withRunLock(assertRunId(runId), async () => {
    const record = await readRun(root, runId)

    if (record.state !== 'active') {
      throw new Error(`Run is ${record.state}; nothing can be retried.`)
    }

    const task = record.tasks.find((entry) => entry.id === taskId)

    if (!task) {
      throw new Error('Task not found.')
    }

    if (!['failed', 'timeout', 'stale', 'blocked', 'rejected'].includes(task.state)) {
      throw new Error(`Task is ${task.state}; only stopped tasks can be retried.`)
    }

    if (task.attempts >= MAX_ATTEMPTS) {
      throw new Error(`Attempt budget exhausted (${MAX_ATTEMPTS}).`)
    }

    task.attempts += 1
    task.error = null
    task.proposal = null

    const prompt =
      `${task.title}\n\n${task.detail}\n\n` +
      `Scope: work ONLY within these files: ${task.files.join(', ') || '(no files declared; analysis only)'}. ` +
      `Plan reference: ${record.planId}. Task ${task.id} of run ${record.id} (retry ${task.attempts}).`

    try {
      const started = await runSpecialist(
        {
          specialist: task.specialist,
          task: prompt.slice(0, MAX_TASK_TEXT),
          contextPaths: task.files.slice(0, 10),
          planId: record.planId,
        },
        { provider: options.provider, timeoutMs: options.timeoutMs }
      )

      task.state = 'running'
      task.specialistRunId = started.id
      liveRuns.add(record.id)
      recordHistory(record, { kind: 'task-retried', task: task.id, attempt: task.attempts })
    } catch (error) {
      task.state = 'failed'
      task.error = `Retry start failed: ${error.message}`.slice(0, 500)
      recordHistory(record, { kind: 'task-failed', task: task.id, reason: task.error })
    }

    record.updatedAt = nowIso()
    await writeRun(root, record)

    return present(root, record)
  })
}

// Cancels a run: live specialists are aborted, running tasks are
// marked cancelled, and merged work (with checkpoints) is preserved.
async function cancelRun(runId) {
  const root = openRoot()

  return withRunLock(assertRunId(runId), async () => {
    const record = await readRun(root, runId)

    if (record.state === 'completed' || record.state === 'cancelled') {
      return present(root, record)
    }

    let cancelled = 0

    for (const task of record.tasks) {
      if (task.state === 'running' && task.specialistRunId) {
        cancelSpecialistRun(task.specialistRunId)
        task.state = 'cancelled'
        task.error = 'Run was cancelled.'
        cancelled += 1
        recordHistory(record, { kind: 'task-cancelled', task: task.id })
      } else if (task.state === 'pending' || task.state === 'proposed') {
        task.state = 'cancelled'
        task.error = 'Run was cancelled before merge.'
        recordHistory(record, { kind: 'task-cancelled', task: task.id })
      }
    }

    record.state = 'cancelled'
    record.outcome = {
      merged: record.tasks.filter((task) => task.state === 'merged').length,
      total: record.tasks.length,
      partial: true,
      cancelledSpecialists: cancelled,
    }
    record.updatedAt = nowIso()
    recordHistory(record, { kind: 'cancelled' })
    liveRuns.delete(record.id)
    await writeRun(root, record)

    return present(root, record)
  })
}

module.exports = {
  MAX_TASKS,
  MAX_PARALLEL,
  MAX_ATTEMPTS,
  startRun,
  advanceRun,
  approveTask,
  retryTask,
  cancelRun,
  getRun,
  listRuns,
}
