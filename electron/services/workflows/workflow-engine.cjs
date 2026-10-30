// Workflow execution engine (Level 4A.3). Runs validated
// definitions through existing services with explicit advance /
// approve / resume / cancel transitions — no autonomous loops.
// Approval checkpoints pause the run; apply and diagnostics steps
// require a prior approval in the same run; retries are budgeted;
// timeouts bound every step; history persists under
// `.kryom/workflows/runs/` with bounded retention.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')

const {
  getWorkflow,
} = require('./workflow-store.cjs')
const {
  ensureStorageDir,
  writeStorageFile,
  readStorageFile,
} = require('../../security/storage-path.cjs')
const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
} = require('../../security/validate-input.cjs')
const {
  appendAudit,
} = require('../audit/audit.service.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('workflow-engine')

const RUNS_SEGMENTS = ['.kryom', 'workflows', 'runs']
const RUN_VERSION = 1
const RUN_ID_PATTERN = /^wf-[0-9a-z]+-[0-9a-f]+$/
const MAX_RUNS = 30
const MAX_HISTORY = 100
const MAX_OUTPUT_BYTES = 256 * 1024
const POLL_INTERVAL_MS = 250

const TERMINAL_RUN_STATES = ['completed', 'failed', 'cancelled']

// Process-local liveness: runs this process started advancing.
const liveRuns = new Set()

function newRunId() {
  return `wf-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
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
    throw new Error('Invalid workflow run id.')
  }

  return value
}

function runSegments(runId) {
  return [...RUNS_SEGMENTS, `${assertRunId(runId)}.json`]
}

async function writeRun(root, record) {
  record.updatedAt = nowIso()

  await ensureStorageDir(root, RUNS_SEGMENTS)
  await writeStorageFile(root, runSegments(record.id), JSON.stringify(record))

  try {
    const dir = await ensureStorageDir(root, RUNS_SEGMENTS)
    const entries = (await fs.readdir(dir))
      .filter((entry) => RUN_ID_PATTERN.test(entry.replace(/\.json$/, '')))
      .sort()

    // Only terminal records are prunable: live and unfinished runs
    // (active, awaiting-approval) survive retention. Unreadable
    // records prune as before so corruption cannot pin the cap.
    for (const stale of entries.slice(0, Math.max(0, entries.length - MAX_RUNS))) {
      const staleId = stale.replace(/\.json$/, '')

      if (liveRuns.has(staleId)) {
        continue
      }

      let state = null

      try {
        const { found, data } = await readStorageFile(root, runSegments(staleId))

        if (found && data) {
          state = JSON.parse(data).state ?? null
        }
      } catch {
        state = null
      }

      if (state !== null && !TERMINAL_RUN_STATES.includes(state)) {
        continue
      }

      await fs.unlink(`${dir}/${stale}`).catch(() => undefined)
    }
  } catch {
    // Retention is best-effort.
  }

  return record
}

async function readRun(root, runId) {
  const { found, data } = await readStorageFile(root, runSegments(assertRunId(runId)))

  if (!found || !data) {
    throw new Error('Workflow run not found.')
  }

  try {
    return JSON.parse(data)
  } catch {
    throw new Error('Workflow run record is corrupt.')
  }
}

function recordHistory(record, event) {
  record.history.push({ at: nowIso(), ...event })

  if (record.history.length > MAX_HISTORY) {
    record.history = record.history.slice(-MAX_HISTORY)
  }
}

function present(record) {
  if ((record.state === 'active' || record.state === 'awaiting-approval') && !liveRuns.has(record.id)) {
    return { ...record, state: 'interrupted', interrupted: true }
  }

  return record
}

function boundOutput(value) {
  const serialized = JSON.stringify(value ?? null)

  if (serialized.length > MAX_OUTPUT_BYTES) {
    return { truncated: true, preview: serialized.slice(0, MAX_OUTPUT_BYTES) }
  }

  return value ?? null
}

// Safe template resolution: {{inputs.name}} and
// {{steps.<id>.<a>.<b>}} only, own-properties, no prototypes.
function getPath(root, segments) {
  let current = root

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      if (Array.isArray(current) && /^\d+$/.test(segment)) {
        current = current[Number(segment)]
        continue
      }

      return undefined
    }

    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined
    }

    current = current[segment]
  }

  return current
}

function resolveTemplates(value, context) {
  if (typeof value === 'string') {
    const single = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/)

    if (single) {
      return lookupReference(single[1].trim(), context)
    }

    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, ref) => {
      const found = lookupReference(String(ref).trim(), context)

      return found === undefined || found === null
        ? ''
        : typeof found === 'string' ? found : JSON.stringify(found)
    })
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveTemplates(entry, context))
  }

  if (value && typeof value === 'object') {
    const out = {}

    for (const [key, entry] of Object.entries(value)) {
      out[key] = resolveTemplates(entry, context)
    }

    return out
  }

  return value
}

function lookupReference(ref, context) {
  const segments = ref.split('.').filter(Boolean)

  if (segments[0] === 'inputs' && segments.length === 2) {
    return context.inputs[segments[1]]
  }

  if (segments[0] === 'steps' && segments.length >= 3) {
    const stepOutput = context.steps[segments[1]]

    if (!stepOutput) {
      return undefined
    }

    return getPath(stepOutput, segments.slice(2))
  }

  throw new Error(`Invalid template reference "{{${ref}}}": use {{inputs.name}} or {{steps.<id>.<path>}}.`)
}

function evaluateCondition(condition, context) {
  if (!condition) {
    return true
  }

  const actual = lookupReference(condition.ref, context)

  if (condition.exists !== undefined) {
    const want = condition.exists === true || condition.exists === 'true'

    return want ? actual !== undefined && actual !== null : actual === undefined || actual === null
  }

  if (condition.equals !== undefined) {
    return String(actual ?? '') === String(condition.equals)
  }

  if (condition.contains !== undefined) {
    return String(actual ?? '').includes(String(condition.contains))
  }

  return false
}

function withTimeout(promise, ms, label) {
  let timer = null

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms.`)), ms)

    if (timer.unref) {
      timer.unref()
    }
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

