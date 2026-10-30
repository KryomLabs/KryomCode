const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
  getWorkspaceRoot,
  getPreviousWorkspaceRoot,
  closeWorkspace,
  isInsideWorkspace,
  isInsideScope,
  buildTree,
} = require('./workspace.service.cjs')

describe('workspace.service', () => {
  it('rejects an empty workspace path', async () => {
    await assert.rejects(
      () => setWorkspaceRoot(''),
      /valid workspace directory/
    )
  })

  it('accepts a real directory and contains paths inside it', async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'kryom-workspace-')
    )
    const root = await setWorkspaceRoot(dir)

    assert.equal(getWorkspaceRoot(), root)
    assert.equal(
      isInsideWorkspace(path.join(root, 'src', 'app.ts')),
      true
    )
    assert.equal(
      isInsideWorkspace(path.join(root, '..', 'outside.txt')),
      false
    )
  })

  it('tracks the previously opened root for in-flight saves', async () => {
    const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-prev-a-'))
    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-prev-b-'))
    const rootA = await setWorkspaceRoot(dirA)
    const rootB = await setWorkspaceRoot(dirB)

    assert.equal(getWorkspaceRoot(), rootB)
    assert.equal(getPreviousWorkspaceRoot(), rootA)

    closeWorkspace()

    assert.equal(getWorkspaceRoot(), null)
    assert.equal(getPreviousWorkspaceRoot(), rootB)

    // Opening over an empty root keeps the closed root available.
    const dirC = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-prev-c-'))
    await setWorkspaceRoot(dirC)

    assert.equal(getPreviousWorkspaceRoot(), rootB)
  })

  it('builds a tree while skipping ignored entries', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-tree-'))
    await fs.writeFile(path.join(dir, 'a.txt'), 'a')
    await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'node_modules', 'x.js'),
      'x'
    )
    await fs.mkdir(path.join(dir, '.kryom'), { recursive: true })
    await fs.writeFile(path.join(dir, '.kryom', 'chat.json'), '{}')

    const root = await setWorkspaceRoot(dir)
    const tree = await buildTree(root)
    const names = tree.map((entry) => entry.name)

    assert.ok(names.includes('a.txt'))
    assert.ok(!names.includes('node_modules'))
    assert.ok(!names.includes('.kryom'))
  })

  it('skips unreadable directories instead of failing the tree', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-treemiss-'))
    await fs.writeFile(path.join(dir, 'a.txt'), 'a')

    const root = await setWorkspaceRoot(dir)

    assert.deepEqual(await buildTree(path.join(root, 'missing')), [])

    const tree = await buildTree(root)

    assert.ok(tree.map((entry) => entry.name).includes('a.txt'))
  })

  it('compares scope containment without touching the filesystem', () => {
    const scope = path.join(os.tmpdir(), 'kryom-scope')

    assert.equal(isInsideScope(scope, scope), true)
    assert.equal(isInsideScope(scope, path.join(scope, 'a', 'b.txt')), true)
    assert.equal(isInsideScope(scope, path.join(scope, '..', 'out.txt')), false)
    assert.equal(isInsideScope(scope, `${scope}-sibling`), false)
    assert.equal(isInsideScope(null, scope), false)
    assert.equal(isInsideScope(scope, null), false)
  })

  it('never descends into links that escape the tree', async () => {
    const outer = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-outer-'))
    await fs.writeFile(path.join(outer, 'secret.txt'), 'outside')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-link-'))
    await fs.writeFile(path.join(dir, 'a.txt'), 'a')

    let linkCreated = false

    try {
      await fs.symlink(outer, path.join(dir, 'escape'), 'junction')
      linkCreated = true
    } catch {
      // Link creation needs privileges on some machines; the scope
      // unit test above still pins the containment logic.
    }

    if (!linkCreated) {
      return
    }

    const root = await setWorkspaceRoot(dir)
    const tree = await buildTree(root)
    const names = tree.map((entry) => entry.name)

    assert.ok(names.includes('a.txt'))
    assert.ok(!names.includes('escape'))
  })
})
