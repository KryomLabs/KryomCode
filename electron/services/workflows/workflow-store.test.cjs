const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  validateWorkflow,
  listWorkflows,
  getWorkflow,
  saveWorkflow,
  deleteWorkflow,
} = require('./workflow-store.cjs')
const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-wfstore-'))
}

function validWorkflow(overrides = {}) {
  return {
    workflowVersion: 1,
    id: 'my-flow',
    name: 'My flow',
    description: '',
    version: '1.0.0',
    inputs: [{ name: 'focus', description: '', default: '' }],
    steps: [
      { id: 'arch', kind: 'intelligence.architecture', title: 'Arch' },
      { id: 'gate', kind: 'approval.checkpoint', title: 'Gate', message: 'Proceed?' },
    ],
    ...overrides,
  }
}

describe('workflow-store', () => {
  it('validates definitions strictly', () => {
    assert.equal(validateWorkflow(validWorkflow()).steps.length, 2)
    assert.throws(() => validateWorkflow({ ...validWorkflow(), id: 'Bad!' }), /"id"/)
    assert.throws(() => validateWorkflow({ ...validWorkflow(), steps: [] }), /1-20 steps/)
    assert.throws(
      () => validateWorkflow(validWorkflow({ steps: [{ id: 'step-x', kind: 'nope' }] })),
      /unknown kind/
    )
    assert.throws(
      () => validateWorkflow(validWorkflow({ steps: [{ id: 'step-x', kind: 'skill.run' }] })),
      /needs "uses"/
    )
    assert.throws(
      () => validateWorkflow(validWorkflow({ steps: [{ id: 'step-x', kind: 'approval.checkpoint' }] })),
      /approval "message"/
    )
    assert.throws(
      () => validateWorkflow(validWorkflow({ steps: [{ id: 'step-x', kind: 'report', retries: 9 }] })),
      /retries/
    )
  })

  it('ships the five builtin workflows', async () => {
    const base = await tempBase()
    const listed = await listWorkflows({ baseDir: base })
    const ids = listed.workflows.map((entry) => entry.id)

    for (const id of ['project-analysis', 'feature-implementation', 'bug-investigation', 'test-verification', 'security-review']) {
      assert.ok(ids.includes(id), `missing builtin ${id}`)
    }

    assert.deepEqual(listed.corrupt, [])

    const feature = await getWorkflow('feature-implementation', { baseDir: base })

    assert.ok(feature.steps.some((step) => step.kind === 'approval.checkpoint'))
    assert.ok(feature.steps.some((step) => step.kind === 'agent.apply'))
  })

  it('manages user and project definitions', async () => {
    const base = await tempBase()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-wfws-'))

    await setWorkspaceRoot(root)
    await saveWorkflow(validWorkflow(), { scope: 'user', baseDir: base })
    assert.equal((await getWorkflow('my-flow', { baseDir: base })).scope, 'user')

    await saveWorkflow(validWorkflow({ description: 'project' }), { scope: 'project', baseDir: base })
    assert.equal((await getWorkflow('my-flow', { baseDir: base })).scope, 'project')

    await deleteWorkflow('my-flow', { scope: 'project', baseDir: base })
    assert.equal((await getWorkflow('my-flow', { baseDir: base })).scope, 'user')

    await deleteWorkflow('my-flow', { scope: 'user', baseDir: base })
    await assert.rejects(() => getWorkflow('my-flow', { baseDir: base }), /not found/)
  })
})