function normalizePaths(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string')
  }

  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean)
  }

  return undefined
}

// Step executors. Each maps to an existing controlled service;
// nothing here writes, executes, or diagnoses on its own.
async function executeStepKind(step, resolved, context, options) {
  const provider = options.provider

  switch (step.kind) {
    case 'intelligence.search': {
      const { searchProject } = require('../project-intelligence/semantic-search.service.cjs')
      const query = typeof resolved.params.query === 'string' && resolved.params.query.trim()
        ? resolved.params.query
        : context.task

      if (!query) {
        throw new Error('intelligence.search needs params.query or a run task.')
      }

      return boundOutput(await searchProject(query))
    }

    case 'intelligence.architecture': {
      const { analyzeArchitecture } = require('../project-intelligence/architecture.service.cjs')

      return boundOutput(await analyzeArchitecture())
    }

    case 'intelligence.impact': {
      const { analyzeImpact } = require('../project-intelligence/impact-analysis.service.cjs')
      const paths = normalizePaths(resolved.params.paths)

      if (!paths || paths.length === 0) {
        throw new Error('intelligence.impact needs params.paths.')
      }

      return boundOutput(await analyzeImpact({ paths }))
    }

    case 'planning.build': {
      const { buildImplementationPlan } = require('../planning/plan-builder.cjs')
      const requirement = typeof resolved.params.requirement === 'string' && resolved.params.requirement.trim()
        ? resolved.params.requirement
        : context.task

      if (!requirement) {
        throw new Error('planning.build needs params.requirement or a run task.')
      }

      const built = await buildImplementationPlan(
        { requirement, contextPaths: normalizePaths(resolved.params.contextPaths) },
        provider ? { provider } : {}
      )

      return boundOutput({
        planId: built.plan.id,
        subtasks: built.decomposition.subtasks,
        executionOrder: built.executionOrder,
        parallelGroups: built.parallelGroups,
        sharedFileConflicts: built.sharedFileConflicts,
      })
    }

    case 'skill.run': {
      const { runSkill } = require('../skills/skill-runner.cjs')
      const task = typeof resolved.params.task === 'string' && resolved.params.task.trim()
        ? resolved.params.task
        : context.task

      if (!task) {
        throw new Error('skill.run needs params.task or a run task.')
      }

      // Workflow approvals propagate: a prior approval in this run
      // authorizes the skill's gated tools for this step only.
      const approved = context.approvals.some((entry) => entry.decision === 'approve')

      return boundOutput(
        await runSkill(
          {
            skillId: step.uses,
            task,
            contextPaths: normalizePaths(resolved.params.contextPaths),
            planId: typeof resolved.params.planId === 'string' ? resolved.params.planId : undefined,
            params: resolved.params.params || {},
            approved,
          },
          { ...(provider ? { provider } : {}), ...(options.baseDir ? { baseDir: options.baseDir } : {}) }
        )
      )
    }

    case 'specialist.run': {
      const { runSpecialist, getSpecialistRun, cancelSpecialistRun } = require('../specialists/specialist.service.cjs')
      const started = await runSpecialist(
        {
          specialist: step.specialist,
          task: resolved.task,
          contextPaths: normalizePaths(resolved.params.contextPaths),
        },
        provider ? { provider } : {}
      )

      context.specialistRuns[step.id] = started.id

      const deadline = Date.now() + step.timeoutMs

      for (;;) {
        const current = await getSpecialistRun(started.id)

        if (current.state !== 'running') {
          delete context.specialistRuns[step.id]

          if (current.state !== 'succeeded') {
            throw new Error(`Specialist ${step.specialist} ended ${current.state}: ${current.error || 'no result'}`)
          }

          return boundOutput({ specialistRunId: current.id, result: current.result })
        }

        if (Date.now() > deadline) {
          cancelSpecialistRun(started.id)
          delete context.specialistRuns[step.id]

          throw new Error(`Specialist ${step.specialist} timed out after ${step.timeoutMs} ms.`)
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
    }

    case 'agent.propose': {
      const { planTask } = require('../agent/agent.service.cjs')
      const task = typeof resolved.params.task === 'string' && resolved.params.task.trim()
        ? resolved.params.task
        : context.task

      if (!task) {
        throw new Error('agent.propose needs params.task or a run task.')
      }

      const proposal = await planTask(
        { task, contextPaths: normalizePaths(resolved.params.contextPaths) },
        provider ? { provider } : {}
      )

      return boundOutput({
        edits: proposal.edits,
        commands: proposal.commands,
        notes: proposal.notes,
        expectedOutcome: proposal.expectedOutcome,
        risks: proposal.risks,
      })
    }

    case 'agent.apply': {
      if (!context.approvals.some((entry) => entry.decision === 'approve')) {
        throw new Error('agent.apply needs a prior approval checkpoint in this run.')
      }

      if (!Array.isArray(resolved.params.edits)) {
        throw new Error('agent.apply needs params.edits (usually from a proposal step).')
      }

      const { applyEdits } = require('../agent/agent.service.cjs')

      return boundOutput(
        await applyEdits({ task: `Workflow ${context.runId} apply`, edits: resolved.params.edits })
      )
    }

    case 'diagnostics.run': {
      if (!context.approvals.some((entry) => entry.decision === 'approve')) {
        throw new Error('diagnostics.run needs a prior approval checkpoint in this run.')
      }

      if (typeof resolved.params.command !== 'string' || !resolved.params.command) {
        throw new Error('diagnostics.run needs params.command.')
      }

      const { runDiagnostics } = require('../diagnostics/diagnostics.service.cjs')

      return boundOutput(await runDiagnostics(resolved.params.command))
    }

    case 'quality.build': {
      const { buildQualityReport } = require('../quality/quality.service.cjs')

      return boundOutput(
        await buildQualityReport({
          paths: normalizePaths(resolved.params.paths),
          planId: typeof resolved.params.planId === 'string' ? resolved.params.planId : undefined,
        })
      )
    }

    case 'report': {
      const lines = [`# Workflow report: ${context.workflowName}`, '']

      for (const stepState of context.stepStates) {
        lines.push(`- ${stepState.id}: ${stepState.state}${stepState.error ? ` — ${stepState.error}` : ''}`)
      }

      lines.push('', 'Evidence lives in the step outputs recorded on this run.')

      return boundOutput({ report: lines.join('\n').slice(0, 8000) })
    }

    default:
      throw new Error(`Step kind "${step.kind}" is not executable.`)
  }
}

async function auditRun(type, runId, detail, outcome = null) {
  try {
    await appendAudit(type, { subject: `workflow:${runId}`, detail }, undefined, outcome)
  } catch {
    // Audit failure never fails the run transition.
  }
}

async function startRun(payload, options = {}) {
  assertPlainObject(payload, 'workflow run')

  const workflowId = assertNonEmptyString(payload.workflowId, 'workflow id', 80)
  const workflow = await getWorkflow(workflowId, { baseDir: options.baseDir })
  const root = openRoot()

  const inputs = {}

  for (const input of workflow.inputs) {
    const provided = payload.inputs && payload.inputs[input.name]

    inputs[input.name] = typeof provided === 'string' ? provided.slice(0, 4000) : input.default
  }

  const task = typeof payload.task === 'string' ? payload.task.slice(0, 4000) : ''

  const record = {
    version: RUN_VERSION,
    id: newRunId(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowVersion: workflow.version,
    state: 'active',
    inputs,
    task,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      title: step.title,
      state: 'pending',
      attempts: 0,
      output: null,
      error: null,
    })),
    approvals: [],
    pendingStep: null,
    outcome: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    history: [],
  }

  recordHistory(record, { kind: 'started', workflow: workflow.id })
  await writeRun(root, record)
  liveRuns.add(record.id)
  await auditRun('workflow.started', record.id, workflow.id, 'started')

  log.info(`Workflow run ${record.id} started (${workflow.id}).`)

  return present(record)
}

