// Freshness tests (Level 3B.1): pre-apply file states, traversal
// resistance, isolation, and mixed batches. Read-only; no writes.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  checkEditFreshness,
} = require('./freshness.cjs')

function digestOf(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

async function openWorkspace(prefix = 'kryom-fresh-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))

  await setWorkspaceRoot(root)

  return root
}

describe('freshness', () => {
  it('reports current files and pending creates', async () => {
    const root = await openWorkspace()

    await fs.writeFile(path.join(root, 'ok.ts'), 'same\n')

    const result = await checkEditFreshness([
      {
        path: path.join(root, 'ok.ts'),
        action: 'modify',
        content: 'new\n',
        originalDigest: digestOf('same\n'),
        originalLength: 5,
      },
      { path: path.join(root, 'made.ts'), action: 'create', content: 'x' },
    ])

    assert.equal(result.allCurrent, true)
    assert.deepEqual(
      result.edits.map((entry) => entry.status),
      ['current', 'current']
    )
    assert.equal(result.edits[0].path, 'ok.ts')
  })

  it('detects changed, missing, and already-created files', async () => {
    const root = await openWorkspace()

    await fs.writeFile(path.join(root, 'changed.ts'), 'v2\n')
    await fs.writeFile(path.join(root, 'taken.ts'), 'exists\n')

    const result = await checkEditFreshness([
      {
        path: path.join(root, 'changed.ts'),
        action: 'modify',
        content: 'v3\n',
        originalDigest: digestOf('v1\n'),
        originalLength: 3,
      },
      { path: path.join(root, 'gone.ts'), action: 'delete' },
      { path: path.join(root, 'taken.ts'), action: 'create', content: 'x' },
    ])

    assert.equal(result.allCurrent, false)
    assert.deepEqual(
      result.edits.map((entry) => entry.status),
      ['stale', 'missing', 'stale']
    )
    assert.match(result.edits[0].reason, /Changed since the plan/)
    assert.match(result.edits[1].reason, /Removed since the plan/)
    assert.match(result.edits[2].reason, /already exists/)
  })

  it('detects same-size content changes by digest', async () => {
    const root = await openWorkspace()

    await fs.writeFile(path.join(root, 'swap.ts'), 'aaaa\n')

    const result = await checkEditFreshness([
      {
        path: path.join(root, 'swap.ts'),
        action: 'modify',
        content: 'x\n',
        originalDigest: digestOf('bbbb\n'),
        originalLength: 5,
      },
    ])

    assert.equal(result.edits[0].status, 'stale')
  })

  it('marks non-file targets inaccessible', async () => {
    const root = await openWorkspace()

    await fs.mkdir(path.join(root, 'adir'))

    const result = await checkEditFreshness([
      {
        path: path.join(root, 'adir'),
        action: 'modify',
        content: 'x',
        originalDigest: digestOf('x\n'),
      },
    ])

    assert.equal(result.edits[0].status, 'inaccessible')
  })

  it('marks symlink targets inaccessible', async (t) => {
    const root = await openWorkspace()

    await fs.writeFile(path.join(root, 'real.ts'), 'x\n')

    try {
      await fs.symlink(
        path.join(root, 'real.ts'),
        path.join(root, 'link.ts')
      )
    } catch (error) {
      t.skip(`symlink creation unavailable: ${error.message}`)
      return
    }

    const result = await checkEditFreshness([
      {
        path: path.join(root, 'link.ts'),
        action: 'modify',
        content: 'x',
        originalDigest: digestOf('x\n'),
      },
    ])

    assert.equal(result.edits[0].status, 'inaccessible')
  })

  it('marks digest-less edits unverified instead of guessing', async () => {
    const root = await openWorkspace()

    await fs.writeFile(path.join(root, 'plain.ts'), 'x\n')

    const result = await checkEditFreshness([
      { path: path.join(root, 'plain.ts'), action: 'modify', content: 'y\n' },
    ])

    assert.equal(result.edits[0].status, 'unverified')
    assert.equal(result.allCurrent, false)
  })

  it('keeps checks inside the open project', async () => {
    const rootA = await openWorkspace('kryom-fresh-a-')

    await fs.writeFile(path.join(rootA, 'a.ts'), 'a\n')

    const digest = digestOf('a\n')

    await openWorkspace('kryom-fresh-b-')

    const result = await checkEditFreshness([
      {
        path: path.join(rootA, 'a.ts'),
        action: 'modify',
        content: 'b\n',
        originalDigest: digest,
      },
    ])

    assert.equal(result.edits[0].status, 'inaccessible')
    assert.match(result.edits[0].reason, /Outside the open project/)
  })

  it('rejects malformed entries fail-closed', async () => {
    await openWorkspace()

    await assert.rejects(() => checkEditFreshness([]), /No edits/)
    await assert.rejects(() => checkEditFreshness('edits'), /No edits/)
    await assert.rejects(
      () => checkEditFreshness([{ action: 'modify' }]),
      /edits\[0\]\.path is invalid/
    )
    await assert.rejects(
      () => checkEditFreshness([{ path: 'x', action: 'explode' }]),
      /edits\[0\]\.action is invalid/
    )
    await assert.rejects(
      () => checkEditFreshness([null]),
      /edits\[0\] is invalid/
    )
    await assert.rejects(
      () =>
        checkEditFreshness(
          new Array(21).fill({ path: 'x', action: 'delete' })
        ),
      /At most 20/
    )
  })

  it('requires an open project', async () => {
    const { closeWorkspace } = require('../workspace/workspace.service.cjs')

    await openWorkspace()
    await closeWorkspace()

    await assert.rejects(
      () => checkEditFreshness([{ path: 'x', action: 'delete' }]),
      /Open a project/
    )
  })
})
