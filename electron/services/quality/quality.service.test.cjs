const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  refreshIndex,
} = require('../project-intelligence/code-index.service.cjs')
const {
  createPlan,
} = require('../agent/plan-store.cjs')
const {
  buildQualityReport,
  getQualityReport,
  listQualityReports,
} = require('./quality.service.cjs')

async function openFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-quality-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'src', 'auth.ts'),
    'export function login(user: string) {\n  return user\n}\n'
  )
  await fs.writeFile(
    path.join(root, 'src', 'risky.ts'),
    'const api_key = "sk-live-12345"\nexport function run(cmd: string) {\n  return eval(cmd)\n}\n'
  )
  await fs.writeFile(
    path.join(root, 'src', 'auth.test.ts'),
    'import { login } from "./auth"\nlogin("x")\n'
  )
  await setWorkspaceRoot(root)
  await refreshIndex()

  return root
}

describe('quality', () => {
  it('builds an evidence-backed report with findings and verdict', async () => {
    await openFixture()

    const report = await buildQualityReport({ paths: ['src/risky.ts', 'src/auth.ts'] })

    assert.ok(report.id.startsWith('qr-'))
    assert.ok(report.security.findings.some((entry) => entry.pattern === 'unsafe-eval'))
    assert.ok(report.security.findings.some((entry) => entry.pattern === 'hardcoded-secret'))

    const evalFinding = report.security.findings.find((entry) => entry.pattern === 'unsafe-eval')

    assert.equal(evalFinding.file, 'src/risky.ts')
    assert.equal(evalFinding.line, 3)
    assert.ok(evalFinding.excerpt.includes('eval'))
    assert.equal(report.verdict.verdict, 'attention')
    assert.ok(report.security.method.includes('Deterministic'))
  })

  it('suggests tests only for uncovered changed symbols', async () => {
    await openFixture()

    const report = await buildQualityReport({ paths: ['src/auth.ts', 'src/risky.ts'] })
    const symbols = report.testSuggestions.map((entry) => entry.symbol)

    // login is referenced by auth.test.ts; run is not.
    assert.ok(!symbols.includes('login'))
    assert.ok(symbols.includes('run'))

    const suggestion = report.testSuggestions.find((entry) => entry.symbol === 'run')

    assert.equal(suggestion.file, 'src/risky.ts')
    assert.ok(suggestion.rationale.length > 0)
  })

  it('links plan verification history honestly', async () => {
    await openFixture()

    const plan = await createPlan({
      task: 'Work',
      expectedOutcome: 'x',
      risks: [],
      suggestedSteps: ['One'],
    })

    const report = await buildQualityReport({ planId: plan.id, paths: ['src/auth.ts'] })

    assert.ok(
      report.regression.notes.some((entry) => entry.includes('no verification reports'))
    )
    assert.equal(report.scope.planId, plan.id)
  })

  it('excludes stale scope files and says so', async () => {
    const root = await openFixture()

    await fs.writeFile(path.join(root, 'src', 'risky.ts'), 'changed\n')

    const report = await buildQualityReport({ paths: ['src/risky.ts'] })
    const scoped = report.scope.files.find((entry) => entry.path === 'src/risky.ts')

    assert.equal(scoped.status, 'stale')
    assert.ok(!report.security.findings.some((entry) => entry.file === 'src/risky.ts'))
    assert.ok(report.remainingRisks.some((entry) => entry.includes('stale or unindexed')))
  })

  it('reports performance from observed index facts only', async () => {
    await openFixture()

    const report = await buildQualityReport({ paths: ['src/auth.ts'] })

    assert.equal(report.performance.indexed, true)
    assert.ok(report.performance.totalFiles >= 3)
    assert.ok(Array.isArray(report.performance.largestFiles))
    assert.ok(
      report.performance.notes.some((entry) => entry.includes('No timing benchmarks'))
    )
  })

  it('persists, reads, and lists reports', async () => {
    await openFixture()

    const report = await buildQualityReport({ paths: ['src/auth.ts'] })
    const stored = await getQualityReport(report.id)

    assert.equal(stored.id, report.id)
    assert.deepEqual(stored.verdict, report.verdict)

    const listed = await listQualityReports()

    assert.equal(listed.total, 1)
    assert.equal(listed.reports[0].id, report.id)
  })
})
