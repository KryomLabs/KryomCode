const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  MockProvider,
} = require('../ai/providers/mock.provider.cjs')
const {
  refreshIndex,
} = require('../project-intelligence/code-index.service.cjs')
const {
  createPlan,
} = require('../agent/plan-store.cjs')
const {
  SPECIALISTS,
  runSpecialist,
  getSpecialistRun,
  listSpecialistRuns,
  cancelSpecialistRun,
} = require('./specialist.service.cjs')

const SAVED_KEY = process.env.MODEL_API_KEY

afterEach(() => {
  if (SAVED_KEY === undefined) {
    delete process.env.MODEL_API_KEY
  } else {
    process.env.MODEL_API_KEY = SAVED_KEY
  }
})

async function openFixture() {
  process.env.MODEL_API_KEY = 'test-key'
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-spec-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'auth.ts'), 'export class Auth {}\n')
  await setWorkspaceRoot(root)
  await refreshIndex()

  return root
}

async function waitForTerminal(runId, timeoutMs = 10000) {
  const start = Date.now()

  for (;;) {
    const run = await getSpecialistRun(runId)

    if (run.state !== 'running') {
      return run
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Run ${runId} did not finish in time.`)
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('specialists', () => {
  it('registers six specialists with prompts and validators', () => {
    assert.deepEqual(Object.keys(SPECIALISTS).sort(), [
      'coding',
      'debugging',
      'research',
      'review',
      'security',
      'testing',
    ])

    for (const entry of Object.values(SPECIALISTS)) {
      assert.ok(entry.label && entry.systemPrompt && typeof entry.normalize === 'function')
    }
  })

  it('rejects invalid input synchronously before starting', async () => {
    await openFixture()

    await assert.rejects(
      () => runSpecialist({ specialist: 'nope', task: 'x' }),
      /Invalid specialist/
    )
    await assert.rejects(
      () => runSpecialist({ specialist: 'research', task: '   ' }),
      /Invalid task/
    )

    const listed = await listSpecialistRuns()

    assert.equal(listed.total, 0)
  })

  it('runs the research specialist with cited findings', async () => {
    await openFixture()

    const started = await runSpecialist(
      { specialist: 'research', task: 'Where is auth?' },
      {
        provider: new MockProvider({
          answer: JSON.stringify({
            findings: [
              {
                claim: 'Auth lives in src/auth.ts.',
                explanation: 'Class Auth is defined there.',
                file: 'src/auth.ts',
                line: 1,
                confidence: 'high',
              },
            ],
            existingImplementation: ['src/auth.ts'],
            openQuestions: [],
          }),
        }),
      }
    )

    assert.equal(started.state, 'running')
    assert.ok(started.id.startsWith('sp-'))

    const run = await waitForTerminal(started.id)

    assert.equal(run.state, 'succeeded')
    assert.equal(run.result.findings.length, 1)
    assert.equal(run.result.findings[0].file, 'src/auth.ts')
    assert.ok(run.finishedAt)
  })

  it('runs the coding specialist and validates proposals without applying', async () => {
    const root = await openFixture()
    const before = await fs.readFile(path.join(root, 'src', 'auth.ts'), 'utf8')

    const started = await runSpecialist(
      { specialist: 'coding', task: 'Add login', contextPaths: ['src/auth.ts'] },
      {
        provider: new MockProvider({
          answer: JSON.stringify({
            edits: [
              {
                path: 'src/auth.ts',
                action: 'modify',
                content: 'export class Auth { login() { return true } }\n',
                reason: 'Add login.',
              },
            ],
            notes: 'One edit.',
          }),
        }),
      }
    )
    const run = await waitForTerminal(started.id)

    assert.equal(run.state, 'succeeded')
    assert.equal(run.result.edits.length, 1)
    assert.ok(/^[0-9a-f]{64}$/.test(run.result.edits[0].originalDigest))

    const after = await fs.readFile(path.join(root, 'src', 'auth.ts'), 'utf8')

    assert.equal(after, before)
  })

  it('records escaping coding proposals as failed', async () => {
    await openFixture()

    const started = await runSpecialist(
      { specialist: 'coding', task: 'Escape' },
      {
        provider: new MockProvider({
          answer: JSON.stringify({
            edits: [{ path: '../escape.ts', action: 'create', content: 'x', reason: 'evil' }],
            notes: '',
          }),
        }),
      }
    )
    const run = await waitForTerminal(started.id)

    assert.equal(run.state, 'failed')
    assert.ok(run.error.length > 0)
  })

  it('runs testing, debugging, and security specialists structurally', async () => {
    await openFixture()

    const testingStarted = await runSpecialist(
      { specialist: 'testing', task: 'What tests cover auth?' },
      {
        provider: new MockProvider({
          answer: JSON.stringify({
            relevantTests: [{ file: 'src/auth.test.ts', reason: 'Covers Auth.' }],
            coverageGaps: ['No login test.'],
            suggestedTests: [],
            commands: ['npm test'],
          }),
        }),
      }
    )
    const testing = await waitForTerminal(testingStarted.id)

    assert.equal(testing.result.relevantTests.length, 1)

    const debuggingStarted = await runSpecialist(
      { specialist: 'debugging', task: 'Login throws.' },
      {
        provider: new MockProvider({
          answer: JSON.stringify({
            summary: 'Null user.',
            likelyCauses: [{ explanation: 'Missing guard.', file: 'src/auth.ts', line: 1, confidence: 'medium' }],
            affectedCode: [],
            proposedRepairs: [{ description: 'Add guard.', files: ['src/auth.ts'] }],
          }),
        }),
      }
    )
    const debugging = await waitForTerminal(debuggingStarted.id)

    assert.equal(debugging.result.likelyCauses.length, 1)

    const securityStarted = await runSpecialist(
      { specialist: 'security', task: 'Review auth.' },
      {
        provider: new MockProvider({
          answer: JSON.stringify({
            findings: [
              {
                severity: 'high',
                title: 'Weak check',
                explanation: 'No rate limit.',
                file: 'src/auth.ts',
                line: 1,
                confidence: 'high',
                recommendation: 'Add rate limiting.',
              },
            ],
            permissionNotes: [],
            secretNotes: [],
          }),
        }),
      }
    )
    const security = await waitForTerminal(securityStarted.id)

    assert.equal(security.result.findings[0].severity, 'high')
  })

  it('runs independent review against a tracked plan', async () => {
    await openFixture()

    const plan = await createPlan({
      task: 'Add login',
      expectedOutcome: 'Login works.',
      risks: [],
      suggestedSteps: ['Implement login'],
    })

    const started = await runSpecialist(
      { specialist: 'review', task: 'Review this plan.', planId: plan.id },
      {
        provider: new MockProvider({
          answer: JSON.stringify({
            verdict: 'request-changes',
            requirementCoverage: [{ requirement: 'Login', covered: false, evidence: 'No edits yet.' }],
            issues: [{ severity: 'medium', explanation: 'Missing verification.', file: null }],
            risks: ['Unverified.'],
          }),
        }),
      }
    )
    const run = await waitForTerminal(started.id)

    assert.equal(run.result.verdict, 'request-changes')
    assert.equal(run.planId, plan.id)
  })

  it('records malformed specialist output as failed', async () => {
    await openFixture()

    const started = await runSpecialist(
      { specialist: 'review', task: 'Review.' },
      { provider: new MockProvider({ answer: 'not json at all' }) }
    )
    const run = await waitForTerminal(started.id)

    assert.equal(run.state, 'failed')
    assert.ok(run.error.includes('valid result'))
  })

  it('lists runs newest first', async () => {
    await openFixture()

    const answer = JSON.stringify({ findings: [], existingImplementation: [], openQuestions: [] })
    const first = await runSpecialist(
      { specialist: 'research', task: 'one' },
      { provider: new MockProvider({ answer }) }
    )

    await waitForTerminal(first.id)

    const second = await runSpecialist(
      { specialist: 'research', task: 'two' },
      { provider: new MockProvider({ answer }) }
    )

    await waitForTerminal(second.id)

    const listed = await listSpecialistRuns()

    assert.equal(listed.total, 2)
    assert.equal(listed.runs[0].task, 'two')
  })

  it('cancels an in-flight run by id and records cancellation', async () => {
    await openFixture()

    const provider = new MockProvider({
      answer: JSON.stringify({ findings: [] }),
      delayMs: 5000,
    })
    const started = await runSpecialist(
      { specialist: 'research', task: 'slow' },
      { provider }
    )

    assert.equal(started.state, 'running')

    for (let i = 0; i < 200 && provider.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    assert.equal(provider.calls.length, 1)

    const outcome = cancelSpecialistRun(started.id)

    assert.equal(outcome.cancelled, true)

    const run = await waitForTerminal(started.id)

    assert.equal(run.state, 'cancelled')

    const idle = cancelSpecialistRun(started.id)

    assert.equal(idle.cancelled, false)
  })

  it('times out long runs and reports the timeout honestly', async () => {
    await openFixture()

    const started = await runSpecialist(
      { specialist: 'research', task: 'slow' },
      {
        provider: new MockProvider({
          answer: JSON.stringify({ findings: [] }),
          delayMs: 5000,
        }),
        timeoutMs: 50,
      }
    )
    const run = await waitForTerminal(started.id)

    assert.equal(run.state, 'timeout')
    assert.ok(run.error.includes('timed out'))
  })
})
