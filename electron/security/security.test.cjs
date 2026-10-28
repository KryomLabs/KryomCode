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

  it('trusts any live app window sender in multi-window mode', () => {
    const first = {}
    const second = {}
    const multi = createTrustedSender(() => [
      { isDestroyed: () => false, webContents: first },
      { isDestroyed: () => false, webContents: second },
      { isDestroyed: () => true, webContents: {} },
    ])

    assert.equal(multi({ sender: first }), true)
    assert.equal(multi({ sender: second }), true)
    assert.equal(multi({ sender: {} }), false)
    assert.equal(multi(null), false)
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

  it('accepts non-canonical aliases that resolve inside the workspace', async () => {
    // Regression: on Windows CI os.tmpdir() can return an 8.3 short-name
    // path while setWorkspaceRoot stores the long canonical form. A
    // junction alias reproduces the same shape (string-outside,
    // canonical-inside) on every platform without needing 8.3 names.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-secalias-'))
    await fs.writeFile(path.join(root, 'ok.txt'), 'ok')
    const canonicalRoot = await setWorkspaceRoot(root)

    const aliasBase = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-secaliasbase-'))
    const alias = path.join(aliasBase, 'alias-ws')
    await fs.symlink(root, alias, 'junction')

    const viaAlias = path.join(alias, 'ok.txt')
    const resolved = await resolveWorkspacePath(viaAlias)

    assert.equal(resolved.exists, true)
    assert.equal(resolved.path, path.join(canonicalRoot, 'ok.txt'))

    // A missing file whose existing ancestor IS the alias still reports
    // the symlink itself: ancestor links are never followed for create
    // flows. Windows 8.3 short names differ (they are not symlinks), so
    // missing short-name paths canonicalize and succeed; covered below.
    await assert.rejects(
      () => resolveWorkspacePath(path.join(alias, 'missing.txt'), {
        allowMissing: true,
      }),
      /Symbolic links are not followed/
    )
  })

  it('accepts Windows 8.3 short-name paths for existing and missing files', async (t) => {
    if (process.platform !== 'win32') {
      t.skip('Windows-only 8.3 short names')
      return
    }

    const { execSync } = require('node:child_process')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-secshort-'))
    await fs.writeFile(path.join(root, 'ok.txt'), 'ok')
    const canonicalRoot = await setWorkspaceRoot(root)

    let shortRoot = null
    try {
      shortRoot = execSync(
        `cmd /c for %I in ("${root}") do @echo %~sI`,
        { encoding: 'utf8' }
      ).trim()
    } catch {
      t.skip('short names unavailable')
      return
    }

    if (!shortRoot || shortRoot === root) {
      t.skip('short names unavailable')
      return
    }

    const existing = await resolveWorkspacePath(path.join(shortRoot, 'ok.txt'))
    assert.equal(existing.exists, true)
    assert.equal(existing.path, path.join(canonicalRoot, 'ok.txt'))

    const missing = await resolveWorkspacePath(
      path.join(shortRoot, 'missing.txt'),
      { allowMissing: true }
    )
    assert.equal(missing.exists, false)
    assert.equal(missing.path, path.join(canonicalRoot, 'missing.txt'))
  })

  it('accepts Windows case and separator variants inside the workspace', async (t) => {
    if (process.platform !== 'win32') {
      t.skip('Windows-only path variants')
      return
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-seccase-'))
    await fs.writeFile(path.join(root, 'ok.txt'), 'ok')
    const canonicalRoot = await setWorkspaceRoot(root)
    const canonicalFile = path.join(canonicalRoot, 'ok.txt')

    const upper = await resolveWorkspacePath(canonicalFile.toUpperCase())
    assert.equal(upper.exists, true)
    assert.equal(upper.path, canonicalFile)

    const forward = await resolveWorkspacePath(
      canonicalFile.replace(/\\/g, '/')
    )
    assert.equal(forward.exists, true)
    assert.equal(forward.path, canonicalFile)
  })

  it('rejects outside paths, other volumes, and symlink escapes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-secout-'))
    await fs.writeFile(path.join(root, 'ok.txt'), 'ok')
    await setWorkspaceRoot(root)
    const canonicalRoot = await fs.realpath(root)

    // Same-volume absolute outside.
    await assert.rejects(
      () => resolveWorkspacePath(path.join(path.dirname(canonicalRoot), 'evil-outside.txt')),
      /outside/
    )

    // Traversal with redundant segments.
    await assert.rejects(
      () => resolveWorkspacePath(
        path.join(canonicalRoot, 'sub', '..', '..', 'evil.txt')
      ),
      /outside/
    )

    if (process.platform === 'win32') {
      // A different volume can never canonicalize inside.
      const otherRoot = path.parse(canonicalRoot).root.toUpperCase().startsWith('C:')
        ? 'D:\\definitely-outside-kryom\\evil.txt'
        : 'C:\\definitely-outside-kryom\\evil.txt'
      await assert.rejects(
        () => resolveWorkspacePath(otherRoot),
        /outside/
      )
    }

    // A final-component symlink is never followed, even when it
    // points inside the workspace.
    const link = path.join(canonicalRoot, 'link.txt')
    try {
      await fs.symlink(path.join(canonicalRoot, 'ok.txt'), link, 'file')
    } catch {
      return
    }

    await assert.rejects(
      () => resolveWorkspacePath(link),
      /Symbolic links are not followed/
    )
  })
})