function buildContext(record, options) {
  const steps = {}

  for (const step of record.steps) {
    if (step.output !== null && step.output !== undefined) {
      steps[step.id] = step.output
    }
  }

  return {
    runId: record.id,
    workflowName: record.workflowName,
    inputs: record.inputs,
    task: record.task,
    steps,
    stepStates: record.steps,
    approvals: record.approvals,
    specialistRuns: options.specialistRuns || {},
  }
}

async function advanceRun(runId, options = {}) {
  const root = openRoot()
  const record = await readRun(root, assertRunId(runId))

  if (TERMINAL_RUN_STATES.includes(record.state)) {
    throw new Error(`Run is ${record.state}; it cannot advance.`)
  }

  if (record.state === 'awaiting-approval') {
    throw new Error('Run is awaiting approval; approve or deny the checkpoint first.')
  }

  if (!liveRuns.has(record.id)) {
    record.state = 'interrupted'
    record.updatedAt = nowIso()
    recordHistory(record, { kind: 'interrupted', reason: 'Run was started by another process.' })
    await writeRun(root, record)

    return present(record)
  }

  const workflow = await getWorkflow(record.workflowId, { baseDir: options.baseDir }).catch(() => null)

  if (!workflow) {
    record.state = 'failed'
    record.outcome = { completed: false, reason: 'Workflow definition is no longer available.' }
    record.updatedAt = nowIso()
    recordHistory(record, { kind: 'failed', reason: record.outcome.reason })
    await writeRun(root, record)

    return present(record)
  }

  const definitions = new Map(workflow.steps.map((step) => [step.id, step]))

  for (const stepState of record.steps) {
    if (stepState.state === 'ok' || stepState.state === 'failed' || stepState.state === 'skipped') {
      continue
    }

    const definition = definitions.get(stepState.id)

    if (!definition) {
      stepState.state = 'failed'
      stepState.error = 'Step definition is missing.'
      recordHistory(record, { kind: 'step-failed', step: stepState.id, reason: stepState.error })
      break
    }

    const context = buildContext(record, options)

    // Conditions gate the step on prior outputs.
    try {
      if (!evaluateCondition(definition.if, context)) {
        stepState.state = 'skipped'
        recordHistory(record, { kind: 'step-skipped', step: stepState.id })
        continue
      }
    } catch (error) {
      stepState.state = 'failed'
      stepState.error = error.message
      recordHistory(record, { kind: 'step-failed', step: stepState.id, reason: stepState.error })
      break
    }

    if (definition.kind === 'approval.checkpoint') {
      stepState.state = 'awaiting'
      record.state = 'awaiting-approval'
      record.pendingStep = stepState.id
      record.updatedAt = nowIso()
      recordHistory(record, { kind: 'awaiting-approval', step: stepState.id })
      await writeRun(root, record)

      return present(record)
    }

    stepState.state = 'running'
    await writeRun(root, record)

    let resolved = null

    try {
      resolved = {
        params: resolveTemplates(definition.params || {}, context),
        task: definition.task ? resolveTemplates(definition.task, context) : null,
      }
    } catch (error) {
      stepState.state = 'failed'
      stepState.error = error.message
      recordHistory(record, { kind: 'step-failed', step: stepState.id, reason: stepState.error })
      break
    }

    let lastError = null
    let succeeded = false

    for (let attempt = 0; attempt <= definition.retries; attempt += 1) {
      stepState.attempts += 1

      try {
        const output = await withTimeout(
          executeStepKind(definition, resolved, buildContext(record, options), options),
          definition.timeoutMs,
          `Step "${stepState.id}"`
        )

        stepState.state = 'ok'
        stepState.output = boundOutput(output)
        stepState.error = null
        succeeded = true
        recordHistory(record, { kind: 'step-ok', step: stepState.id, attempt: stepState.attempts })
        break
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)

        // Approval and cancellation failures never retry.
        if (/approval|approvals|cancelled/i.test(lastError)) {
          break
        }
      }
    }

    if (!succeeded) {
      stepState.state = 'failed'
      stepState.error = (lastError || 'Step failed.').slice(0, 1000)
      recordHistory(record, { kind: 'step-failed', step: stepState.id, reason: stepState.error })

      if (definition.onFailure !== 'continue') {
        record.state = 'failed'
        record.outcome = {
          completed: false,
          reason: `Step "${stepState.id}" failed: ${stepState.error}`,
          failedStep: stepState.id,
        }
        recordHistory(record, { kind: 'failed', ...record.outcome })
        liveRuns.delete(record.id)
        await writeRun(root, record)
        await auditRun('workflow.finished', record.id, `${record.workflowId}: failed`, 'failed')

        return present(record)
      }

      await writeRun(root, record)
    } else {
      await writeRun(root, record)
    }
  }

  const failed = record.steps.filter((step) => step.state === 'failed')
  const incomplete = record.steps.filter((step) => step.state === 'pending' || step.state === 'running' || step.state === 'awaiting')

  if (incomplete.length === 0) {
    // Success needs evidence: every non-skipped step ok, or failed
    // steps explicitly marked continue.
    const blocking = failed.filter((step) => {
      const definition = definitions.get(step.id)

      return !definition || definition.onFailure !== 'continue'
    })

    record.state = blocking.length === 0 ? 'completed' : 'failed'
    record.outcome = {
      completed: blocking.length === 0,
      ok: record.steps.filter((step) => step.state === 'ok').length,
      failed: failed.length,
      skipped: record.steps.filter((step) => step.state === 'skipped').length,
    }
    record.pendingStep = null
    recordHistory(record, { kind: record.state, ...record.outcome })
    liveRuns.delete(record.id)
    await auditRun(
      'workflow.finished',
      record.id,
      `${record.workflowId}: ${record.state}`,
      record.state
    )
  }

  record.updatedAt = nowIso()
  await writeRun(root, record)

  return present(record)
}

