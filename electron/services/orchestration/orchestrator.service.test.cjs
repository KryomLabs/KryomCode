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
  createPlan,
  setStepState,
} = require('../agent/plan-store.cjs')
const {
  startRun,
  advanceRun,
  approveTask,
  retryTask,
  cancelRun,
} = require('./orchestrator.service.cjs')

const SAVED_KEY = process.env.MODEL_API_KEY

afterEach(() => {
  if (SAVED_KEY === undefined) {
    delete process.env.MODEL_API_KEY
  } else {
    process.env.MODEL_API_KEY = SAVED_KEY
  }
})

// Deterministic multi-answer provider double. Answers queue in call
// order; the last answer repeats so retries stay scripted.
class ScriptedProvider {
  constructor(answers) {
    this.answers = [...answers]
    this.calls = []
  }

  async chat({ model, messages, signal } = {}) {
    this.calls.push({ model, messages })

    if (signal && signal.aborted) {
      const error = new Error('Mock request was cancelled.')

      error.name = 'AbortError'

      throw error
    }

    const answer = this.answers.length > 1 ? this.answers.shift() : this.answers[0]

    return { answer, model: model || 'mock' }
  }
}

function codingAnswer(editPath, content) {
  return JSON.stringify({
    edits: [{ path: editPath, action: 'modify', content, reason: 'test' }],
    notes: '',
  })
}

async function openFixture() {
  process.env.MODEL_API_KEY = 'test-key'
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-orch-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1\n')
  await fs.writeFile(path.join(root, 'src', 'b.ts'), 'export const b = 1\n')
  await fs.writeFile(path.join(root, 'src', 'c.ts'), 'export const c = 1\n')
  await setWorkspaceRoot(root)
  await refreshIndex()

  return root
}

async function approvedPlan() {
  const plan = await createPlan({
    task: 'Orchestrated work',
    expectedOutcome: 'Done.',
    risks: [],
    suggestedSteps: ['One', 'Two'],
  })

  await setStepState(plan.id, 'review', 'in_progress')
  await setStepState(plan.id, 'review', 'completed')

  return plan
}

