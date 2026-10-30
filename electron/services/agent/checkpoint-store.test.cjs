const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
  getWorkspaceRoot,
  closeWorkspace,
} = require('../workspace/workspace.service.cjs')
const { applyEdits } = require('./agent.service.cjs')
const {
  MAX_CHECKPOINTS,
  listCheckpoints,
  undoCheckpoint,
} = require('./checkpoint-store.cjs')

async function openWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-checkpoint-'))
  await setWorkspaceRoot(dir)

  return dir
}

function digestOf(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function checkpointDir(root, id) {
  return path.join(root, '.kryom', 'checkpoints', id)
}

describe('checkpoint-store', () => {
  it('records a checkpoint on apply and undoes it across a restart', async () => {
    const root = await openWorkspace()
    const kept = path.join(root, 'keep.txt')
    const removed = path.join(root, 'gone.txt')
    const made = path.join(root, 'made.txt')

    await fs.writeFile(kept, 'original')
    await fs.writeFile(removed, 'doomed')

    try {
      const applied = await applyEdits({
        task: 'Checkpoint probe',
        edits: [
          {
            path: kept,
            action: 'modify',
            content: 'updated',
            originalDigest: digestOf('original'),
          },
          {
            path: removed,
            action: 'delete',
            originalDigest: digestOf('doomed'),
          },
          { path: made, action: 'create', content: 'new' },
        ],
      })

      assert.equal(applied.completed, true)
      assert.ok(applied.checkpoint && applied.checkpoint.id)
      assert.equal(applied.checkpoint.files, 3)

      const listed = await listCheckpoints()

      assert.equal(listed.checkpoints.length, 1)
      assert.equal(listed.checkpoints[0].id, applied.checkpoint.id)
      assert.equal(listed.checkpoints[0].task, 'Checkpoint probe')
      assert.equal(listed.checkpoints[0].files, 3)

      // Simulate a restart: re-resolve the root so only disk state
      // (the checkpoint) carries the undo information.
      await setWorkspaceRoot(root)

      const undone = await undoCheckpoint(applied.checkpoint.id)

      assert.equal(undone.completed, true)
      assert.deepEqual(undone.failures, [])
      assert.deepEqual(undone.skipped, [])
      assert.equal(undone.restored.length, 3)
      assert.equal(await fs.readFile(kept, 'utf8'), 'original')
      assert.equal(await fs.readFile(removed, 'utf8'), 'doomed')
      await assert.rejects(fs.stat(made), /ENOENT/)
    } finally {
      await closeWorkspace()
    }
  })

  it('skips files the user changed since the apply', async () => {
    const root = await openWorkspace()
    const target = path.join(root, 'app.txt')
    const resolvedTarget = path.join(getWorkspaceRoot(), 'app.txt')

    await fs.writeFile(target, 'v1')

    try {
      const applied = await applyEdits({
        edits: [
          {
            path: target,
            action: 'modify',
            content: 'v2',
            originalDigest: digestOf('v1'),
          },
        ],
      })

      assert.equal(applied.completed, true)

      await fs.writeFile(target, 'user edit')

      const undone = await undoCheckpoint(applied.checkpoint.id)

      assert.equal(undone.completed, true)
      assert.deepEqual(undone.restored, [])
      assert.deepEqual(undone.skipped, [
        { path: resolvedTarget, reason: 'changed since apply' },
      ])
      assert.equal(await fs.readFile(target, 'utf8'), 'user edit')
    } finally {
      await closeWorkspace()
    }
  })

  it('refuses to restore from a damaged snapshot', async () => {
    const root = await openWorkspace()
    const target = path.join(root, 'app.txt')

    await fs.writeFile(target, 'v1')

    try {
      const applied = await applyEdits({
        edits: [
          {
            path: target,
            action: 'modify',
            content: 'v2',
            originalDigest: digestOf('v1'),
          },
        ],
      })

      const dir = checkpointDir(root, applied.checkpoint.id)
      await fs.writeFile(path.join(dir, '0.bin'), 'tampered')

      const undone = await undoCheckpoint(applied.checkpoint.id)

      assert.equal(undone.completed, false)
      assert.deepEqual(undone.restored, [])
      assert.equal(undone.failures.length, 1)
      assert.match(undone.failures[0].reason, /snapshot damaged/)
      assert.equal(await fs.readFile(target, 'utf8'), 'v2')
    } finally {
      await closeWorkspace()
    }
  })

  it('reports repeat undos honestly instead of rewriting history', async () => {
    const root = await openWorkspace()
    const target = path.join(root, 'app.txt')
    const resolvedTarget = path.join(getWorkspaceRoot(), 'app.txt')

    await fs.writeFile(target, 'v1')

    try {
      const applied = await applyEdits({
        edits: [
          {
            path: target,
            action: 'modify',
            content: 'v2',
            originalDigest: digestOf('v1'),
          },
        ],
      })

      const first = await undoCheckpoint(applied.checkpoint.id)

      assert.equal(first.completed, true)
      assert.deepEqual(first.restored, [resolvedTarget])

      const second = await undoCheckpoint(applied.checkpoint.id)

      assert.equal(second.completed, true)
      assert.deepEqual(second.restored, [])
      assert.deepEqual(second.skipped, [
        { path: resolvedTarget, reason: 'changed since apply' },
      ])
    } finally {
      await closeWorkspace()
    }
  })

  it('prunes checkpoints beyond the retention cap', async () => {
    const root = await openWorkspace()
    const target = path.join(root, 'app.txt')

    await fs.writeFile(target, 'v0')

    try {
      let firstId = null

      for (let round = 1; round <= MAX_CHECKPOINTS + 1; round += 1) {
        // Distinct timestamps keep oldest-first pruning deterministic.
        await new Promise((resolve) => setTimeout(resolve, 2))

        const current = await fs.readFile(target, 'utf8')
        const applied = await applyEdits({
          edits: [
            {
              path: target,
              action: 'modify',
              content: `v${round}`,
              originalDigest: digestOf(current),
            },
          ],
        })

        assert.equal(applied.completed, true)

        if (round === 1) {
          firstId = applied.checkpoint.id
        }
      }

      const listed = await listCheckpoints()

      assert.equal(listed.checkpoints.length, MAX_CHECKPOINTS)
      assert.ok(!listed.checkpoints.some((entry) => entry.id === firstId))
      await assert.rejects(
        fs.stat(checkpointDir(root, firstId)),
        /ENOENT/
      )
    } finally {
      await closeWorkspace()
    }
  })

  it('rejects unknown, malformed, and missing-root undos', async () => {
    const root = await openWorkspace()

    try {
      await assert.rejects(
        undoCheckpoint('cp-does-not-exist'),
        /Checkpoint not found/
      )
      await assert.rejects(undoCheckpoint('../evil'), /Invalid checkpoint id/)
      await assert.rejects(undoCheckpoint(''), /Invalid checkpoint id/)
      await assert.rejects(undoCheckpoint(null), /No checkpoints to undo/)
    } finally {
      await closeWorkspace()
    }

    await assert.rejects(undoCheckpoint(null), /Open a project folder/)
    assert.deepEqual(await listCheckpoints(), { checkpoints: [] })
    assert.ok(root)
  })
})
