// Advanced quality intelligence (Level 3C.5). Evaluates software
// quality from actual project evidence: git changes, dependency
// impact, verification history, deterministic security scans, and
// observed performance facts.
//
// Everything here is computed, never generated: regression links
// come from impact analysis, test suggestions from changed symbols
// minus existing coverage, security findings from auditable
// patterns with quoted evidence, and performance notes from real
// index measurements. Reports carry an explainable verdict derived
// from finding counts — never an arbitrary percentage.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  assertPlainObject,
  assertOptionalString,
  assertStringArray,
} = require('../../security/validate-input.cjs')
const {
  ensureStorageDir,
  writeStorageFile,
  readStorageFile,
} = require('../../security/storage-path.cjs')
const {
  getChangedFiles,
} = require('../git/git-diff.service.cjs')
const {
  getIndexStatus,
  refreshIndex,
  checkIndexFreshness,
} = require('../project-intelligence/code-index.service.cjs')
const {
  analyzeImpact,
} = require('../project-intelligence/impact-analysis.service.cjs')
const {
  indexSymbols,
} = require('../project-intelligence/symbol-index.service.cjs')
const {
  getPlan,
} = require('../agent/plan-store.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('quality')

const QUALITY_SEGMENTS = ['.kryom', 'quality']
const REPORT_VERSION = 1
const REPORT_ID_PATTERN = /^qr-[0-9a-z]+-[0-9a-f]+$/
const MAX_REPORTS = 30
const MAX_SCOPE_FILES = 50
const MAX_FILE_BYTES = 256 * 1024
const MAX_FINDINGS = 100
const MAX_SUGGESTIONS = 20

// Deterministic security patterns. Each is deliberately narrow:
// findings quote the matched line so reviewers can judge them, and
// confidence separates confirmed issues from potential risks.
const SECURITY_PATTERNS = [
  {
    id: 'unsafe-eval',
    severity: 'high',
    confidence: 'high',
    title: 'Dynamic code execution',
    regex: /\beval\s*\(|\bnew\s+Function\s*\(/,
    recommendation: 'Replace eval/new Function with static code or a safe parser.',
  },
  {
    id: 'shell-exec',
    severity: 'high',
    confidence: 'medium',
    title: 'Shell command execution',
    regex: /\bshell\s*:\s*true|exec\s*\(|execSync\s*\(/,
    recommendation: 'Prefer argument-array spawn with shell disabled and validated inputs.',
  },
  {
    id: 'hardcoded-secret',
    severity: 'high',
    confidence: 'medium',
    title: 'Possible hardcoded secret',
    regex: /(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"]{4,}['"]/i,
    recommendation: 'Move credentials to environment variables or a secret store.',
  },
  {
    id: 'insecure-http',
    severity: 'low',
    confidence: 'medium',
    title: 'Plain HTTP URL',
    regex: /http:\/\/(?!localhost|127\.0\.0\.1)/i,
    recommendation: 'Use HTTPS unless the endpoint provably requires HTTP.',
  },
  {
    id: 'dangerous-chmod',
    severity: 'medium',
    confidence: 'high',
    title: 'Overly permissive file mode',
    regex: /chmod[^;]*777|0o777/,
    recommendation: 'Use the least-privilege mode the file needs.',
  },
  {
    id: 'ipc-untrusted',
    severity: 'medium',
    confidence: 'low',
    title: 'Renderer input reaches privileged code',
    regex: /ipcMain\.handle/,
    recommendation: 'Verify the handler checks the trusted sender first and validates payloads.',
  },
]

function newReportId() {
  return `qr-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
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

function assertReportId(value) {
  if (typeof value !== 'string' || !REPORT_ID_PATTERN.test(value)) {
    throw new Error('Invalid quality report id.')
  }

  return value
}

function reportSegments(reportId) {
  return [...QUALITY_SEGMENTS, `${assertReportId(reportId)}.json`]
}

function isTestFile(relativePath) {
  return /(\.test\.|\.spec\.|__tests__)/.test(relativePath)
}

async function readText(root, relativePath) {
  try {
    const buffer = await fs.readFile(path.join(root, relativePath))

    if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) {
      return null
    }

    return buffer.toString('utf8')
  } catch {
    return null
  }
}

async function changedFilesFromGit() {
  try {
    const unstaged = await getChangedFiles({ staged: false })
    const staged = await getChangedFiles({ staged: true })
    const files = [...new Set([...(unstaged.files || []), ...(staged.files || [])])]

    return { files: files.slice(0, MAX_SCOPE_FILES), truncated: files.length > MAX_SCOPE_FILES, git: true }
  } catch (error) {
    return { files: [], truncated: false, git: false, reason: error.message }
  }
}

// Regression analysis: changed files, affected modules, related
// tests, and verification history split into newly introduced vs
// pre-existing failures.
async function analyzeRegression(root, scope, planId) {
  const regressions = {
    changedFiles: scope,
    affectedFiles: [],
    relatedTests: [],
    impacts: [],
    failures: [],
    notes: [],
  }

  const current = scope.filter((entry) => entry.status === 'current').map((entry) => entry.path)

  if (current.length > 0) {
    try {
      const impact = await analyzeImpact({ paths: current.slice(0, 20) })

      regressions.affectedFiles = impact.affectedFiles
      regressions.relatedTests = impact.relatedTests
      regressions.impacts = impact.directDependents
    } catch (error) {
      regressions.notes.push(`Impact analysis unavailable: ${error.message}`)
    }
  }

  if (planId) {
    try {
      const plan = await getPlan(planId)
      const byCheck = new Map()

      for (const report of plan.reports || []) {
        const check = report.check || report.name || 'unnamed check'
        const at = report.createdAt || report.at || ''

        if (!byCheck.has(check)) {
          byCheck.set(check, [])
        }

        byCheck.get(check).push({
          conclusion: report.conclusion || 'unknown',
          at,
          reportId: report.id || null,
        })
      }

      for (const [check, history] of byCheck) {
        history.sort((a, b) => (a.at < b.at ? -1 : 1))

        const latest = history[history.length - 1]
        const earlierFailed = history.slice(0, -1).some((entry) => entry.conclusion === 'failed')

        if (latest.conclusion === 'failed') {
          regressions.failures.push({
            check,
            status: earlierFailed ? 'existing' : 'new',
            history: history.length,
            latestReportId: latest.reportId,
          })
        }
      }

      if (byCheck.size === 0) {
        regressions.notes.push('The plan holds no verification reports yet.')
      }
    } catch (error) {
      regressions.notes.push(`Plan verification history unavailable: ${error.message}`)
    }
  } else {
    regressions.notes.push('No plan linked; failure history needs a plan id.')
  }

  return regressions
}

// Test suggestions: changed exported symbols without an existing
// referencing test. Never suggests duplicates of tests that exist.
async function suggestTests(root, scope) {
  const current = scope
    .filter((entry) => entry.status === 'current')
    .map((entry) => entry.path)
    .filter((entry) => !isTestFile(entry))
    .slice(0, 20)

  if (current.length === 0) {
    return { suggestions: [], notes: ['No changed source files to analyze.'] }
  }

  let symbols = []

  try {
    symbols = (await indexSymbols({ paths: current })).symbols.filter(
      (symbol) => symbol.exported && (symbol.kind === 'function' || symbol.kind === 'class')
    )
  } catch (error) {
    return { suggestions: [], notes: [`Symbol scan unavailable: ${error.message}`] }
  }

  const testFiles = scope
    .filter((entry) => entry.status === 'current' && isTestFile(entry.path))
    .map((entry) => entry.path)

  // Also consider indexed tests outside the change scope so
  // suggestions do not duplicate existing coverage.
  const { readStorageFile: readManifest } = require('../../security/storage-path.cjs')
  let extraTests = []

  try {
    const stored = await readManifest(root, ['.kryom', 'index', 'manifest.json'])

    if (stored.found && stored.data) {
      extraTests = Object.keys(JSON.parse(stored.data).files || {})
        .filter((entry) => isTestFile(entry) && !testFiles.includes(entry))
        .slice(0, 50)
    }
  } catch {
    extraTests = []
  }

  const covering = new Map()

  for (const testFile of [...testFiles, ...extraTests]) {
    const text = await readText(root, testFile)

    if (!text) {
      continue
    }

    for (const symbol of symbols) {
      if (new RegExp(`\\b${symbol.name}\\b`).test(text)) {
        if (!covering.has(symbol.name)) {
          covering.set(symbol.name, [])
        }

        covering.get(symbol.name).push(testFile)
      }
    }
  }

  const suggestions = []

  for (const symbol of symbols) {
    if (covering.has(symbol.name) || suggestions.length >= MAX_SUGGESTIONS) {
      continue
    }

    suggestions.push({
      symbol: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
      rationale: `Exported ${symbol.kind} "${symbol.name}" changed without a referencing test.`,
      coveredBy: [],
    })
  }

  const notes = []

  if (symbols.length === 0) {
    notes.push('No changed exported functions or classes found.')
  } else if (suggestions.length === 0) {
    notes.push('Every changed exported symbol already has a referencing test.')
  }

  return { suggestions, notes }
}

// Deterministic security scan over the in-scope files.
async function scanSecurity(root, scope) {
  const findings = []
  const scanned = []

  for (const entry of scope.filter((item) => item.status === 'current').slice(0, MAX_SCOPE_FILES)) {
    const text = await readText(root, entry.path)

    if (text === null) {
      continue
    }

    scanned.push(entry.path)

    const lines = text.split('\n')

    for (let index = 0; index < lines.length; index += 1) {
      for (const pattern of SECURITY_PATTERNS) {
        // The IPC pattern only applies to main-process IPC modules.
        if (pattern.id === 'ipc-untrusted' && !entry.path.endsWith('.ipc.cjs')) {
          continue
        }

        if (pattern.regex.test(lines[index])) {
          // IPC handlers that DO check the sender are not findings.
          if (pattern.id === 'ipc-untrusted' && text.includes('isTrustedSender')) {
            continue
          }

          if (findings.length < MAX_FINDINGS) {
            findings.push({
              pattern: pattern.id,
              severity: pattern.severity,
              confidence: pattern.confidence,
              title: pattern.title,
              file: entry.path,
              line: index + 1,
              excerpt: lines[index].trim().slice(0, 300),
              recommendation: pattern.recommendation,
            })
          }
        }
      }
    }
  }

  return {
    findings,
    scannedFiles: scanned.length,
    truncated: findings.length >= MAX_FINDINGS,
    method: 'Deterministic pattern scan with quoted evidence. Medium/low confidence findings are potential risks, not confirmed vulnerabilities.',
  }
}

// Performance diagnostics from observed facts only: index size,
// truncation, and the largest indexed files. No benchmarks are
// fabricated; unmeasured areas say so.
async function diagnosePerformance(root) {
  const status = await getIndexStatus()
  const notes = []

  if (!status.indexed) {
    return {
      indexed: false,
      notes: ['No code index exists; index the workspace for performance facts.'],
    }
  }

  const { readStorageFile } = require('../../security/storage-path.cjs')
  const stored = await readStorageFile(root, ['.kryom', 'index', 'manifest.json'])

  if (!stored.found || !stored.data) {
    return { indexed: false, notes: ['Index manifest is unreadable.'] }
  }

  const manifest = JSON.parse(stored.data)
  const entries = Object.entries(manifest.files || {})
  const largest = entries
    .map(([file, record]) => ({ file, size: record.size || 0 }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)

  if (status.truncated) {
    notes.push(
      `The index is truncated at ${entries.length} files: intelligence covers a subset of the workspace. Narrow the project or split it for full coverage.`
    )
  }

  if (entries.length >= 800) {
    notes.push(
      `Large workspace (${entries.length} indexed files): prefer incremental refreshes and scoped searches.`
    )
  }

  const huge = largest.filter((entry) => entry.size > MAX_FILE_BYTES)

  if (huge.length > 0) {
    notes.push(
      `${huge.length} file(s) exceed the ${MAX_FILE_BYTES}-byte analysis cap and are skipped by scanners: ${huge.slice(0, 3).map((entry) => entry.file).join(', ')}.`
    )
  }

  notes.push('No timing benchmarks were taken; durations are not estimated here.')

  return {
    indexed: true,
    refreshedAt: manifest.refreshedAt,
    totalFiles: entries.length,
    truncated: status.truncated,
    largestFiles: largest,
    notes,
  }
}

function deriveVerdict({ regression, security, suggestions }) {
  const reasons = []
  const high = security.findings.filter((entry) => entry.severity === 'high')
  const newFailures = regression.failures.filter((entry) => entry.status === 'new')

  if (high.length > 0) {
    reasons.push(`${high.length} high-severity security finding(s)`)
  }

  if (newFailures.length > 0) {
    reasons.push(`${newFailures.length} newly failing check(s)`)
  }

  if (reasons.length > 0) {
    return { verdict: 'attention', reasons }
  }

  const medium = security.findings.filter((entry) => entry.severity === 'medium')

  if (medium.length > 0 || suggestions.length > 0 || regression.failures.length > 0) {
    const soft = []

    if (medium.length > 0) {
      soft.push(`${medium.length} medium-severity finding(s)`)
    }

    if (regression.failures.length > 0) {
      soft.push(`${regression.failures.length} pre-existing failure(s)`)
    }

    if (suggestions.length > 0) {
      soft.push(`${suggestions.length} test suggestion(s)`)
    }

    return { verdict: 'review', reasons: soft }
  }

  return { verdict: 'clean', reasons: ['No findings, failures, or suggestions.'] }
}

// Builds and persists an evidence-backed quality report. Scope is
// explicit paths plus (best-effort) git changes; stale scope files
// are reported, never silently analyzed.
async function buildQualityReport(payload = {}) {
  assertPlainObject(payload, 'quality request')

  const root = openRoot()
  const planId = assertOptionalString(payload.planId, 'plan id', 80) ?? undefined
  const explicit = payload.paths === undefined || payload.paths === null
    ? []
    : assertStringArray(payload.paths, 'paths', { maxItems: MAX_SCOPE_FILES, maxLength: 1000 })

  const status = await getIndexStatus()

  if (!status.indexed) {
    await refreshIndex()
  }

  const git = await changedFilesFromGit()
  const wanted = [...new Set([...explicit, ...git.files])].slice(0, MAX_SCOPE_FILES)

  const scope = wanted.length > 0
    ? (await checkIndexFreshness(wanted)).entries.map((entry) => ({
        path: entry.path,
        status: entry.status,
        reason: entry.reason,
      }))
    : []

  const regression = await analyzeRegression(root, scope, planId)
  const tests = await suggestTests(root, scope)
  const security = await scanSecurity(root, scope)
  const performance = await diagnosePerformance(root)
  const verdict = deriveVerdict({
    regression,
    security,
    suggestions: tests.suggestions,
  })

  const remainingRisks = []

  if (git.git === false) {
    remainingRisks.push('Not a git workspace (or git is unavailable): change detection used explicit paths only.')
  }

  if (scope.some((entry) => entry.status !== 'current')) {
    remainingRisks.push('Some scope files are stale or unindexed and were excluded from analysis.')
  }

  if (status.truncated) {
    remainingRisks.push('The code index is truncated: findings cover a subset of the workspace.')
  }

  if (!planId) {
    remainingRisks.push('No plan linked: verification history was not consulted.')
  }

  const record = {
    version: REPORT_VERSION,
    id: newReportId(),
    createdAt: nowIso(),
    scope: { planId: planId || null, files: scope, git: { available: git.git, truncated: git.truncated === true } },
    regression,
    testSuggestions: tests.suggestions,
    testNotes: tests.notes,
    security,
    performance,
    verdict,
    remainingRisks,
  }

  await ensureStorageDir(root, QUALITY_SEGMENTS)
  await writeStorageFile(root, reportSegments(record.id), JSON.stringify(record, null, 2))

  // Retention: keep the newest MAX_REPORTS reports.
  try {
    const dir = await ensureStorageDir(root, QUALITY_SEGMENTS)
    const entries = (await fs.readdir(dir))
      .filter((entry) => REPORT_ID_PATTERN.test(entry.replace(/\.json$/, '')))
      .sort()

    for (const stale of entries.slice(0, Math.max(0, entries.length - MAX_REPORTS))) {
      await fs.unlink(path.join(dir, stale)).catch(() => undefined)
    }
  } catch {
    // Retention is best-effort; the report itself is already stored.
  }

  log.info(`Quality report ${record.id}: verdict ${verdict.verdict}.`)

  return record
}

async function getQualityReport(reportId) {
  const root = openRoot()
  const { found, data } = await readStorageFile(root, reportSegments(assertReportId(reportId)))

  if (!found || !data) {
    throw new Error('Quality report not found.')
  }

  try {
    return JSON.parse(data)
  } catch {
    throw new Error('Quality report is corrupt.')
  }
}

async function listQualityReports() {
  const root = openRoot()
  const dir = await ensureStorageDir(root, QUALITY_SEGMENTS)
  const entries = await fs.readdir(dir)
  const reports = []

  for (const entry of entries) {
    const id = entry.replace(/\.json$/, '')

    if (!REPORT_ID_PATTERN.test(id)) {
      continue
    }

    try {
      const stored = await getQualityReport(id)

      reports.push({
        id: stored.id,
        createdAt: stored.createdAt,
        verdict: stored.verdict,
        scopeFiles: stored.scope.files.length,
      })
    } catch {
      // Skip unreadable reports in listings; explicit reads fail loudly.
    }
  }

  reports.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  return { reports: reports.slice(0, MAX_REPORTS), total: reports.length }
}

module.exports = {
  buildQualityReport,
  getQualityReport,
  listQualityReports,
}