async function waitForTask(runId, taskIndex, states, options, timeoutMs = 15000) {
  const start = Date.now()

  for (;;) {
    const run = await advanceRun(runId, options)
    const task = run.tasks[taskIndex]

    if (states.includes(task.state)) {
      return run
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Task ${taskIndex} did not reach ${states.join('/')} (is ${task.state}).`)
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function settle(runId, options) {
  // Advances until no task is pending/running: collects proposals as
  // the background specialists finish.
  for (let i = 0; i < 60; i += 1) {
    const run = await advanceRun(runId, options)

    if (run.tasks.every((task) => task.state !== 'pending' && task.state !== 'running')) {
      return run
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Run ${runId} did not settle.`)
}

describe('orchestrator', () => {
  it('requires an approved plan before starting', async () => {
    await openFixture()

    const plan = await createPlan({
      task: 'Unapproved',
      expectedOutcome: 'x',
      risks: [],
      suggestedSteps: ['One'],
    })

    await assert.rejects(
      () => startRun({ planId: plan.id, tasks: [{ specialist: 'research', title: 't', files: [] }] }),
      /not approved/
    )
  })

  it('rejects overlapping scopes without a dependency edge', async () => {
    await openFixture()

    const plan = await approvedPlan()

    await assert.rejects(
      () =>
        startRun({
          planId: plan.id,
          tasks: [
            { specialist: 'coding', title: 'A', files: ['src/a.ts'] },
            { specialist: 'coding', title: 'B', files: ['src/a.ts'] },
          ],
        }),
      /Conflicting task scopes/
    )

    const ordered = await startRun({
      planId: plan.id,
      tasks: [
        { specialist: 'coding', title: 'A', files: ['src/a.ts'] },
        { specialist: 'coding', title: 'B', files: ['src/a.ts'], dependsOn: [0] },
      ],
    })

    assert.equal(ordered.tasks.length, 2)
  })

  it('orchestrates two independent tasks to merged completion', async () => {
    const root = await openFixture()
    const plan = await approvedPlan()

    const provider = new ScriptedProvider([
      codingAnswer('src/a.ts', 'export const a = 2\n'),
      codingAnswer('src/b.ts', 'export const b = 2\n'),
    ])

    const started = await startRun({
      planId: plan.id,
      tasks: [
        { specialist: 'coding', title: 'Update A', files: ['src/a.ts'], planStepId: 'task-1' },
        { specialist: 'coding', title: 'Update B', files: ['src/b.ts'], planStepId: 'task-2' },
      ],
    })

    const settled = await settle(started.id, { provider })

    assert.deepEqual(
      settled.tasks.map((task) => task.state),
      ['proposed', 'proposed']
    )

    await approveTask(started.id, 'task-1')
    await approveTask(started.id, 'task-2')

    const done = await advanceRun(started.id, { provider })

    assert.equal(done.state, 'completed')
    assert.equal(done.outcome.merged, 2)
    assert.equal(done.outcome.partial, false)
    assert.ok(done.tasks[0].merge.checkpoint)
    assert.ok(done.tasks[1].merge.checkpoint)

    assert.equal(await fs.readFile(path.join(root, 'src', 'a.ts'), 'utf8'), 'export const a = 2\n')
    assert.equal(await fs.readFile(path.join(root, 'src', 'b.ts'), 'utf8'), 'export const b = 2\n')
  })

  it('rejects proposals outside the task scope without writing', async () => {
    const root = await openFixture()
    const plan = await approvedPlan()

    const provider = new ScriptedProvider([
      codingAnswer('src/b.ts', 'export const b = 99\n'),
    ])

    const started = await startRun({
      planId: plan.id,
      tasks: [{ specialist: 'coding', title: 'Update A', files: ['src/a.ts'] }],
    })

    await settle(started.id, { provider })

    const run = await approveTask(started.id, 'task-1')
    const task = run.tasks[0]

    assert.equal(task.state, 'rejected')
    assert.ok(task.error.includes('outside'))
    assert.equal(await fs.readFile(path.join(root, 'src', 'b.ts'), 'utf8'), 'export const b = 1\n')
  })

  it('merges non-coding tasks as findings with zero disk writes', async () => {
    const root = await openFixture()
    const plan = await approvedPlan()

    const provider = new ScriptedProvider([
      JSON.stringify({ findings: [], existingImplementation: [], openQuestions: [] }),
    ])

    const started = await startRun({
      planId: plan.id,
      tasks: [{ specialist: 'research', title: 'Investigate', files: [] }],
    })

    await settle(started.id, { provider })

    const run = await approveTask(started.id, 'task-1')

    assert.equal(run.tasks[0].state, 'merged')
    assert.equal(run.tasks[0].merge.edits, 0)
    assert.equal(await fs.readFile(path.join(root, 'src', 'a.ts'), 'utf8'), 'export const a = 1\n')
  })

  it('holds dependent tasks until their dependencies merge', async () => {
    const root = await openFixture()
    const plan = await approvedPlan()

    const provider = new ScriptedProvider([
      codingAnswer('src/a.ts', 'export const a = 2\n'),
      codingAnswer('src/b.ts', 'export const b = 2\n'),
    ])

    const started = await startRun({
      planId: plan.id,
      tasks: [
        { specialist: 'coding', title: 'First', files: ['src/a.ts'] },
        { specialist: 'coding', title: 'Second', files: ['src/b.ts'], dependsOn: [0] },
      ],
    })

    const first = await advanceRun(started.id, { provider })
    const states = first.tasks.map((task) => task.state)

    assert.ok(states.includes('running') || states.includes('proposed'))
    assert.equal(first.tasks[1].state, 'pending')

    await waitForTask(started.id, 0, ['proposed'], { provider })
    await approveTask(started.id, 'task-1')
    await waitForTask(started.id, 1, ['proposed'], { provider })
    await approveTask(started.id, 'task-2')

    const done = await advanceRun(started.id, { provider })

    assert.equal(done.state, 'completed')
    assert.equal(await fs.readFile(path.join(root, 'src', 'b.ts'), 'utf8'), 'export const b = 2\n')
  })

  it('limits concurrent generations and preserves partial work on cancel', async () => {
    const root = await openFixture()
    const plan = await approvedPlan()

    const provider = new ScriptedProvider([
      codingAnswer('src/a.ts', 'export const a = 2\n'),
      codingAnswer('src/b.ts', 'export const b = 2\n'),
      codingAnswer('src/c.ts', 'export const c = 2\n'),
    ])

    const started = await startRun({
      planId: plan.id,
      tasks: [
        { specialist: 'coding', title: 'A', files: ['src/a.ts'] },
        { specialist: 'coding', title: 'B', files: ['src/b.ts'] },
        { specialist: 'coding', title: 'C', files: ['src/c.ts'] },
      ],
    })

    const first = await advanceRun(started.id, { provider })
    const running = first.tasks.filter((task) => task.state === 'running').length

    assert.ok(running <= 2)

    await settle(started.id, { provider })
    await approveTask(started.id, 'task-1')

    const cancelled = await cancelRun(started.id)

    assert.equal(cancelled.state, 'cancelled')
    assert.equal(cancelled.tasks[0].state, 'merged')
    assert.ok(['cancelled', 'merged'].includes(cancelled.tasks[1].state))
    assert.equal(await fs.readFile(path.join(root, 'src', 'a.ts'), 'utf8'), 'export const a = 2\n')
  })

  it('retries stopped tasks within the attempt budget', async () => {
    await openFixture()

    const plan = await approvedPlan()
    const provider = new ScriptedProvider(['not json at all'])

    const started = await startRun({
      planId: plan.id,
      tasks: [{ specialist: 'research', title: 'Flaky', files: [] }],
    })

    const settled = await settle(started.id, { provider })

    assert.equal(settled.tasks[0].state, 'failed')

    const retried = await retryTask(started.id, 'task-1', { provider })

    assert.equal(retried.tasks[0].state, 'running')
    assert.equal(retried.tasks[0].attempts, 2)

    await assert.rejects(
      async () => {
        await settle(started.id, { provider })
        await retryTask(started.id, 'task-1', { provider })
      },
      /budget/
    )
  })

  it('reports stale merges without writing', async () => {
    const root = await openFixture()
    const plan = await approvedPlan()

    const provider = new ScriptedProvider([
      codingAnswer('src/a.ts', 'export const a = 2\n'),
    ])

    const started = await startRun({
      planId: plan.id,
      tasks: [{ specialist: 'coding', title: 'Update A', files: ['src/a.ts'] }],
    })

    await settle(started.id, { provider })
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 99\n')

    const run = await approveTask(started.id, 'task-1')

    // The change-set freshness analysis blocks first; either way the
    // merge stops with zero writes and an honest reason.
    assert.ok(['blocked', 'stale'].includes(run.tasks[0].state))
    assert.equal(await fs.readFile(path.join(root, 'src', 'a.ts'), 'utf8'), 'export const a = 99\n')
  })
})
