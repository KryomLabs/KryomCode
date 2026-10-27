const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
  getWorkspaceRoot,
  isInsideWorkspace,
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

  it('builds a tree while skipping ignored entries', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-tree-'))
    await fs.writeFile(path.join(dir, 'a.txt'), 'a')
    await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'node_modules', 'x.js'),
      'x'
    )

    const root = await setWorkspaceRoot(dir)
    const tree = await buildTree(root)
    const names = tree.map((entry) => entry.name)

    assert.ok(names.includes('a.txt'))
    assert.ok(!names.includes('node_modules'))
  })
})
