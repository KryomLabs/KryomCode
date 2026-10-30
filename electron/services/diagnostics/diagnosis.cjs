// Structured test diagnosis (Level 3B.3): classifies a finished
// command run into evidence-backed failure findings. The classifier
// is pure over its input: it never spawns, never reads the disk, and
// never invents file locations, line numbers, or root causes — every
// reference is quoted from the runner output or the parsed
// diagnostics, and anything unrecognized stays `unknown`.
const crypto = require('node:crypto')

const { redactText } = require('../../utils/logger.cjs')

const FAILURE_CATEGORIES = [
  'assertion_failure',
  'compilation_error',
  'type_error',
  'missing_dependency',
  'configuration_error',
  'runtime_error',
  'timeout',
  'cancelled',
  'unknown',
]

const DIAGNOSIS_STATUSES = ['passed', 'failed', 'timeout', 'cancelled']

const CONFIDENCES = ['high', 'medium', 'low']

const RUNNERS = ['node-test', 'tsc', 'eslint', 'pytest', 'unknown']

const PROVENANCES = ['executed', 'fixture']

const MAX_FINDINGS = 8
const MAX_SUMMARY_CHARS = 300
const MAX_EVIDENCE_CHARS = 1500
const MAX_FILE_CHARS = 500
const MAX_TEST_CHARS = 300
const MAX_COMMAND_CHARS = 2000
const MAX_ID_CHARS = 128
const MAX_SCAN_LINES = 4000

const RUN_ID_PATTERN = /^dg-[0-9a-z]+-[0-9a-f]+$/

// node:test / TAP: "not ok 3 - my test name"
const TAP_FAIL_PATTERN = /^not ok \d+\s*-?\s*(.*)$/

// pytest: "FAILED tests/test_x.py::test_y - reason"
const PYTEST_FAIL_PATTERN = /^FAILED (\S+?)::(\S+)(?: - (.*))?$/

// Jest: bullet lines name the failing test.
const JEST_BULLET_PATTERN = /^●\s+(.+?)\s*›\s*(.+)$/

// node:test spec reporter: "✖ adds (2.27ms)" plus an "ℹ fail N" summary.
const SPEC_FAIL_PATTERN = /^✖\s+(.+?)\s+\([\d.,]+ms\)\s*$/
const SPEC_FAIL_SUMMARY_PATTERN = /^ℹ fail [1-9]/

function newRunId() {
  return `dg-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

function assertPlainObject(value, what) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid diagnosis ${what}.`)
  }
}

