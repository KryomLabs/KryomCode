// Persistent execution plans (Level 3A.3). Every agent proposal can be
// tracked as a plan record under `.kryom/plans/<id>/plan.json` with
// verification reports beside it under `reports/`. Plans carry risks,
// an expected outcome, ordered steps with enforced states, and
// evidence links; a step becomes `verified` only with a persisted
// passing verification report attached — never on claim alone.
//
// Migration: proposals predate persistence (v1 shape, no id). Any
// v1-shaped proposal normalizes into a v2 record on track, so old
// drafts and old callers keep working; the store itself only ever
// writes v2.
//
// Recovery: step liveness is process-local. A step stored as
// `in_progress` that this process never started is reported with
// `interrupted: true` — it is never silently completed, and only an
// explicit resume/cancel/block transition changes it.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  resolveStoragePath,
  ensureStorageDir,
  writeStorageFile,
  readStorageFile,
  listStorageFiles,
} = require('../../security/storage-path.cjs')
const { redactText } = require('../../utils/logger.cjs')
const { createLogger } = require('../../utils/logger.cjs')
const {
  checkContextFreshness,
} = require('./context-snapshot.cjs')
const {
  sanitizeDiagnosis,
} = require('../diagnostics/diagnosis.cjs')
const {
  getObservedRun,
} = require('../diagnostics/diagnostics.service.cjs')

const log = createLogger('plans')

const PLANS_SEGMENTS = ['.kryom', 'plans']
const PLAN_VERSION = 2
const ID_PATTERN = /^pl-[a-z0-9-]{1,64}$/
const REPORT_ID_PATTERN = /^vr-[a-z0-9-]{1,64}$/
const STEP_ID_PATTERN = /^[a-z0-9-]{1,32}$/
const REPAIR_CYCLE_ID_PATTERN = /^rc-[0-9a-z]+-[0-9a-f]+$/
const CHECKPOINT_ID_PATTERN = /^cp-[a-z0-9-]{1,64}$/
const RUN_ID_PATTERN = /^dg-[0-9a-z]+-[0-9a-f]+$/

// Truthful conclusions (Level 3B.5). The first four describe an
// observed execution; the last three assert non-execution and must
// never carry execution facts.
const REPORT_CONCLUSIONS = [
  'passed',
  'failed',
  'cancelled',
  'timed_out',
  'blocked',
  'skipped',
  'not_executed',
]

// Renderer claims accepted at the record boundary. pass/fail/error
// name an observed run whose facts decide the conclusion; error
// without a run means the check could not execute (blocked); skip
// and not_executed assert deliberate non-execution with a reason.
const REPORT_CLAIMS = ['pass', 'fail', 'error', 'skip', 'not_executed']

const MAX_EXPLANATION_CHARS = 1000
const MAX_EXPLANATION_DETAIL_CHARS = 2000
const MAX_EXECUTION_COMMAND_CHARS = 2000
const STEP_STATES = [
  'pending',
  'in_progress',
  'completed',
  'verified',
  'blocked',
  'failed',
  'cancelled',
]
const STEP_KINDS = ['review', 'task', 'apply', 'verify']
const RISK_SEVERITIES = ['low', 'medium', 'high']
const EVIDENCE_KINDS = [
  'checkpoint',
  'report',
  'diagnostics',
  'file',
  'commit',
  'note',
  'research',
  'chat',
]
const TERMINAL_STATES = ['completed', 'verified', 'cancelled']
const MAX_PLANS = 50
const MAX_REPORTS_PER_PLAN = 50
const MAX_RISKS = 10
const MAX_STEPS = 14
const MAX_EVIDENCE_PER_STEP = 50
const MAX_TITLE_CHARS = 200
const MAX_TEXT_CHARS = 4000
const MAX_RISK_CHARS = 1000
const MAX_DETAIL_CHARS = 2000
const MAX_EVIDENCE_SUMMARY_CHARS = 500
const MAX_OUTPUT_SUMMARY_CHARS = 4000
// The file cap and path cap mirror the apply path's own bounds
// (MAX_EDITS / MAX_PATH_LENGTH in agent.service.cjs), so a
// legitimate repair attempt can never overflow its report.
const MAX_REPAIR_FILES = 20
const MAX_REPAIR_PATH_CHARS = 1000

// Allowed state transitions. `verified` additionally requires a
// passing verification report in the step's evidence (enforced in
// setStepState, not here).
const TRANSITIONS = {
  pending: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['completed', 'verified', 'blocked', 'failed', 'cancelled'],
  completed: ['verified', 'in_progress'],
  verified: ['in_progress'],
  blocked: ['in_progress', 'cancelled'],
  failed: ['in_progress', 'cancelled'],
  cancelled: [],
}

// Process-local liveness: planId -> Set of stepIds started here.
const liveSteps = new Map()

function nowIso() {
  return new Date().toISOString()
}

function newPlanId() {
  return `pl-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function newReportId() {
  return `vr-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function assertPlanId(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error('Invalid plan id.')
  }

  return value
}

function assertReportId(value) {
  if (typeof value !== 'string' || !REPORT_ID_PATTERN.test(value)) {
    throw new Error('Invalid verification report id.')
  }

  return value
}

function planSegments(id) {
  return [...PLANS_SEGMENTS, assertPlanId(id), 'plan.json']
}

function reportSegments(planId, reportId) {
  return [...PLANS_SEGMENTS, assertPlanId(planId), 'reports', `${assertReportId(reportId)}.json`]
}

function planDirSegments(id) {
  return [...PLANS_SEGMENTS, assertPlanId(id)]
}

function openRoot() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  return root
}

function isLive(planId, stepId) {
  const steps = liveSteps.get(planId)

  return Boolean(steps && steps.has(stepId))
}

function markLive(planId, stepId) {
  let steps = liveSteps.get(planId)

  if (!steps) {
    steps = new Set()
    liveSteps.set(planId, steps)
  }

  steps.add(stepId)
}

