const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  createFile,
  createDirectory,
  renamePath,
  deletePath,
  readFileWithMeta,
  writeFileIfUnchanged,
} = require('./directory.service.cjs')

async function openWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-dir-'))
  await setWorkspaceRoot(dir)

  return dir
}

describe('directory.service', () => {
  it('creates nested files and folders', async () => {
    const root = await openWorkspace()
    const file = path.join(root, 'a', 'b', 'note.txt')

    const result = await createFile(file, 'hello')

    assert.equal(result.success, true)
    assert.equal(await fs.readFile(file, 'utf8'), 'hello')

    const dirResult = await createDirectory(path.join(root, 'x', 'y'))

    assert.equal(dirResult.success, true)
    assert.equal(
      (await fs.stat(path.join(root, 'x', 'y'))).isDirectory(),
      true
    )
  })

  it('refuses to overwrite on create and rename', async () => {
    const root = await openWorkspace()
    await createFile(path.join(root, 'one.txt'), '1')
    await createFile(path.join(root, 'two.txt'), '2')

    await assert.rejects(
      () => createFile(path.join(root, 'one.txt'), 'x'),
      /already exists/
    )
    await assert.rejects(
      () => renamePath(path.join(root, 'one.txt'), path.join(root, 'two.txt')),
      /already exists/
    )
  })

  it('renames and deletes files and folders', async () => {
    const root = await openWorkspace()
    await createDirectory(path.join(root, 'd'))
    await createFile(path.join(root, 'd', 'f.txt'), 'f')

    const renamed = await renamePath(
      path.join(root, 'd', 'f.txt'),
      path.join(root, 'd', 'g.txt')
    )

    assert.equal(renamed.success, true)
    await assert.rejects(() => fs.stat(path.join(root, 'd', 'f.txt')))
    assert.equal(await fs.readFile(path.join(root, 'd', 'g.txt'), 'utf8'), 'f')

    const deleted = await deletePath(path.join(root, 'd'))

    assert.equal(deleted.success, true)
    await assert.rejects(() => fs.stat(path.join(root, 'd')))
  })

  it('rejects traversal, root targeting, and missing paths', async () => {
    const root = await openWorkspace()

    await assert.rejects(
      () => createFile(path.join(root, '..', 'evil.txt'), 'x'),
      /outside/
    )
    await assert.rejects(() => deletePath(root), /root/)
    await assert.rejects(
      () => deletePath(path.join(root, 'nope.txt')),
      /does not exist/
    )
    await createFile(path.join(root, 'a.txt'), 'a')
    await assert.rejects(
      () => renamePath(path.join(root, 'a.txt'), path.join(root, '..', 'b.txt')),
      /outside/
    )
  })

  it('detects conflicting writes via mtime', async () => {
    const root = await openWorkspace()
    const file = path.join(root, 'doc.txt')
    await createFile(file, 'v1')

    // Pin the "opened" timestamp to the past: back-to-back writes can
    // share one filesystem tick (measured 87/200 same-tick on this
    // volume), which would make the later write look unconflicted.
    const opened = new Date('2020-01-02T03:04:05.000Z')
    await fs.utimes(file, opened, opened)

    const meta = await readFileWithMeta(file)

    assert.equal(meta.content, 'v1')
    assert.ok(meta.mtimeMs < Date.now() - 1000)

    const saved = await writeFileIfUnchanged(file, 'v2', meta.mtimeMs)

    assert.equal(saved.success, true)

    // Exact pin: the renderer classifies write conflicts on this
    // wording (see docs/ERROR_TAXONOMY.md).
    await assert.rejects(
      () => writeFileIfUnchanged(file, 'v3', meta.mtimeMs),
      (error) => {
        assert.equal(
          error.message,
          'File changed on disk since it was opened. Reload before saving.'
        )

        return true
      }
    )
    assert.equal(await fs.readFile(file, 'utf8'), 'v2')
  })
})
