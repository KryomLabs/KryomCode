const { describe, it, afterEach } = require('node:test')
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
  MockProvider,
} = require('../ai/providers/mock.provider.cjs')
const {
  saveWorkflow,
} = require('./workflow-store.cjs')
const {
  startRun,
  advanceRun,
  approveRun,
  cancelRun,
  getRun,
  listRuns,
} = require('./workflow-engine.cjs')

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
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-wfrun-'))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-wfws-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'auth.ts'), 'export class AuthService {}\n')
  await setWorkspaceRoot(root)
  await refreshIndex()

  return { base, root }
}

describe('workflow-engine', () => {
  it('runs intelligence workflows to completion with history', async () => {
    const { base } = await openFixture()

    const started = await startRun(
      { workflowId: 'project-analysis', inputs: { focus: 'auth' }, task: 'auth' },
      { baseDir: base }
    )

    assert.equal(started.state, 'active')

    const done = await advanceRun(started.id, { baseDir: base })

    assert.equal(done.state, 'completed')
    assert.equal(done.outcome.completed, true)
    assert.ok(done.steps.every((step) => step.state === 'ok'))
    assert.ok(done.history.length >= 4)

    const listed = await listRuns()

    assert.equal(listed.total, 1)
    assert.equal(listed.runs[0].id, started.id)
  })

  it('retention spares unfinished runs past the cap', async () => {
    const { base } = await openFixture()
    const ids = []

    for (let index = 0; index < 31; index += 1) {
      const started = await startRun(
        { workflowId: 'project-analysis', inputs: { focus: 'auth' }, task: 'auth' },
        { baseDir: base }
      )

      ids.push(started.id)
    }

    // All 31 stay active (never advanced): retention must not delete
    // unfinished runs to satisfy the cap.
    const listed = await listRuns()

    assert.equal(listed.total, 31)

    const first = await getRun(ids[0])

    assert.equal(first.id, ids[0])
  })

  it('pauses at approval checkpoints and resumes on approve', async () => {
    const { base } = await openFixture()

    await saveWorkflow(
      {
        workflowVersion: 1,
        id: 'gated-flow',
        name: 'Gated',
        description: '',
        version: '1.0.0',
        inputs: [],
        steps: [
          { id: 'arch', kind: 'intelligence.architecture', title: 'Arch' },
          { id: 'gate', kind: 'approval.checkpoint', title: 'Gate', message: 'Go?' },
          { id: 'report', kind: 'report', title: 'Report' },
        ],
      },
      { scope: 'user', baseDir: base }
    )

    const started = await startRun({ workflowId: 'gated-flow' }, { baseDir: base })
    const paused = await advanceRun(started.id, { baseDir: base })

    assert.equal(paused.state, 'awaiting-approval')
    assert.equal(paused.pendingStep, 'gate')

    await assert.rejects(() => advanceRun(started.id, { baseDir: base }), /awaiting approval/)

    await approveRun(started.id, { decision: 'approve' })

    const done = await advanceRun(started.id, { baseDir: base })

    assert.equal(done.state, 'completed')
  })

  it('cancels runs on approval denial', async () => {
    const { base } = await openFixture()

    await saveWorkflow(
      {
        workflowVersion: 1,
        id: 'gated-flow',
        name: 'Gated',
        description: '',
        version: '1.0.0',
        inputs: [],
        steps: [{ id: 'gate', kind: 'approval.checkpoint', title: 'Gate', message: 'Go?' }],
      },
      { scope: 'user', baseDir: base }
    )

    const started = await startRun({ workflowId: 'gated-flow' }, { baseDir: base })

    await advanceRun(started.id, { baseDir: base })

    const denied = await approveRun(started.id, { decision: 'deny' })

    assert.equal(denied.state, 'cancelled')
  })

  it('evaluates conditions and skips non-matching steps', async () => {
    const { base } = await openFixture()

    await saveWorkflow(
      {
        workflowVersion: 1,
        id: 'cond-flow',
        name: 'Cond',
        description: '',
        version: '1.0.0',
        inputs: [],
        steps: [
          { id: 'arch', kind: 'intelligence.architecture', title: 'Arch' },
          {
            id: 'maybe',
            kind: 'intelligence.search',
            title: 'Maybe',
            params: { query: 'auth' },
            if: { ref: 'steps.arch.primaryLanguage', equals: 'cobol' },
          },
          { id: 'report', kind: 'report', title: 'Report' },
        ],
      },
      { scope: 'user', baseDir: base }
    )

    const started = await startRun({ workflowId: 'cond-flow' }, { baseDir: base })
    const done = await advanceRun(started.id, { baseDir: base })

    assert.equal(done.state, 'completed')

    const maybe = done.steps.find((step) => step.id === 'maybe')

    assert.equal(maybe.state, 'skipped')
    assert.equal(done.outcome.skipped, 1)
  })

  it('fails loudly on blocking step errors with the failed stage named', async () => {
    const { base } = await openFixture()

    await saveWorkflow(
      {
        workflowVersion: 1,
        id: 'fail-flow',
        name: 'Fail',
        description: '',
        version: '1.0.0',
        inputs: [],
        steps: [{ id: 'impact', kind: 'intelligence.impact', title: 'Impact' }],
      },
      { scope: 'user', baseDir: base }
    )

    const started = await startRun({ workflowId: 'fail-flow' }, { baseDir: base })
    const done = await advanceRun(started.id, { baseDir: base })

    assert.equal(done.state, 'failed')
    assert.equal(done.outcome.failedStep, 'impact')
    assert.ok(done.outcome.reason.includes('params.paths'))
  })

  it('refuses apply steps without a prior approval', async () => {
    const { base } = await openFixture()

    await saveWorkflow(
      {
        workflowVersion: 1,
        id: 'apply-flow',
        name: 'Apply',
        description: '',
        version: '1.0.0',
        inputs: [],
        steps: [{ id: 'apply', kind: 'agent.apply', title: 'Apply', params: { edits: [] } }],
      },
      { scope: 'user', baseDir: base }
    )

    const started = await startRun({ workflowId: 'apply-flow' }, { baseDir: base })
    const done = await advanceRun(started.id, { baseDir: base })

    assert.equal(done.state, 'failed')
    assert.ok(done.outcome.reason.includes('approval'))
  })

  it('runs specialist steps with injected providers', async () => {
    const { base } = await openFixture()

    await saveWorkflow(
      {
        workflowVersion: 1,
        id: 'spec-flow',
        name: 'Spec',
        description: '',
        version: '1.0.0',
        inputs: [],
        steps: [
          {
            id: 'research',
            kind: 'specialist.run',
            title: 'Research',
            specialist: 'research',
            task: 'What is here?',
            timeoutMs: 30000,
          },
        ],
      },
      { scope: 'user', baseDir: base }
    )

    const provider = new MockProvider({
      answer: JSON.stringify({ findings: [], existingImplementation: [], openQuestions: [] }),
    })
    const started = await startRun({ workflowId: 'spec-flow' }, { baseDir: base })
    const done = await advanceRun(started.id, { baseDir: base, provider })

    assert.equal(done.state, 'completed')
    assert.ok(done.steps[0].output.specialistRunId)
  })

  it('cancels active runs and preserves the record', async () => {
    const { base } = await openFixture()

    const started = await startRun(
      { workflowId: 'project-analysis', inputs: { focus: 'x' }, task: 'x' },
      { baseDir: base }
    )
    const cancelled = await cancelRun(started.id, { baseDir: base })

    assert.equal(cancelled.state, 'cancelled')

    const fetched = await getRun(started.id)

    assert.equal(fetched.state, 'cancelled')
  })
})
