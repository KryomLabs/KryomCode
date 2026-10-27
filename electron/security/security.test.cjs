const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../services/workspace/workspace.service.cjs')
const {
  resolveWorkspacePath,
} = require('./validate-path.cjs')
const {
  assertNonEmptyString,
  assertStringArray,
  assertEnum,
  assertPlainObject,
} = require('./validate-input.cjs')
const { createTrustedSender } = require('./trusted-sender.cjs')

describe('security guards', () => {
  it('requires an open workspace before resolving paths', async () => {
    await assert.rejects(
      () => resolveWorkspacePath('C:\\anywhere\\file.txt'),
      /Open a project folder/
    )
  })

  it('resolves inside paths and rejects traversal', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-sec-'))
    const file = path.join(root, 'ok.txt')
    await fs.writeFile(file, 'ok')
    await setWorkspaceRoot(root)

    const inside = await resolveWorkspacePath(file)

    assert.equal(inside.exists, true)

    await assert.rejects(
      () => resolveWorkspacePath(path.join(root, '..', 'evil.txt')),
      /outside/
    )
    await assert.rejects(
      () => resolveWorkspacePath(path.join(root, 'missing.txt')),
      /does not exist/
    )
    await assert.rejects(() => resolveWorkspacePath(root), /root/)

    const missing = await resolveWorkspacePath(
      path.join(root, 'missing.txt'),
      { allowMissing: true }
    )

    assert.equal(missing.exists, false)
  })

  it('validates handler input shapes', () => {
    assert.equal(assertNonEmptyString('x', 'name'), 'x')
    assert.throws(() => assertNonEmptyString('', 'name'), /Invalid name/)
    assert.throws(() => assertNonEmptyString('x'.repeat(2001), 'name'), /Invalid name/)
    assert.deepEqual(assertStringArray(['a'], 'list'), ['a'])
    assert.throws(() => assertStringArray('a', 'list'), /Invalid list/)
    assert.equal(assertEnum('a', 'choice', ['a', 'b']), 'a')
    assert.throws(() => assertEnum('z', 'choice', ['a']), /Invalid choice/)
    assert.throws(() => assertPlainObject([], 'payload'), /Invalid payload/)
  })

  it('trusts only the live main window sender', () => {
    const webContents = {}
    const event = { sender: webContents }
    const trusted = createTrustedSender(() => ({
      isDestroyed: () => false,
      webContents,
    }))
    const destroyed = createTrustedSender(() => ({
      isDestroyed: () => true,
      webContents,
    }))
    const gone = createTrustedSender(() => null)

    assert.equal(trusted(event), true)
    assert.equal(trusted({ sender: {} }), false)
    assert.equal(destroyed(event), false)
    assert.equal(gone(event), false)
  })

  it('resolves relative paths against the workspace root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-secrel-'))
    await fs.writeFile(path.join(root, 'rel.txt'), 'r')
    await setWorkspaceRoot(root)

    const resolved = await resolveWorkspacePath('rel.txt')

    assert.equal(resolved.exists, true)
    assert.equal(resolved.path, path.join(await fs.realpath(root), 'rel.txt'))

    await assert.rejects(
      () => resolveWorkspacePath('../escape.txt'),
      /outside/
    )
  })
})
