const { describe, it } = require('node:test')
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
const { planTask, applyEdits } = require('./agent.service.cjs')

function useTestKey() {
  const saved = {
    MODEL_API_KEY: process.env.MODEL_API_KEY,
    META_MODEL: process.env.META_MODEL,
  }

  process.env.MODEL_API_KEY = 'test-key'
  delete process.env.META_MODEL

  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

async function openWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-agent-'))
  await setWorkspaceRoot(dir)

  return dir
}

describe('agent.service', () => {
  it('plans validated edits and returns commands unexecuted', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'new.txt')
      const sentinel = path.join(root, 'must-not-exist.txt')
      const provider = new MockProvider({
        answer: JSON.stringify({
          edits: [{ path: target, action: 'create', content: 'planned' }],
          commands: [`node -e "require('fs').writeFileSync('${sentinel}', 'x')"`],
          notes: 'demo plan',
        }),
      })

      const plan = await planTask({ task: 'Add a file.' }, { provider })

      assert.equal(plan.edits.length, 1)
      // planTask returns the validated real path, which may differ in
      // string form from the input on Windows (8.3 short names).
      assert.equal(
        plan.edits[0].path,
        path.join(await fs.realpath(root), 'new.txt')
      )
      assert.equal(plan.edits[0].preview, 'planned')
      assert.equal(plan.commands.length, 1)
      assert.equal(plan.model, 'muse-spark-1.3')

      await assert.rejects(() => fs.stat(target))
      await assert.rejects(() => fs.stat(sentinel))
    } finally {
      restore()
    }
  })

  it('rejects malformed plans and traversal paths', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()

      const badJson = new MockProvider({ answer: 'not json at all' })
      await assert.rejects(
        () => planTask({ task: 'Do it.' }, { provider: badJson }),
        /valid plan/
      )

      const traversal = new MockProvider({
        answer: JSON.stringify({
          edits: [
            { path: path.join(root, '..', 'evil.txt'), action: 'create', content: 'x' },
          ],
        }),
      })
      await assert.rejects(
        () => planTask({ task: 'Do it.' }, { provider: traversal }),
        /outside/
      )
    } finally {
      restore()
    }
  })

  it('applies approved edits and rolls back on failure', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const existing = path.join(root, 'keep.txt')
      await fs.writeFile(existing, 'original')

      const ok = await applyEdits({
        edits: [
          { path: path.join(root, 'made.txt'), action: 'create', content: 'new' },
          { path: existing, action: 'modify', content: 'updated' },
        ],
      })

      assert.equal(ok.completed, true)
      assert.equal(ok.rolledBack, false)
      assert.equal(ok.applied.length, 2)
      assert.equal(await fs.readFile(existing, 'utf8'), 'updated')

      const failed = await applyEdits({
        edits: [
          { path: existing, action: 'modify', content: 'broken-plan' },
          { path: path.join(root, 'missing.txt'), action: 'delete' },
        ],
      })

      assert.equal(failed.completed, false)
      assert.equal(failed.rolledBack, true)
      assert.ok(failed.failed)
      assert.equal(await fs.readFile(existing, 'utf8'), 'updated')
    } finally {
      restore()
    }
  })

  it('stops applying when cancelled and rejects bad edits', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'cancelled.txt')
      const controller = new AbortController()
      controller.abort()

      const cancelled = await applyEdits(
        { edits: [{ path: target, action: 'create', content: 'x' }] },
        { signal: controller.signal }
      )

      assert.equal(cancelled.cancelled, true)
      assert.equal(cancelled.completed, false)
      await assert.rejects(() => fs.stat(target))

      await assert.rejects(() => applyEdits({ edits: [] }), /No approved edits/)
      const invalid = await applyEdits({
        edits: [{ path: target, action: 'explode', content: 'x' }],
      })

      assert.equal(invalid.completed, false)
      assert.equal(invalid.rolledBack, true)
      assert.match(invalid.failed.message, /invalid/)
    } finally {
      restore()
    }
  })
})