async function approveRun(runId, { decision, note } = {}) {
  if (decision !== 'approve' && decision !== 'deny') {
    throw new Error('Approval decision must be approve or deny.')
  }

  const root = openRoot()
  const record = await readRun(root, assertRunId(runId))

  if (record.state !== 'awaiting-approval' || !record.pendingStep) {
    throw new Error(`Run is ${record.state}; no checkpoint awaits approval.`)
  }

  liveRuns.add(record.id)

  const stepState = record.steps.find((step) => step.id === record.pendingStep)

  if (decision === 'deny') {
    const deniedStep = record.pendingStep

    if (stepState) {
      stepState.state = 'failed'
      stepState.error = 'Approval denied.'
    }

    record.state = 'cancelled'
    record.outcome = { completed: false, reason: 'Approval denied.' }
    record.pendingStep = null
    recordHistory(record, { kind: 'denied', step: deniedStep, note: note || '' })
    liveRuns.delete(record.id)
    await writeRun(root, record)
    await auditRun('workflow.approved', record.id, 'denied', 'denied')

    return present(record)
  }

  record.approvals.push({
    stepId: record.pendingStep,
    decision: 'approve',
    at: nowIso(),
    note: typeof note === 'string' ? note.slice(0, 500) : '',
  })

  if (stepState) {
    stepState.state = 'ok'
    stepState.output = { approved: true }
  }

  record.state = 'active'
  record.pendingStep = null
  recordHistory(record, { kind: 'approved' })
  await writeRun(root, record)
  await auditRun('workflow.approved', record.id, 'approved', 'approved')

  return present(record)
}