function assertEnum(value, allowed, what) {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid diagnosis ${what}.`)
  }

  return value
}

function clip(value, max) {
  return value.length > max ? value.slice(0, max) : value
}

function scanLines(output) {
  return String(output).split('\n', MAX_SCAN_LINES)
}

// Locations are quoted evidence, never resolved: a missing source
// file is still reported exactly as the runner printed it. Only the
// shape is validated — empty or absurd values become nulls.
function cleanLocation(file, line, column) {
  const cleanFile =
    typeof file === 'string' &&
    file.trim() &&
    file.length <= MAX_FILE_CHARS &&
    !file.includes('\0')
      ? file.trim()
      : null

  const cleanNumber = (value) =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 1000000
      ? value
      : null

  return {
    file: cleanFile,
    line: cleanNumber(line),
    column: cleanNumber(column),
  }
}

function firstErrorLocation(diagnostics) {
  for (const entry of diagnostics) {
    if (!entry || entry.severity !== 'error') {
      continue
    }

    const location = cleanLocation(entry.file, entry.line, entry.column)

    if (location.file || location.line !== null) {
      return location
    }
  }

  return { file: null, line: null, column: null }
}

function detectRunner(command, lines) {
  const lowered = String(command).toLowerCase()

  if (/(^|[\s"'])tsc(\s|$|")/.test(lowered)) {
    return 'tsc'
  }

  if (/(^|[\s"'])eslint(\s|$|")/.test(lowered)) {
    return 'eslint'
  }

  if (lowered.includes('node') && lowered.includes('--test')) {
    return 'node-test'
  }

  if (/(^|[\s"'])pytest(\s|$|")/.test(lowered)) {
    return 'pytest'
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (
      TAP_FAIL_PATTERN.test(trimmed) ||
      /^ok \d+/.test(trimmed) ||
      /^TAP version \d+/.test(trimmed) ||
      SPEC_FAIL_PATTERN.test(trimmed) ||
      SPEC_FAIL_SUMMARY_PATTERN.test(trimmed)
    ) {
      return 'node-test'
    }

    if (PYTEST_FAIL_PATTERN.test(trimmed) || /^=+ .* failed/.test(trimmed)) {
      return 'pytest'
    }

    if (JEST_BULLET_PATTERN.test(trimmed)) {
      return 'node-test'
    }
  }

  return 'unknown'
}

function findingShell(runId, index, category, confidence) {
  return {
    id: `${runId}-f${index}`,
    category,
    confidence,
    file: null,
    line: null,
    column: null,
    test: null,
    summary: '',
    evidence: '',
  }
}

function finishFinding(entry, summary, evidence) {
  return {
    ...entry,
    summary: clip(redactText(summary), MAX_SUMMARY_CHARS),
    evidence: clip(redactText(evidence), MAX_EVIDENCE_CHARS),
  }
}

function findTscGroups(diagnostics) {
  const syntax = []
  const types = []

  for (const entry of diagnostics) {
    if (!entry || entry.source !== 'tsc' || entry.severity !== 'error') {
      continue
    }

    if (typeof entry.code === 'string' && /^TS1\d{3}$/.test(entry.code)) {
      syntax.push(entry)
    } else {
      types.push(entry)
    }
  }

  return { syntax, types }
}

function groupEvidence(entries) {
  return entries
    .slice(0, 5)
    .map((entry) => `${entry.file}:${entry.line} ${entry.code} ${entry.message}`)
    .join('\n')
}

function collectFailureFindings(runId, lines, diagnostics) {
  const findings = []
  const joined = lines.join('\n')

  const push = (entry) => {
    if (findings.length < MAX_FINDINGS) {
      findings.push(entry)
    }
  }

  // Missing dependencies first: they explain cascading failures.
  const missingLine = lines.find((line) =>
    /Cannot find module|ERR_MODULE_NOT_FOUND|Module not found|No module named/.test(
      line
    )
  )

  if (missingLine) {
    const entry = findingShell(runId, findings.length, 'missing_dependency', 'high')
    const location = firstErrorLocation(diagnostics)

    push(
      finishFinding(
        { ...entry, ...location },
        `Missing dependency reported: ${missingLine.trim().slice(0, 120)}`,
        missingLine.trim()
      )
    )
  }

  // TypeScript groups: syntax codes are compilation errors, the rest
  // are type errors. One finding per group keeps long runs bounded.
  const { syntax, types } = findTscGroups(diagnostics)

  if (syntax.length > 0) {
    const entry = findingShell(runId, findings.length, 'compilation_error', 'high')
    const location = cleanLocation(
      syntax[0].file,
      syntax[0].line,
      syntax[0].column
    )

    push(
      finishFinding(
        { ...entry, ...location },
        `${syntax.length} TypeScript syntax error(s); first at ` +
          `${location.file ?? 'unknown location'}:${location.line ?? '?'}.`,
        groupEvidence(syntax)
      )
    )
  }

  if (types.length > 0) {
    const entry = findingShell(runId, findings.length, 'type_error', 'high')
    const location = cleanLocation(types[0].file, types[0].line, types[0].column)

    push(
      finishFinding(
        { ...entry, ...location },
        `${types.length} TypeScript type error(s); first at ` +
          `${location.file ?? 'unknown location'}:${location.line ?? '?'}.`,
        groupEvidence(types)
      )
    )
  }

  // Generic SyntaxError outside tsc output.
  if (syntax.length === 0) {
    const syntaxLine = lines.find((line) => /SyntaxError/.test(line))

    if (syntaxLine) {
      const entry = findingShell(
        runId,
        findings.length,
        'compilation_error',
        'high'
      )
      const location = firstErrorLocation(diagnostics)

      push(
        finishFinding(
          { ...entry, ...location },
          `Syntax error reported: ${syntaxLine.trim().slice(0, 120)}`,
          syntaxLine.trim()
        )
      )
    }
  }

  // Test-assertion failures: TAP, pytest, jest, node spec
  // reporter, bare asserts.
  const tapLine = lines.find((line) => TAP_FAIL_PATTERN.test(line.trim()))
  const pytestLine = lines.find((line) => PYTEST_FAIL_PATTERN.test(line.trim()))
  const jestLine = lines.find((line) => JEST_BULLET_PATTERN.test(line.trim()))
  const specLine = lines.find((line) => {
    const trimmed = line.trim()

    if (trimmed === '✖ failing tests:') {
      return false
    }

    return SPEC_FAIL_PATTERN.test(trimmed)
  })
  const specSummary = lines.some((line) =>
    SPEC_FAIL_SUMMARY_PATTERN.test(line.trim())
  )
  const assertLine = lines.find((line) =>
    /AssertionError|assert\.\w+|^\s*\d+ failing|Expected:|Received:/.test(line)
  )
  const specFailure = specLine && (specSummary || assertLine)

  if (tapLine || pytestLine || jestLine || specFailure || assertLine) {
    const entry = findingShell(
      runId,
      findings.length,
      'assertion_failure',
      tapLine || pytestLine ? 'high' : 'medium'
    )
    const location = firstErrorLocation(diagnostics)
    const evidenceLine = (
      tapLine ??
      pytestLine ??
      jestLine ??
      (specFailure ? specLine : null) ??
      assertLine
    ).trim()

    let test = null

    const tapMatch = tapLine ? TAP_FAIL_PATTERN.exec(tapLine.trim()) : null
    const pytestMatch = pytestLine
      ? PYTEST_FAIL_PATTERN.exec(pytestLine.trim())
      : null
    const jestMatch = jestLine ? JEST_BULLET_PATTERN.exec(jestLine.trim()) : null
    const specMatch = specFailure
      ? SPEC_FAIL_PATTERN.exec(specLine.trim())
      : null

    if (tapMatch && tapMatch[1].trim()) {
      test = clip(tapMatch[1].trim(), MAX_TEST_CHARS)
    } else if (pytestMatch) {
      test = clip(`${pytestMatch[1]}::${pytestMatch[2]}`, MAX_TEST_CHARS)
    } else if (jestMatch) {
      test = clip(`${jestMatch[1]} › ${jestMatch[2]}`, MAX_TEST_CHARS)
    } else if (specMatch) {
      test = clip(specMatch[1].trim(), MAX_TEST_CHARS)
    }

    // pytest prints the file in the FAILED line; quote it when no
    // parsed diagnostic gave a location.
    if (!location.file && pytestMatch) {
      location.file = clip(pytestMatch[1], MAX_FILE_CHARS)
    }

    push(
      finishFinding(
        { ...entry, ...location, test },
        test ? `Test failed: ${test}` : 'Test assertion failed; see evidence.',
        evidenceLine
      )
    )
  }

  // Runtime errors: an *Error with stack evidence.
  const runtimeLine = lines.find((line) =>
    /(TypeError|ReferenceError|RangeError|Error):/.test(line)
  )
  const hasStack = diagnostics.some(
    (entry) => entry && entry.source === 'stack'
  )

  if (
    runtimeLine &&
    !/AssertionError|SyntaxError/.test(runtimeLine) &&
    (hasStack || /at\s+\S+:\d+:\d+/.test(joined))
  ) {
    const entry = findingShell(runId, findings.length, 'runtime_error', 'medium')
    const location = firstErrorLocation(diagnostics)

    push(
      finishFinding(
        { ...entry, ...location },
        `Runtime error reported: ${runtimeLine.trim().slice(0, 120)}`,
        runtimeLine.trim()
      )
    )
  }

  // The command itself failed to start.
  const startupLine = lines.find((line) =>
    /not recognized as an internal or external command|command not found|spawn .* ENOENT/.test(
      line
    )
  )

  if (startupLine) {
    const entry = findingShell(
      runId,
      findings.length,
      'configuration_error',
      'medium'
    )

    push(
      finishFinding(
        entry,
        'The test command failed to start; check the command and PATH.',
        startupLine.trim()
      )
    )
  }

  // Unclassified error diagnostics: quoted as observed, never
  // promoted to a category the evidence does not support.
  const errorDiagnostics = diagnostics.filter(
    (entry) => entry && entry.severity === 'error'
  )

  if (findings.length === 0 && errorDiagnostics.length > 0) {
    const entry = findingShell(runId, findings.length, 'unknown', 'medium')
    const location = firstErrorLocation(diagnostics)

    push(
      finishFinding(
        { ...entry, ...location },
        `${errorDiagnostics.length} error(s) reported that match no ` +
          'known failure pattern; see evidence.',
        groupEvidence(errorDiagnostics)
      )
    )
  }

  if (findings.length === 0) {
    const entry = findingShell(runId, findings.length, 'unknown', 'low')

    push(
      finishFinding(
        entry,
        'Unrecognized failure; the runner output matched no known pattern.',
        lines.filter((line) => line.trim()).slice(-8).join('\n') ||
          '(no output)'
      )
    )
  }

  return findings
}

function assertAssociation(value, what) {
  if (value === undefined || value === null) {
    return null
  }

  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_ID_CHARS
  ) {
    throw new Error(`Invalid diagnosis ${what}.`)
  }

  return value.trim()
}

function diagnoseRun(input) {
  assertPlainObject(input, 'input')

  if (
    typeof input.command !== 'string' ||
    !input.command.trim() ||
    input.command.length > MAX_COMMAND_CHARS
  ) {
    throw new Error('Invalid diagnosis command.')
  }

  if (
    typeof input.exitCode !== 'number' ||
    !Number.isInteger(input.exitCode)
  ) {
    throw new Error('Invalid diagnosis exit code.')
  }

  if (typeof input.timedOut !== 'boolean' || typeof input.cancelled !== 'boolean') {
    throw new Error('Invalid diagnosis outcome flags.')
  }

  if (typeof input.output !== 'string') {
    throw new Error('Invalid diagnosis output.')
  }

  if (!Array.isArray(input.diagnostics)) {
    throw new Error('Invalid diagnosis diagnostics.')
  }

  if (
    typeof input.durationMs !== 'number' ||
    !Number.isFinite(input.durationMs) ||
    input.durationMs < 0
  ) {
    throw new Error('Invalid diagnosis duration.')
  }

  const provenance = assertEnum(input.provenance, PROVENANCES, 'provenance')
  const runId = newRunId()
  const at = new Date().toISOString()
  const lines = scanLines(input.output)
  const runner = detectRunner(input.command, lines)
  const planId = assertAssociation(input.planId, 'plan id')
  const stepId = assertAssociation(input.stepId, 'step id')

  let status = null
  let findings = []
  let summary = ''

  if (input.cancelled) {
    status = 'cancelled'
    summary = 'Test execution was cancelled; no result is claimed.'

    findings = [
      finishFinding(
        findingShell(runId, 0, 'cancelled', 'high'),
        summary,
        'Cancelled by user.'
      ),
    ]
  } else if (input.timedOut) {
    status = 'timeout'
    summary = `Test execution timed out after ${Math.round(input.durationMs / 1000)} second(s).`

    findings = [
      finishFinding(
        findingShell(runId, 0, 'timeout', 'high'),
        summary,
        lines.filter((line) => line.trim()).slice(-8).join('\n') ||
          '(no output)'
      ),
    ]
  } else if (input.exitCode === 0) {
    // Warnings never fail a run the runner reports as passing.
    status = 'passed'
    summary = 'Command exited 0.'
  } else {
    status = 'failed'
    findings = collectFailureFindings(runId, lines, input.diagnostics)

    const lead = findings[0]

    summary =
      `Exit ${input.exitCode}: ${lead.category} (${lead.confidence})` +
      (findings.length > 1 ? ` +${findings.length - 1} more` : '') +
      '.'
  }

  return {
    runId,
    command: input.command.trim(),
    status,
    runner,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    cancelled: input.cancelled,
    durationMs: Math.round(input.durationMs),
    provenance,
    at,
    planId,
    stepId,
    summary,
    findings,
  }
}

// Persistence-boundary validation: the renderer hands back the
// diagnosis it received, so reports re-validate every field and
// reject anything malformed instead of storing it.
function sanitizeFinding(raw, runId) {
  assertPlainObject(raw, 'finding')

  if (typeof raw.id !== 'string') {
    throw new Error('Diagnosis finding id is corrupt.')
  }

  if (raw.id !== `${runId}-f${Number(raw.id.slice(runId.length + 2))}`) {
    throw new Error('Diagnosis finding id is corrupt.')
  }

  const index = Number(raw.id.slice(runId.length + 2))

  if (!Number.isInteger(index) || index < 0 || index >= MAX_FINDINGS) {
    throw new Error('Diagnosis finding id is corrupt.')
  }

  assertEnum(raw.category, FAILURE_CATEGORIES, 'finding category')
  assertEnum(raw.confidence, CONFIDENCES, 'finding confidence')

  const location = cleanLocation(raw.file, raw.line, raw.column)

  if (
    (raw.file !== null && raw.file !== undefined && location.file === null) ||
    (raw.line !== null && raw.line !== undefined && location.line === null) ||
    (raw.column !== null && raw.column !== undefined && location.column === null)
  ) {
    throw new Error('Diagnosis finding location is corrupt.')
  }

  if (
    raw.test !== null &&
    raw.test !== undefined &&
    (typeof raw.test !== 'string' || !raw.test.trim() || raw.test.length > MAX_TEST_CHARS)
  ) {
    throw new Error('Diagnosis finding test name is corrupt.')
  }

  if (
    typeof raw.summary !== 'string' ||
    !raw.summary.trim() ||
    raw.summary.length > MAX_SUMMARY_CHARS
  ) {
    throw new Error('Diagnosis finding summary is corrupt.')
  }

  if (typeof raw.evidence !== 'string' || raw.evidence.length > MAX_EVIDENCE_CHARS) {
    throw new Error('Diagnosis finding evidence is corrupt.')
  }

  return {
    id: raw.id,
    category: raw.category,
    confidence: raw.confidence,
    file: location.file,
    line: location.line,
    column: location.column,
    test: typeof raw.test === 'string' ? raw.test : null,
    summary: raw.summary,
    evidence: raw.evidence,
  }
}

// Forged diagnoses arrive through IPC, so free-text fields are
// scrubbed BEFORE length validation: backend-built findings are
// already redacted (idempotent), while secret-bearing forgeries
// persist clean. Bounds below therefore hold on the stored text.
function redactStoredStrings(raw) {
  const copy = { ...raw }

  for (const key of ['command', 'summary', 'planId', 'stepId']) {
    if (typeof copy[key] === 'string') {
      copy[key] = redactText(copy[key])
    }
  }

  if (Array.isArray(copy.findings)) {
    copy.findings = copy.findings.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return entry
      }

      const finding = { ...entry }

      for (const key of ['file', 'test', 'summary', 'evidence']) {
        if (typeof finding[key] === 'string') {
          finding[key] = redactText(finding[key])
        }
      }

      return finding
    })
  }

  return copy
}

function sanitizeDiagnosis(raw) {
  assertPlainObject(raw, 'report')

  raw = redactStoredStrings(raw)

  if (typeof raw.runId !== 'string' || !RUN_ID_PATTERN.test(raw.runId)) {
    throw new Error('Diagnosis run id is corrupt.')
  }

  if (
    typeof raw.command !== 'string' ||
    !raw.command.trim() ||
    raw.command.length > MAX_COMMAND_CHARS
  ) {
    throw new Error('Diagnosis command is corrupt.')
  }

  assertEnum(raw.status, DIAGNOSIS_STATUSES, 'status')
  assertEnum(raw.runner, RUNNERS, 'runner')
  assertEnum(raw.provenance, PROVENANCES, 'provenance')

  if (
    raw.exitCode !== null &&
    (typeof raw.exitCode !== 'number' || !Number.isInteger(raw.exitCode))
  ) {
    throw new Error('Diagnosis exit code is corrupt.')
  }

  if (typeof raw.timedOut !== 'boolean' || typeof raw.cancelled !== 'boolean') {
    throw new Error('Diagnosis outcome flags are corrupt.')
  }

  if (
    typeof raw.durationMs !== 'number' ||
    !Number.isFinite(raw.durationMs) ||
    raw.durationMs < 0
  ) {
    throw new Error('Diagnosis duration is corrupt.')
  }

  if (typeof raw.at !== 'string' || !raw.at) {
    throw new Error('Diagnosis timestamp is corrupt.')
  }

  if (
    typeof raw.summary !== 'string' ||
    !raw.summary.trim() ||
    raw.summary.length > MAX_SUMMARY_CHARS
  ) {
    throw new Error('Diagnosis summary is corrupt.')
  }

  if (!Array.isArray(raw.findings) || raw.findings.length > MAX_FINDINGS) {
    throw new Error('Diagnosis findings are corrupt.')
  }

  if (raw.status === 'passed' && raw.findings.length !== 0) {
    throw new Error('A passing diagnosis carries no findings.')
  }

  if (raw.status !== 'passed' && raw.findings.length === 0) {
    throw new Error('A failing diagnosis needs at least one finding.')
  }

  const seen = new Set()

  for (const entry of raw.findings) {
    const clean = sanitizeFinding(entry, raw.runId)

    if (seen.has(clean.id)) {
      throw new Error('Diagnosis finding ids must be unique.')
    }

    seen.add(clean.id)
  }

  return {
    runId: raw.runId,
    command: raw.command,
    status: raw.status,
    runner: raw.runner,
    exitCode: raw.exitCode,
    timedOut: raw.timedOut,
    cancelled: raw.cancelled,
    durationMs: raw.durationMs,
    provenance: raw.provenance,
    at: raw.at,
    planId: assertAssociation(raw.planId, 'plan id'),
    stepId: assertAssociation(raw.stepId, 'step id'),
    summary: raw.summary,
    findings: raw.findings.map((entry) => sanitizeFinding(entry, raw.runId)),
  }
}

module.exports = {
  FAILURE_CATEGORIES,
  DIAGNOSIS_STATUSES,
  CONFIDENCES,
  RUNNERS,
  PROVENANCES,
  MAX_FINDINGS,
  diagnoseRun,
  sanitizeDiagnosis,
}