function boundedText(value, max, what) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid plan ${what}.`)
  }

  if (value.length > max) {
    throw new Error(`Invalid plan ${what}.`)
  }

  return value
}

function sanitizeRisk(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Plan record is corrupt.')
  }

  if (!RISK_SEVERITIES.includes(raw.severity)) {
    throw new Error('Plan record is corrupt.')
  }

  if (
    typeof raw.explanation !== 'string' ||
    !raw.explanation.trim() ||
    raw.explanation.length > MAX_RISK_CHARS ||
    typeof raw.mitigation !== 'string' ||
    !raw.mitigation.trim() ||
    raw.mitigation.length > MAX_RISK_CHARS
  ) {
    throw new Error('Plan record is corrupt.')
  }

  return {
    severity: raw.severity,
    explanation: raw.explanation,
    mitigation: raw.mitigation,
  }
}

function sanitizeEvidence(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Plan record is corrupt.')
  }

  if (!EVIDENCE_KINDS.includes(raw.kind)) {
    throw new Error('Plan record is corrupt.')
  }

  if (typeof raw.ref !== 'string' || !raw.ref || raw.ref.length > 1000) {
    throw new Error('Plan record is corrupt.')
  }

  if (
    raw.summary !== undefined &&
    (typeof raw.summary !== 'string' ||
      raw.summary.length > MAX_EVIDENCE_SUMMARY_CHARS)
  ) {
    throw new Error('Plan record is corrupt.')
  }

  if (typeof raw.at !== 'string' || !raw.at) {
    throw new Error('Plan record is corrupt.')
  }

  return {
    kind: raw.kind,
    ref: raw.ref,
    summary: raw.summary ?? '',
    at: raw.at,
  }
}

function sanitizeStep(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Plan record is corrupt.')
  }

  if (typeof raw.id !== 'string' || !STEP_ID_PATTERN.test(raw.id)) {
    throw new Error('Plan record is corrupt.')
  }

  if (!STEP_KINDS.includes(raw.kind)) {
    throw new Error('Plan record is corrupt.')
  }

  if (
    typeof raw.label !== 'string' ||
    !raw.label.trim() ||
    raw.label.length > MAX_TITLE_CHARS
  ) {
    throw new Error('Plan record is corrupt.')
  }

  if (!STEP_STATES.includes(raw.state)) {
    throw new Error('Plan record is corrupt.')
  }

  if (
    (raw.startedAt !== null &&
      (typeof raw.startedAt !== 'string' || !raw.startedAt)) ||
    (raw.finishedAt !== null &&
      (typeof raw.finishedAt !== 'string' || !raw.finishedAt))
  ) {
    throw new Error('Plan record is corrupt.')
  }

  if (
    raw.detail !== undefined &&
    (typeof raw.detail !== 'string' || raw.detail.length > MAX_DETAIL_CHARS)
  ) {
    throw new Error('Plan record is corrupt.')
  }

  if (!Array.isArray(raw.evidence) || raw.evidence.length > MAX_EVIDENCE_PER_STEP) {
    throw new Error('Plan record is corrupt.')
  }

  return {
    id: raw.id,
    kind: raw.kind,
    label: raw.label,
    state: raw.state,
    startedAt: raw.startedAt,
    finishedAt: raw.finishedAt,
    detail: raw.detail ?? '',
    evidence: raw.evidence.map(sanitizeEvidence),
  }
}

function assertSnapshotPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1000) {
    throw new Error('Plan record is corrupt.')
  }

  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    /^[a-zA-Z]:/.test(value)
  ) {
    throw new Error('Plan record is corrupt.')
  }

  for (const segment of value.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error('Plan record is corrupt.')
    }
  }

  return value
}

function sanitizeContextSnapshot(raw) {
  if (raw === null || raw === undefined) {
    return null
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Plan record is corrupt.')
  }

  if (
    typeof raw.at !== 'string' ||
    !raw.at ||
    typeof raw.projectName !== 'string' ||
    !raw.projectName
  ) {
    throw new Error('Plan record is corrupt.')
  }

  if (!Array.isArray(raw.files) || raw.files.length > 8) {
    throw new Error('Plan record is corrupt.')
  }

  const files = raw.files.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Plan record is corrupt.')
    }

    assertSnapshotPath(item.relativePath)

    if (
      typeof item.bytes !== 'number' ||
      !Number.isInteger(item.bytes) ||
      item.bytes < 0 ||
      item.bytes > 1024 * 1024 ||
      typeof item.digest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(item.digest) ||
      typeof item.excerpt !== 'string' ||
      item.excerpt.length > 200
    ) {
      throw new Error('Plan record is corrupt.')
    }

    return {
      relativePath: item.relativePath,
      bytes: item.bytes,
      digest: item.digest,
      excerpt: item.excerpt,
    }
  })

  return {
    at: raw.at,
    projectName: raw.projectName,
    files,
    research: sanitizeSnapshotResearch(raw.research),
    chat: sanitizeSnapshotChat(raw.chat),
    workspace: sanitizeSnapshotWorkspace(raw.workspace),
  }
}

function sanitizeSnapshotResearch(raw) {
  if (raw === null || raw === undefined) {
    return null
  }

  if (
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    typeof raw.sessionId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(raw.sessionId) ||
    typeof raw.objective !== 'string' ||
    raw.objective.length > 4000 ||
    typeof raw.status !== 'string' ||
    typeof raw.briefVersion !== 'number' ||
    !Number.isInteger(raw.briefVersion) ||
    raw.briefVersion < 0 ||
    typeof raw.excerptChars !== 'number' ||
    !Number.isInteger(raw.excerptChars) ||
    raw.excerptChars < 0 ||
    typeof raw.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(raw.digest) ||
    typeof raw.at !== 'string' ||
    !raw.at
  ) {
    throw new Error('Plan record is corrupt.')
  }

  return {
    sessionId: raw.sessionId,
    objective: raw.objective,
    status: raw.status,
    briefVersion: raw.briefVersion,
    excerptChars: raw.excerptChars,
    digest: raw.digest,
    at: raw.at,
  }
}

function sanitizeSnapshotChat(raw) {
  if (raw === null || raw === undefined) {
    return null
  }

  if (
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    typeof raw.messageCount !== 'number' ||
    !Number.isInteger(raw.messageCount) ||
    raw.messageCount < 1 ||
    typeof raw.chars !== 'number' ||
    !Number.isInteger(raw.chars) ||
    raw.chars < 0 ||
    raw.chars > 4000 ||
    typeof raw.truncated !== 'boolean' ||
    typeof raw.excerpt !== 'string' ||
    raw.excerpt.length > 4000 ||
    typeof raw.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(raw.digest) ||
    typeof raw.at !== 'string' ||
    !raw.at
  ) {
    throw new Error('Plan record is corrupt.')
  }

  return {
    messageCount: raw.messageCount,
    chars: raw.chars,
    truncated: raw.truncated,
    excerpt: raw.excerpt,
    digest: raw.digest,
    at: raw.at,
  }
}

function sanitizeSnapshotWorkspace(raw) {
  if (raw === null || raw === undefined) {
    return null
  }

  if (
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    typeof raw.projectName !== 'string' ||
    !raw.projectName ||
    typeof raw.chars !== 'number' ||
    !Number.isInteger(raw.chars) ||
    raw.chars < 0 ||
    typeof raw.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(raw.digest) ||
    typeof raw.at !== 'string' ||
    !raw.at
  ) {
    throw new Error('Plan record is corrupt.')
  }

  return {
    projectName: raw.projectName,
    chars: raw.chars,
    digest: raw.digest,
    at: raw.at,
  }
}

function sanitizeProposal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Plan record is corrupt.')
  }

  if (
    typeof raw.model !== 'string' ||
    typeof raw.task !== 'string' ||
    !Array.isArray(raw.edits) ||
    !Array.isArray(raw.commands) ||
    typeof raw.notes !== 'string'
  ) {
    throw new Error('Plan record is corrupt.')
  }

  return {
    model: raw.model,
    task: raw.task,
    researchSessionId:
      typeof raw.researchSessionId === 'string' ? raw.researchSessionId : null,
    contextFiles: Array.isArray(raw.contextFiles) ? raw.contextFiles : [],
    contextExcluded: Array.isArray(raw.contextExcluded)
      ? raw.contextExcluded
      : [],
    totalContextBytes:
      typeof raw.totalContextBytes === 'number' ? raw.totalContextBytes : 0,
    edits: raw.edits,
    commands: raw.commands,
    notes: raw.notes,
    expectedOutcome:
      typeof raw.expectedOutcome === 'string' ? raw.expectedOutcome : '',
    risks: Array.isArray(raw.risks) ? raw.risks.map(sanitizeRisk) : [],
    suggestedSteps: Array.isArray(raw.suggestedSteps)
      ? raw.suggestedSteps.filter((entry) => typeof entry === 'string')
      : [],
  }
}

function sanitizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Plan record is corrupt.')
  }

  if (raw.version !== PLAN_VERSION) {
    throw new Error('Unsupported plan version.')
  }

  assertPlanId(raw.id)

  if (
    typeof raw.projectName !== 'string' ||
    !raw.projectName ||
    typeof raw.title !== 'string' ||
    !raw.title.trim() ||
    raw.title.length > MAX_TITLE_CHARS ||
    typeof raw.objective !== 'string' ||
    !raw.objective.trim() ||
    raw.objective.length > MAX_TEXT_CHARS ||
    typeof raw.expectedOutcome !== 'string' ||
    raw.expectedOutcome.length > MAX_TEXT_CHARS
  ) {
    throw new Error('Plan record is corrupt.')
  }

  if (!Array.isArray(raw.risks) || raw.risks.length > MAX_RISKS) {
    throw new Error('Plan record is corrupt.')
  }

  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > MAX_STEPS) {
    throw new Error('Plan record is corrupt.')
  }

  if (
    typeof raw.createdAt !== 'string' ||
    !raw.createdAt ||
    typeof raw.updatedAt !== 'string' ||
    !raw.updatedAt
  ) {
    throw new Error('Plan record is corrupt.')
  }

  if (!['active', 'completed', 'cancelled'].includes(raw.status)) {
    throw new Error('Plan record is corrupt.')
  }

  const seen = new Set()

  for (const step of raw.steps) {
    if (!step || typeof step.id !== 'string' || seen.has(step.id)) {
      throw new Error('Plan record is corrupt.')
    }

    seen.add(step.id)
  }

  return {
    version: PLAN_VERSION,
    id: raw.id,
    projectName: raw.projectName,
    title: raw.title,
    objective: raw.objective,
    expectedOutcome: raw.expectedOutcome,
    risks: raw.risks.map(sanitizeRisk),
    steps: raw.steps.map(sanitizeStep),
    proposal: sanitizeProposal(raw.proposal),
    context: sanitizeContextSnapshot(raw.context ?? null),
    status: raw.status,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
}

// Derives the conclusion from observed execution facts. Precedence
// matches the diagnostics success rule: a cancelled run is
// cancelled even if the exit code is 0, and a timeout wins over
// whatever the exit code says.
function conclusionFromExecution(execution) {
  if (execution.cancelled) {
    return 'cancelled'
  }

  if (execution.timedOut) {
    return 'timed_out'
  }

  if (execution.exitCode === 0) {
    return 'passed'
  }

  return 'failed'
}

function resultForConclusion(conclusion) {
  if (conclusion === 'passed') {
    return 'pass'
  }

  if (conclusion === 'failed') {
    return 'fail'
  }

  return 'error'
}

function sanitizeExecution(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Verification report is corrupt.')
  }

  if (
    typeof raw.runId !== 'string' ||
    !RUN_ID_PATTERN.test(raw.runId) ||
    typeof raw.command !== 'string' ||
    !raw.command.trim() ||
    raw.command.length > MAX_EXECUTION_COMMAND_CHARS ||
    typeof raw.startedAt !== 'string' ||
    !raw.startedAt ||
    typeof raw.completedAt !== 'string' ||
    !raw.completedAt ||
    typeof raw.durationMs !== 'number' ||
    !Number.isFinite(raw.durationMs) ||
    raw.durationMs < 0 ||
    typeof raw.exitCode !== 'number' ||
    !Number.isInteger(raw.exitCode) ||
    typeof raw.timedOut !== 'boolean' ||
    typeof raw.cancelled !== 'boolean' ||
    raw.source !== 'diagnostics'
  ) {
    throw new Error('Verification report is corrupt.')
  }

  return {
    runId: raw.runId,
    command: raw.command,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
    durationMs: raw.durationMs,
    exitCode: raw.exitCode,
    timedOut: raw.timedOut,
    cancelled: raw.cancelled,
    source: 'diagnostics',
  }
}

// Model explanations are display-only interpretation: bounded,
// redacted, and never consulted when deriving the conclusion.
function sanitizeModelExplanation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Verification report is corrupt.')
  }

  const clean = (value, max, required) => {
    if (value === undefined || value === null) {
      if (required) {
        throw new Error('Verification report is corrupt.')
      }

      return null
    }

    if (typeof value !== 'string' || !value.trim()) {
      if (required) {
        throw new Error('Verification report is corrupt.')
      }

      return null
    }

    return redactText(value.trim()).slice(0, max)
  }

  const summary = clean(raw.summary, MAX_EXPLANATION_CHARS, true)

  return {
    summary,
    failureAnalysis: clean(raw.failureAnalysis, MAX_EXPLANATION_DETAIL_CHARS, false),
    suggestedNextSteps: clean(raw.suggestedNextSteps, MAX_EXPLANATION_DETAIL_CHARS, false),
  }
}

// Legacy reports predate stored conclusions: derive the honest
// conclusion from whatever evidence they carry. Reports with a
// diagnosis derive exactly (3B.3 always attached the observed
// diagnosis); bare error reports predate observation and load as
// not_executed rather than inventing an outcome.
function legacyConclusion(raw, diagnosis) {
  if (diagnosis) {
    if (diagnosis.status === 'passed') {
      return 'passed'
    }

    if (diagnosis.status === 'failed') {
      return 'failed'
    }

    if (diagnosis.status === 'timeout') {
      return 'timed_out'
    }

    return 'cancelled'
  }

  if (raw.timedOut === true) {
    return 'timed_out'
  }

  if (raw.result === 'pass') {
    return 'passed'
  }

  if (raw.result === 'fail') {
    return 'failed'
  }

  return 'not_executed'
}

function sanitizeReport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Verification report is corrupt.')
  }

  if (raw.version !== 1) {
    throw new Error('Unsupported verification report version.')
  }

  assertReportId(raw.id)
  assertPlanId(raw.planId)

  if (
    typeof raw.stepId !== 'string' ||
    !STEP_ID_PATTERN.test(raw.stepId) ||
    typeof raw.check !== 'string' ||
    !raw.check.trim() ||
    raw.check.length > MAX_TITLE_CHARS ||
    !['pass', 'fail', 'error'].includes(raw.result) ||
    typeof raw.at !== 'string' ||
    !raw.at
  ) {
    throw new Error('Verification report is corrupt.')
  }

  if (
    (raw.exitCode !== null &&
      (typeof raw.exitCode !== 'number' || !Number.isInteger(raw.exitCode))) ||
    typeof raw.timedOut !== 'boolean' ||
    typeof raw.outputSummary !== 'string' ||
    raw.outputSummary.length > MAX_OUTPUT_SUMMARY_CHARS ||
    raw.liveProvider !== false ||
    raw.origin !== 'command'
  ) {
    throw new Error('Verification report is corrupt.')
  }

  // Diagnosis is optional: legacy reports predate it and load with
  // null. A present diagnosis is re-validated, never trusted.
  let diagnosis = null

  if (raw.diagnosis !== undefined && raw.diagnosis !== null) {
    try {
      diagnosis = sanitizeDiagnosis(raw.diagnosis)
    } catch {
      throw new Error('Verification report is corrupt.')
    }
  }

  // Repair linkage is optional: only repair-cycle attempts carry
  // it. The attempt cap itself lives in the repair service; the
  // store only checks internal consistency. The checkpoint id and
  // changed files are snapshots of the linked attempt at record
  // time; linkage written before 3B.5 loads with null/empty.
  let repair = null

  if (raw.repair !== undefined && raw.repair !== null) {
    if (
      !raw.repair ||
      typeof raw.repair !== 'object' ||
      Array.isArray(raw.repair) ||
      typeof raw.repair.cycleId !== 'string' ||
      !REPAIR_CYCLE_ID_PATTERN.test(raw.repair.cycleId) ||
      typeof raw.repair.attempt !== 'number' ||
      !Number.isInteger(raw.repair.attempt) ||
      raw.repair.attempt < 1 ||
      raw.repair.attemptId !== `${raw.repair.cycleId}-a${raw.repair.attempt}`
    ) {
      throw new Error('Verification report is corrupt.')
    }

    if (
      raw.repair.checkpointId !== undefined &&
      raw.repair.checkpointId !== null &&
      (typeof raw.repair.checkpointId !== 'string' ||
        !CHECKPOINT_ID_PATTERN.test(raw.repair.checkpointId))
    ) {
      throw new Error('Verification report is corrupt.')
    }

    if (
      raw.repair.appliedFiles !== undefined &&
      (!Array.isArray(raw.repair.appliedFiles) ||
        raw.repair.appliedFiles.length > MAX_REPAIR_FILES ||
        raw.repair.appliedFiles.some(
          (entry) =>
            typeof entry !== 'string' ||
            !entry.trim() ||
            entry.length > MAX_REPAIR_PATH_CHARS
        ))
    ) {
      throw new Error('Verification report is corrupt.')
    }

    repair = {
      cycleId: raw.repair.cycleId,
      attempt: raw.repair.attempt,
      attemptId: raw.repair.attemptId,
      checkpointId: raw.repair.checkpointId ?? null,
      appliedFiles: raw.repair.appliedFiles ? [...raw.repair.appliedFiles] : [],
    }
  }

  let execution = null

  if (raw.execution !== undefined && raw.execution !== null) {
    execution = sanitizeExecution(raw.execution)
  }

  let modelExplanation = null

  if (raw.modelExplanation !== undefined && raw.modelExplanation !== null) {
    try {
      modelExplanation = sanitizeModelExplanation(raw.modelExplanation)
    } catch {
      throw new Error('Verification report is corrupt.')
    }
  }

  // A stored conclusion is re-derived from the stored evidence and
  // must match: flipping a conclusion in the file without matching
  // facts is corruption, not a reinterpretation. Reports without a
  // stored conclusion are legacy: derive honestly and flag them so
  // the UI can label their provenance as unverified.
  let conclusion = null
  let legacyProvenance = false

  if (raw.conclusion === undefined || raw.conclusion === null) {
    legacyProvenance = true
    conclusion = execution
      ? conclusionFromExecution(execution)
      : legacyConclusion(raw, diagnosis)
  } else {
    if (!REPORT_CONCLUSIONS.includes(raw.conclusion)) {
      throw new Error('Verification report is corrupt.')
    }

    const observed = ['passed', 'failed', 'cancelled', 'timed_out'].includes(
      raw.conclusion
    )

    if (observed && !execution) {
      throw new Error('Verification report is corrupt.')
    }

    if (!observed && execution) {
      throw new Error('Verification report is corrupt.')
    }

    if (execution && conclusionFromExecution(execution) !== raw.conclusion) {
      throw new Error('Verification report is corrupt.')
    }

    if (resultForConclusion(raw.conclusion) !== raw.result) {
      throw new Error('Verification report is corrupt.')
    }

    conclusion = raw.conclusion
  }

  if (execution && diagnosis && diagnosis.runId !== execution.runId) {
    throw new Error('Verification report is corrupt.')
  }

  return {
    version: 1,
    id: raw.id,
    planId: raw.planId,
    stepId: raw.stepId,
    check: raw.check,
    result: raw.result,
    conclusion,
    legacyProvenance,
    exitCode: raw.exitCode,
    timedOut: raw.timedOut,
    outputSummary: raw.outputSummary,
    at: raw.at,
    liveProvider: false,
    origin: 'command',
    execution,
    diagnosis,
    modelExplanation,
    repair,
  }
}

// v1 proposal migration: proposals predate persistence and carry no
// id, risks, outcome, or steps. Missing v2 fields default honestly;
// nothing is invented about what the planner said.
function normalizeProposal(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new Error('Invalid plan proposal.')
  }

  boundedText(proposal.task ?? '', MAX_TEXT_CHARS, 'objective')

  const risks = []

  if (proposal.risks !== undefined && proposal.risks !== null) {
    if (!Array.isArray(proposal.risks) || proposal.risks.length > MAX_RISKS) {
      throw new Error('Invalid plan risks.')
    }

    for (const risk of proposal.risks) {
      risks.push(normalizeRisk(risk))
    }
  }

  const suggestedSteps = []

  if (proposal.suggestedSteps !== undefined && proposal.suggestedSteps !== null) {
    if (!Array.isArray(proposal.suggestedSteps)) {
      throw new Error('Invalid plan steps.')
    }

    for (const entry of proposal.suggestedSteps.slice(0, MAX_STEPS)) {
      if (typeof entry === 'string' && entry.trim()) {
        suggestedSteps.push(entry.trim().slice(0, MAX_TITLE_CHARS))
      }
    }
  }

  let contextSnapshot = null

  if (
    proposal.contextSnapshot !== undefined &&
    proposal.contextSnapshot !== null
  ) {
    try {
      contextSnapshot = sanitizeContextSnapshot(proposal.contextSnapshot)
    } catch {
      throw new Error('Invalid context snapshot.')
    }
  }

  return {
    model: typeof proposal.model === 'string' ? proposal.model : 'unknown',
    task: proposal.task.trim(),
    researchSessionId:
      typeof proposal.researchSessionId === 'string'
        ? proposal.researchSessionId
        : null,
    contextFiles: Array.isArray(proposal.contextFiles)
      ? proposal.contextFiles
      : [],
    contextExcluded: Array.isArray(proposal.contextExcluded)
      ? proposal.contextExcluded
      : [],
    totalContextBytes:
      typeof proposal.totalContextBytes === 'number'
        ? proposal.totalContextBytes
        : 0,
    edits: Array.isArray(proposal.edits) ? proposal.edits : [],
    commands: Array.isArray(proposal.commands)
      ? proposal.commands.filter((entry) => typeof entry === 'string')
      : [],
    notes: typeof proposal.notes === 'string' ? proposal.notes : '',
    expectedOutcome:
      typeof proposal.expectedOutcome === 'string'
        ? proposal.expectedOutcome.slice(0, MAX_TEXT_CHARS)
        : '',
    risks,
    suggestedSteps,
    contextSnapshot,
  }
}

function normalizeRisk(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid plan risk.')
  }

  // Unknown severities coerce to medium with the author's own words
  // kept: the explanation/mitigation are the substance, and a
  // mislabeled severity must not void the whole plan.
  const severity = RISK_SEVERITIES.includes(raw.severity)
    ? raw.severity
    : 'medium'

  if (
    typeof raw.explanation !== 'string' ||
    !raw.explanation.trim() ||
    raw.explanation.length > MAX_RISK_CHARS ||
    typeof raw.mitigation !== 'string' ||
    !raw.mitigation.trim() ||
    raw.mitigation.length > MAX_RISK_CHARS
  ) {
    throw new Error('Invalid plan risk.')
  }

  return {
    severity,
    explanation: raw.explanation,
    mitigation: raw.mitigation,
  }
}

function buildSteps(normalized) {
  const steps = [
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
  ]

  for (const [index, label] of normalized.suggestedSteps.entries()) {
    steps.push({
      id: `task-${index + 1}`,
      kind: 'task',
      label,
      state: 'pending',
      startedAt: null,
      finishedAt: null,
      detail: '',
      evidence: [],
    })
  }

  const editCount = normalized.edits.length

  steps.push({
    id: 'apply',
    kind: 'apply',
    label: editCount === 1 ? 'Apply 1 edit' : `Apply ${editCount} edits`,
    state: 'pending',
    startedAt: null,
    finishedAt: null,
    detail: '',
    evidence: [],
  })

  steps.push({
    id: 'verify',
    kind: 'verify',
    label: 'Run verification',
    state: 'pending',
    startedAt: null,
    finishedAt: null,
    detail: '',
    evidence: [],
  })

  return steps.slice(0, MAX_STEPS)
}

async function readRecord(root, id) {
  const { found, data } = await readStorageFile(root, planSegments(id))

  if (!found) {
    throw new Error('Plan not found.')
  }

  let parsed = null

  try {
    parsed = JSON.parse(data)
  } catch {
    throw new Error('Plan record is corrupt.')
  }

  return sanitizeRecord(parsed)
}

async function writeRecord(root, record) {
  record.updatedAt = nowIso()

  await writeStorageFile(root, planSegments(record.id), JSON.stringify(record))

  return record
}

async function listReports(root, planId) {
  const files = await listStorageFiles(root, [
    ...planDirSegments(planId),
    'reports',
  ])
  const reports = []

  for (const { name } of files) {
    if (!name.endsWith('.json')) {
      continue
    }

    const id = name.slice(0, -'.json'.length)

    if (!REPORT_ID_PATTERN.test(id)) {
      continue
    }

    try {
      const { found, data } = await readStorageFile(
        root,
        reportSegments(planId, id)
      )

      if (found) {
        reports.push(sanitizeReport(JSON.parse(data)))
      }
    } catch (error) {
      log.warn(`Verification report ${id} unreadable: ${error.message}`)
    }
  }

  reports.sort((a, b) =>
    a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at)
  )

  return reports
}

function deriveVerification(record, reports) {
  const byId = new Map(reports.map((report) => [report.id, report]))

  // Only executed outcomes that actually ran red fail the plan.
  // Blocked, skipped, and never-executed checks are non-execution,
  // not failure: they leave the plan unverified, never failed.
  if (
    reports.some((report) =>
      ['failed', 'cancelled', 'timed_out'].includes(report.conclusion)
    )
  ) {
    return 'failed'
  }

  const verifySteps = record.steps.filter((step) => step.kind === 'verify')

  if (verifySteps.length === 0) {
    return 'unverified'
  }

  const verifiedCount = verifySteps.filter((step) =>
    step.evidence.some(
      (item) =>
        item.kind === 'report' &&
        byId.get(item.ref)?.conclusion === 'passed' &&
        byId.get(item.ref)?.stepId === step.id
    )
  ).length

  if (verifiedCount === verifySteps.length && verifiedCount > 0) {
    return 'verified'
  }

  if (verifiedCount > 0) {
    return 'partial'
  }

  return 'unverified'
}

async function present(root, record) {
  const reports = await listReports(root, record.id)
  const steps = record.steps.map((step) => ({
    ...step,
    evidence: step.evidence.map((item) => ({ ...item })),
    interrupted: step.state === 'in_progress' && !isLive(record.id, step.id),
  }))

  return {
    ...record,
    steps,
    context: record.context
      ? await checkContextFreshness(root, record.context)
      : null,
    verification: deriveVerification(record, reports),
    reports,
  }
}

async function prunePlans(root) {
  const dir = await ensureStorageDir(root, PLANS_SEGMENTS)
  const entries = await fs.readdir(dir)

  if (entries.length <= MAX_PLANS) {
    return
  }

  const candidates = []

  for (const entry of entries) {
    if (!ID_PATTERN.test(entry)) {
      continue
    }

    try {
      const record = await readRecord(root, entry)

      // Only terminal plans are pruned; active work is never deleted
      // to make room.
      if (record.status !== 'active') {
        candidates.push(record)
      }
    } catch {
      continue
    }
  }

  candidates.sort((a, b) =>
    a.updatedAt === b.updatedAt
      ? a.id.localeCompare(b.id)
      : a.updatedAt.localeCompare(b.updatedAt)
  )

  const overflow = candidates.length - MAX_PLANS

  for (let index = 0; index < overflow; index += 1) {
    const victim = candidates[index]
    const { path: file, exists } = await resolveStoragePath(
      root,
      planDirSegments(victim.id)
    )

    if (exists) {
      await fs.rm(file, {
        recursive: true,
        force: false,
      })
      log.info(`Pruned old plan ${victim.id}.`)
    }
  }
}

function contextEvidence(snapshot) {
  if (!snapshot) {
    return []
  }

  const stamp = nowIso()
  const evidence = []

  for (const file of snapshot.files) {
    evidence.push({
      kind: 'file',
      ref: file.relativePath,
      summary: `${file.bytes} bytes at planning.`,
      at: stamp,
    })
  }

  if (snapshot.research) {
    evidence.push({
      kind: 'research',
      ref: snapshot.research.sessionId,
      summary: `Brief v${snapshot.research.briefVersion}: ${snapshot.research.objective.slice(0, 200)}`,
      at: stamp,
    })
  }

  if (snapshot.chat) {
    evidence.push({
      kind: 'chat',
      ref: `chat@${snapshot.chat.at}`,
      summary: `${snapshot.chat.messageCount} message(s), ${snapshot.chat.chars} chars.`,
      at: stamp,
    })
  }

  return evidence
}

async function createPlan(proposal, meta = {}) {
  const root = openRoot()
  const normalized = normalizeProposal(proposal)
  const stamp = nowIso()
  const steps = buildSteps(normalized)

  // Attached context is preserved as review-step evidence so the
  // sources stay visible with the plan. Context evidence never
  // verifies anything: only passing reports do.
  if (normalized.contextSnapshot) {
    steps[0].evidence.push(...contextEvidence(normalized.contextSnapshot))
  }

  const record = {
    version: PLAN_VERSION,
    id: newPlanId(),
    projectName: path.basename(root),
    title:
      typeof meta.title === 'string' && meta.title.trim()
        ? meta.title.trim().slice(0, MAX_TITLE_CHARS)
        : normalized.task.slice(0, MAX_TITLE_CHARS),
    objective: normalized.task,
    expectedOutcome: normalized.expectedOutcome,
    risks: normalized.risks,
    steps,
    context: normalized.contextSnapshot,
    proposal: {
      model: normalized.model,
      task: normalized.task,
      researchSessionId: normalized.researchSessionId,
      contextFiles: normalized.contextFiles,
      contextExcluded: normalized.contextExcluded,
      totalContextBytes: normalized.totalContextBytes,
      edits: normalized.edits,
      commands: normalized.commands,
      notes: normalized.notes,
      expectedOutcome: normalized.expectedOutcome,
      risks: normalized.risks,
      suggestedSteps: normalized.suggestedSteps,
    },
    status: 'active',
    createdAt: stamp,
    updatedAt: stamp,
  }

  await writeStorageFile(root, planSegments(record.id), JSON.stringify(record))
  await prunePlans(root)

  return present(root, record)
}

async function listPlans() {
  const root = openRoot()
  const dir = await ensureStorageDir(root, PLANS_SEGMENTS)
  const entries = await fs.readdir(dir)
  const plans = []
  const corrupt = []

  for (const entry of entries) {
    if (!ID_PATTERN.test(entry)) {
      continue
    }

    try {
      plans.push(await present(root, await readRecord(root, entry)))
    } catch (error) {
      log.warn(`Plan ${entry} unreadable: ${error.message}`)
      corrupt.push(entry)
    }
  }

  plans.sort((a, b) =>
    a.updatedAt === b.updatedAt
      ? a.id.localeCompare(b.id)
      : b.updatedAt.localeCompare(a.updatedAt)
  )
  corrupt.sort()

  return { plans, corrupt }
}

async function getPlan(id) {
  const root = openRoot()

  return present(root, await readRecord(root, assertPlanId(id)))
}

function findStep(record, stepId) {
  const step = record.steps.find((entry) => entry.id === stepId)

  if (!step) {
    throw new Error('Plan step not found.')
  }

  return step
}

async function setStepState(planId, stepId, state, detail = '') {
  const root = openRoot()
  const record = await readRecord(root, assertPlanId(planId))

  if (record.status !== 'active') {
    throw new Error(`Plan is ${record.status}; it cannot change steps.`)
  }

  if (!STEP_STATES.includes(state)) {
    throw new Error('Invalid step state.')
  }

  if (typeof detail !== 'string' || detail.length > MAX_DETAIL_CHARS) {
    throw new Error('Invalid step detail.')
  }

  const step = findStep(record, stepId)

  if (!TRANSITIONS[step.state].includes(state)) {
    throw new Error(`Step cannot move from ${step.state} to ${state}.`)
  }

  if (state === 'verified') {
    const reports = await listReports(root, record.id)
    const passing = new Set(
      reports
        .filter((report) => report.result === 'pass' && report.stepId === step.id)
        .map((report) => report.id)
    )
    const evidenced = step.evidence.some(
      (item) => item.kind === 'report' && passing.has(item.ref)
    )

    if (!evidenced) {
      throw new Error(
        'Step cannot be verified without a passing verification report.'
      )
    }
  }

  const stamp = nowIso()

  if (state === 'in_progress') {
    if (!step.startedAt) {
      step.startedAt = stamp
    }

    step.finishedAt = null
    markLive(record.id, step.id)
  }

  if (TERMINAL_STATES.includes(state)) {
    step.finishedAt = stamp
  }

  if (state === 'in_progress' && step.state !== 'in_progress') {
    step.finishedAt = null
  }

  step.state = state
  step.detail = detail

  await writeRecord(root, record)

  return present(root, record)
}

async function attachEvidence(planId, stepId, spec) {
  const root = openRoot()
  const record = await readRecord(root, assertPlanId(planId))

  if (record.status !== 'active') {
    throw new Error(`Plan is ${record.status}; it cannot gain evidence.`)
  }

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('Invalid evidence.')
  }

  if (!EVIDENCE_KINDS.includes(spec.kind)) {
    throw new Error('Invalid evidence kind.')
  }

  if (typeof spec.ref !== 'string' || !spec.ref || spec.ref.length > 1000) {
    throw new Error('Invalid evidence reference.')
  }

  if (
    spec.summary !== undefined &&
    (typeof spec.summary !== 'string' ||
      spec.summary.length > MAX_EVIDENCE_SUMMARY_CHARS)
  ) {
    throw new Error('Invalid evidence summary.')
  }

  const step = findStep(record, stepId)

  if (step.evidence.length >= MAX_EVIDENCE_PER_STEP) {
    throw new Error('Step evidence is full.')
  }

  if (spec.kind === 'report') {
    const { found, data } = await readStorageFile(
      root,
      reportSegments(record.id, assertReportId(spec.ref))
    )

    if (!found) {
      throw new Error('Verification report not found.')
    }

    sanitizeReport(JSON.parse(data))
  }

  step.evidence.push({
    kind: spec.kind,
    ref: spec.ref,
    summary: spec.summary ?? '',
    at: nowIso(),
  })

  await writeRecord(root, record)

  return present(root, record)
}

async function recordVerification(input) {
  const root = openRoot()

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid verification report.')
  }

  const record = await readRecord(root, assertPlanId(input.planId))

  if (record.status !== 'active') {
    throw new Error(`Plan is ${record.status}; it cannot gain reports.`)
  }

  const step = findStep(record, input.stepId)

  if (
    typeof input.check !== 'string' ||
    !input.check.trim() ||
    input.check.length > MAX_TITLE_CHARS
  ) {
    throw new Error('Invalid verification check name.')
  }

  if (!REPORT_CLAIMS.includes(input.result)) {
    throw new Error('Invalid verification result.')
  }

  if (
    input.exitCode !== undefined &&
    input.exitCode !== null &&
    (typeof input.exitCode !== 'number' || !Number.isInteger(input.exitCode))
  ) {
    throw new Error('Invalid verification exit code.')
  }

  if (step.evidence.length >= MAX_EVIDENCE_PER_STEP) {
    throw new Error('Step evidence is full.')
  }

  // Execution facts resolve from the observed-run registry, never
  // from the caller's payload: the claim names a run this process
  // performed, and everything else is looked up. Unknown ids
  // (forged, evicted, or from another session) are rejected.
  let observed = null

  if (input.executionRunId !== undefined && input.executionRunId !== null) {
    if (
      typeof input.executionRunId !== 'string' ||
      !RUN_ID_PATTERN.test(input.executionRunId)
    ) {
      throw new Error('Invalid verification run id.')
    }

    if (input.result === 'skip' || input.result === 'not_executed') {
      throw new Error('A skipped check cannot cite an execution.')
    }

    observed = getObservedRun(input.executionRunId)

    if (!observed) {
      throw new Error(
        'Unknown verification run: the cited execution was not observed in this session.'
      )
    }
  } else if (input.result === 'pass' || input.result === 'fail') {
    throw new Error('A passing or failing report requires an observed execution.')
  }

  // Renderer-supplied exit facts must match the observed run when
  // both are present; without an execution no exit facts may be
  // claimed at all.
  if (observed) {
    if (input.exitCode !== undefined && input.exitCode !== null) {
      if (input.exitCode !== observed.exitCode) {
        throw new Error('Verification exit code does not match the observed execution.')
      }
    }

    if (input.timedOut !== undefined && input.timedOut !== observed.timedOut) {
      throw new Error('Verification timeout flag does not match the observed execution.')
    }
  } else {
    if (input.exitCode !== undefined && input.exitCode !== null) {
      throw new Error('An exit code cannot be claimed without an observed execution.')
    }

    if (input.timedOut === true) {
      throw new Error('A timeout cannot be claimed without an observed execution.')
    }
  }

  // The conclusion is derived from observed facts; the claim must
  // agree with it. A model or renderer claiming success while the
  // command failed is rejected, not recorded.
  let conclusion = null

  if (observed) {
    const derived = conclusionFromExecution(observed)

    if (input.result === 'pass' && derived !== 'passed') {
      throw new Error('Verification claim does not match the observed execution.')
    }

    if (input.result === 'fail' && derived !== 'failed') {
      throw new Error('Verification claim does not match the observed execution.')
    }

    if (
      input.result === 'error' &&
      derived !== 'cancelled' &&
      derived !== 'timed_out'
    ) {
      throw new Error('Verification claim does not match the observed execution.')
    }

    conclusion = derived
  } else if (input.result === 'error') {
    conclusion = 'blocked'
  } else if (input.result === 'skip') {
    conclusion = 'skipped'
  } else {
    conclusion = 'not_executed'
  }

  // Observed reports quote the registry excerpt; anything the caller
  // sent as output is ignored for facts. Non-execution claims must
  // state their reason instead: it is stored as the stated reason,
  // displayed as a claim rather than evidence.
  let outputSummary = ''

  if (observed) {
    outputSummary = observed.outputExcerpt
  } else {
    if (typeof input.output !== 'string' || !input.output.trim()) {
      throw new Error('A non-executed check requires a stated reason.')
    }

    outputSummary = redactText(input.output).slice(0, MAX_OUTPUT_SUMMARY_CHARS)
  }

  // The diagnosis always comes from the observed run. A caller
  // diagnosis is accepted only when it names the same run, and a
  // diagnosis without an execution is rejected outright.
  let diagnosis = null

  if (observed) {
    if (input.diagnosis !== undefined && input.diagnosis !== null) {
      try {
        diagnosis = sanitizeDiagnosis(input.diagnosis)
      } catch {
        throw new Error('Invalid verification diagnosis.')
      }

      if (diagnosis.runId !== observed.runId) {
        throw new Error('Verification diagnosis does not match the observed execution.')
      }
    } else {
      diagnosis = observed.diagnosis
    }
  } else if (input.diagnosis !== undefined && input.diagnosis !== null) {
    throw new Error('A diagnosis cannot be attached without an observed execution.')
  }

  const execution = observed
    ? {
        runId: observed.runId,
        command: observed.command,
        startedAt: observed.startedAt,
        completedAt: observed.completedAt,
        durationMs: observed.durationMs,
        exitCode: observed.exitCode,
        timedOut: observed.timedOut,
        cancelled: observed.cancelled,
        source: 'diagnostics',
      }
    : null

  let modelExplanation = null

  if (input.modelExplanation !== undefined && input.modelExplanation !== null) {
    try {
      modelExplanation = sanitizeModelExplanation(input.modelExplanation)
    } catch {
      throw new Error('Invalid verification model explanation.')
    }
  }

  // Repair linkage is server-derived: the IPC boundary never
  // forwards it, so only the repair service (which passes the
  // attempt's own checkpoint and changed files) can set it. The
  // shape is still re-validated here.
  let repair = null

  if (input.repair !== undefined && input.repair !== null) {
    if (
      !input.repair ||
      typeof input.repair !== 'object' ||
      Array.isArray(input.repair) ||
      typeof input.repair.cycleId !== 'string' ||
      !REPAIR_CYCLE_ID_PATTERN.test(input.repair.cycleId) ||
      typeof input.repair.attempt !== 'number' ||
      !Number.isInteger(input.repair.attempt) ||
      input.repair.attempt < 1 ||
      input.repair.attemptId !== `${input.repair.cycleId}-a${input.repair.attempt}`
    ) {
      throw new Error('Invalid verification repair linkage.')
    }

    if (
      input.repair.checkpointId !== undefined &&
      input.repair.checkpointId !== null &&
      (typeof input.repair.checkpointId !== 'string' ||
        !CHECKPOINT_ID_PATTERN.test(input.repair.checkpointId))
    ) {
      throw new Error('Invalid verification repair linkage.')
    }

    if (
      input.repair.appliedFiles !== undefined &&
      (!Array.isArray(input.repair.appliedFiles) ||
        input.repair.appliedFiles.length > MAX_REPAIR_FILES ||
        input.repair.appliedFiles.some(
          (entry) =>
            typeof entry !== 'string' ||
            !entry.trim() ||
            entry.length > MAX_REPAIR_PATH_CHARS
        ))
    ) {
      throw new Error('Invalid verification repair linkage.')
    }

    repair = {
      cycleId: input.repair.cycleId,
      attempt: input.repair.attempt,
      attemptId: input.repair.attemptId,
      checkpointId: input.repair.checkpointId ?? null,
      appliedFiles: input.repair.appliedFiles ? [...input.repair.appliedFiles] : [],
    }
  }

  // 3A.3 verification runs shell checks, never the model: reports
  // pin liveProvider false so no UI can claim live AI verification.
  // The legacy result mirrors the conclusion for old readers.
  const report = {
    version: 1,
    id: newReportId(),
    planId: record.id,
    stepId: step.id,
    check: input.check.trim(),
    result: resultForConclusion(conclusion),
    conclusion,
    legacyProvenance: false,
    exitCode: observed ? observed.exitCode : null,
    timedOut: observed ? observed.timedOut : false,
    outputSummary,
    at: nowIso(),
    liveProvider: false,
    origin: 'command',
    execution,
    diagnosis,
    modelExplanation,
    repair,
  }

  await writeStorageFile(
    root,
    reportSegments(record.id, report.id),
    JSON.stringify(report)
  )
  await pruneReports(root, record.id)

  step.evidence.push({
    kind: 'report',
    ref: report.id,
    summary: `${report.check}: ${report.conclusion}`,
    at: report.at,
  })

  const mark =
    input.markStep === undefined || input.markStep === null
      ? null
      : input.markStep

  if (mark !== null) {
    if (!['verified', 'failed', 'blocked'].includes(mark)) {
      throw new Error('Invalid report step mark.')
    }

    // Step marks follow the same truthfulness rules: verification
    // needs a pass, failure needs an executed-or-blocked outcome,
    // and skipped or never-executed checks cannot move the step.
    if (mark === 'verified' && conclusion !== 'passed') {
      throw new Error('Only a passing check can verify a step.')
    }

    if (
      mark === 'failed' &&
      !['failed', 'cancelled', 'timed_out', 'blocked'].includes(conclusion)
    ) {
      throw new Error('Only a failed, cancelled, timed-out, or blocked check can fail a step.')
    }

    if (mark === 'blocked' && conclusion !== 'blocked') {
      throw new Error('Only a blocked check can block a step.')
    }

    if (!TRANSITIONS[step.state].includes(mark)) {
      throw new Error(`Step cannot move from ${step.state} to ${mark}.`)
    }

    step.state = mark
    step.finishedAt = nowIso()
    step.detail = `${report.check}: ${report.conclusion}`
  }

  await writeRecord(root, record)

  return { report, plan: await present(root, record) }
}

async function pruneReports(root, planId) {
  const dir = await ensureStorageDir(root, [
    ...planDirSegments(planId),
    'reports',
  ])
  const entries = await fs.readdir(dir)

  if (entries.length <= MAX_REPORTS_PER_PLAN) {
    return
  }

  const reports = await listReports(root, planId)

  if (reports.length <= MAX_REPORTS_PER_PLAN) {
    return
  }

  const victims = reports.slice(0, reports.length - MAX_REPORTS_PER_PLAN)

  for (const victim of victims) {
    const { path: file, exists } = await resolveStoragePath(
      root,
      reportSegments(planId, victim.id)
    )

    if (exists) {
      await fs.unlink(file)
    }
  }
}

async function cancelPlan(planId, reason = '') {
  const root = openRoot()
  const record = await readRecord(root, assertPlanId(planId))

  if (record.status !== 'active') {
    return present(root, record)
  }

  if (typeof reason !== 'string' || reason.length > MAX_DETAIL_CHARS) {
    throw new Error('Invalid cancel reason.')
  }

  const stamp = nowIso()
  const note = reason.trim() || 'Cancelled by user.'

  for (const step of record.steps) {
    if (!TERMINAL_STATES.includes(step.state)) {
      step.state = 'cancelled'
      step.finishedAt = stamp
      step.detail = note
    }
  }

  record.status = 'cancelled'

  await writeRecord(root, record)
  await prunePlans(root)

  return present(root, record)
}

async function resumePlan(planId) {
  const root = openRoot()
  const record = await readRecord(root, assertPlanId(planId))

  if (record.status !== 'active') {
    throw new Error(`Plan is ${record.status}; it cannot resume.`)
  }

  // Explicit user action only: the caller confirms these steps are
  // really continuing under this process (e.g. a Resume button on an
  // interrupted plan). Never call this automatically on load — that
  // would clear the interrupted flag the recovery design depends on.
  for (const step of record.steps) {
    if (step.state === 'in_progress' && !step.finishedAt) {
      markLive(record.id, step.id)
    }
  }

  return present(root, record)
}

async function completePlan(planId) {
  const root = openRoot()
  const record = await readRecord(root, assertPlanId(planId))

  if (record.status !== 'active') {
    return present(root, record)
  }

  const open = record.steps.filter(
    (step) => !['completed', 'verified'].includes(step.state)
  )

  if (open.length > 0) {
    throw new Error(
      `Plan cannot complete with ${open.length} open step(s): ${open.map((step) => step.id).join(', ')}.`
    )
  }

  record.status = 'completed'

  await writeRecord(root, record)
  await prunePlans(root)

  return present(root, record)
}

module.exports = {
  PLANS_SEGMENTS,
  PLAN_VERSION,
  STEP_STATES,
  STEP_KINDS,
  REPORT_CONCLUSIONS,
  REPORT_CLAIMS,
  MAX_PLANS,
  newPlanId,
  assertPlanId,
  sanitizeRecord,
  sanitizeReport,
  normalizeProposal,
  normalizeRisk,
  createPlan,
  listPlans,
  getPlan,
  setStepState,
  attachEvidence,
  recordVerification,
  cancelPlan,
  resumePlan,
  completePlan,
}