async function resumeRun(runId, options = {}) {
  const root = openRoot()
  const record = await readRun(root, assertRunId(runId))

  if (record.state !== 'interrupted') {
    throw new Error(`Run is ${record.state}; only interrupted runs resume.`)
  }

  liveRuns.add(record.id)
  record.state = record.pendingStep ? 'awaiting-approval' : 'active'
  recordHistory(record, { kind: 'resumed' })
  await writeRun(root, record)

  if (record.state === 'active') {
    return advanceRun(runId, options)
  }

  return present(record)
}

async function cancelRun(runId, options = {}) {
  const root = openRoot()
  const record = await readRun(root, assertRunId(runId))

  if (TERMINAL_RUN_STATES.includes(record.state)) {
    return present(record)
  }

  // Best-effort: cancel any live specialist the run started.
  const specialistRuns = options.specialistRuns || {}

  for (const runRef of Object.values(specialistRuns)) {
    try {
      const { cancelSpecialistRun } = require('../specialists/specialist.service.cjs')

      cancelSpecialistRun(runRef)
    } catch {
      // Best-effort only.
    }
  }

  for (const stepState of record.steps) {
    if (['pending', 'running', 'awaiting'].includes(stepState.state)) {
      stepState.state = 'failed'
      stepState.error = 'Run was cancelled.'
    }
  }

  record.state = 'cancelled'
  record.outcome = { completed: false, reason: 'Cancelled.' }
  record.pendingStep = null
  recordHistory(record, { kind: 'cancelled' })
  liveRuns.delete(record.id)
  await writeRun(root, record)

  return present(record)
}

async function getRun(runId) {
  const root = openRoot()

  return present(await readRun(root, assertRunId(runId)))
}

async function listRuns() {
  const root = openRoot()
  const dir = await ensureStorageDir(root, RUNS_SEGMENTS)
  const entries = await fs.readdir(dir)
  const runs = []
  const corrupt = []

  for (const entry of entries) {
    const id = entry.replace(/\.json$/, '')

    if (!RUN_ID_PATTERN.test(id)) {
      continue
    }

    try {
      const record = await readRun(root, id)

      runs.push({
        id: record.id,
        workflowId: record.workflowId,
        workflowName: record.workflowName,
        state: present(record).state,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        outcome: record.outcome,
      })
    } catch (error) {
      log.warn(`Workflow run ${id} unreadable: ${error.message}`)
      corrupt.push(id)
    }
  }

  runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  return { runs: runs.slice(0, MAX_RUNS), total: runs.length, corrupt: corrupt.sort() }
}

module.exports = {
  startRun,
  advanceRun,
  approveRun,
  resumeRun,
  cancelRun,
  getRun,
  listRuns,
}
