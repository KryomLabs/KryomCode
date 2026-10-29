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
  assertExternalUrl,
} = require('./validate-input.cjs')
const { createTrustedSender } = require('./trusted-sender.cjs')
const {
  APP_ENTRY_URL,
  isAllowedMainFrameUrl,
  isDevAppUrl,
  isProdEntryUrl,
} = require('./renderer-urls.cjs')
const {
  buildDevelopmentCsp,
  buildProductionCsp,
} = require('./content-security-policy.cjs')
const {
  createAppProtocolHandler,
} = require('./protocol-handler.cjs')
const {
  assertSafeSegments,
  ensureStorageDir,
  listStorageFiles,
  readStorageFile,
  resolveStoragePath,
  writeStorageFile,
} = require('./storage-path.cjs')

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

  it('opens only safe external URLs', () => {
    assert.equal(
      assertExternalUrl('https://arxiv.org/abs/1234.5678', 'url'),
      'https://arxiv.org/abs/1234.5678'
    )
    assert.equal(
      assertExternalUrl('http://example.com/paper', 'url'),
      'http://example.com/paper'
    )
    assert.throws(
      () => assertExternalUrl('javascript:alert(1)', 'url'),
      /only http/
    )
    assert.throws(
      () => assertExternalUrl('file:///etc/passwd', 'url'),
      /only http/
    )
    assert.throws(
      () => assertExternalUrl('kryom://open?x=1', 'url'),
      /only http/
    )
    assert.throws(
      () => assertExternalUrl('https://user:pass@example.com/', 'url'),
      /credentials/
    )
    assert.throws(
      () => assertExternalUrl('not a url', 'url'),
      /malformed/
    )
    assert.throws(() => assertExternalUrl('', 'url'), /Invalid url/)
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

  it('allows only the exact configured dev origin for the renderer', () => {
    assert.equal(isDevAppUrl('http://127.0.0.1:5173/'), true)
    assert.equal(isDevAppUrl('http://127.0.0.1:5173/src/main.tsx'), true)
    assert.equal(isDevAppUrl('http://127.0.0.1:5173/@vite/client'), true)

    // Userinfo attack: the real host is attacker.example, and the
    // old prefix check would have allowed it.
    assert.equal(
      isDevAppUrl('http://127.0.0.1:5173@attacker.example/'),
      false
    )
    assert.equal(isDevAppUrl('http://user:pass@127.0.0.1:5173/'), false)

    // Sibling hosts, ports, and schemes.
    assert.equal(isDevAppUrl('http://localhost:5173/'), false)
    assert.equal(isDevAppUrl('http://127.0.0.1:5174/'), false)
    assert.equal(isDevAppUrl('http://127.0.0.1:5173.evil.example/'), false)
    assert.equal(isDevAppUrl('https://127.0.0.1:5173/'), false)
    assert.equal(isDevAppUrl('file:///C:/app/dist/index.html'), false)

    // Malformed and non-string input.
    assert.equal(isDevAppUrl('not a url'), false)
    assert.equal(isDevAppUrl(''), false)
    assert.equal(isDevAppUrl(null), false)
    assert.equal(isDevAppUrl(undefined), false)
  })

  it('allows only the packaged entry point in production', () => {
    const { pathToFileURL } = require('node:url')

    assert.equal(isProdEntryUrl(APP_ENTRY_URL), true)
    assert.equal(isProdEntryUrl(`${APP_ENTRY_URL}#/settings`), true)
    assert.equal(isProdEntryUrl(`${APP_ENTRY_URL}?v=1`), true)

    // Other bundled paths, hosts, ports, and credentials are not
    // the entry point.
    assert.equal(isProdEntryUrl('kryom://app/assets/index-abc.js'), false)
    assert.equal(isProdEntryUrl('kryom://app/'), false)
    assert.equal(isProdEntryUrl('kryom://evil/index.html'), false)
    assert.equal(isProdEntryUrl('kryom://app:80/index.html'), false)
    assert.equal(isProdEntryUrl('kryom://user@app/index.html'), false)

    // No file: URLs — not even the genuine bundle path on disk.
    assert.equal(
      isProdEntryUrl('file:///opt/kryomcode/dist/index.html'),
      false
    )
    assert.equal(
      isProdEntryUrl(
        pathToFileURL(
          path.join(__dirname, '..', '..', 'dist', 'index.html')
        ).toString()
      ),
      false
    )
    assert.equal(
      isProdEntryUrl('https://cdn.jsdelivr.net/npm/x/y.js'),
      false
    )
    assert.equal(isProdEntryUrl('not a url'), false)
  })

  it('gates main-frame navigation on the packaged flag', () => {
    assert.equal(
      isAllowedMainFrameUrl('http://127.0.0.1:5173/', { packaged: false }),
      true
    )
    // Dev fallback to built files keeps working.
    assert.equal(
      isAllowedMainFrameUrl(APP_ENTRY_URL, { packaged: false }),
      true
    )
    assert.equal(
      isAllowedMainFrameUrl('http://127.0.0.1:5173@attacker.example/', {
        packaged: false,
      }),
      false
    )
    assert.equal(
      isAllowedMainFrameUrl(APP_ENTRY_URL, { packaged: true }),
      true
    )
    assert.equal(
      isAllowedMainFrameUrl('http://127.0.0.1:5173/', { packaged: true }),
      false
    )
    assert.equal(
      isAllowedMainFrameUrl('file:///etc/passwd', { packaged: true }),
      false
    )
  })

  it('rejects IPC from frames outside the app main frame', () => {
    const webContents = {}
    const check = createTrustedSender(
      () => ({ isDestroyed: () => false, webContents }),
      {
        isTrustedAppUrl: (url) =>
          isAllowedMainFrameUrl(url, { packaged: true }),
      }
    )
    const mainFrame = (url) => ({ url, parent: null })

    assert.equal(
      check({ sender: webContents, senderFrame: mainFrame(APP_ENTRY_URL) }),
      true
    )

    // Untrusted frame riding a known webContents.
    assert.equal(
      check({
        sender: webContents,
        senderFrame: mainFrame('http://127.0.0.1:5173@attacker.example/'),
      }),
      false
    )
    assert.equal(
      check({
        sender: webContents,
        senderFrame: mainFrame('file:///tmp/evil.html'),
      }),
      false
    )

    // Subframe, even on the app origin.
    assert.equal(
      check({
        sender: webContents,
        senderFrame: { url: APP_ENTRY_URL, parent: {} },
      }),
      false
    )

    // No frame at all: not a renderer main-frame call.
    assert.equal(check({ sender: webContents }), false)

    // Unknown sender with a spoofed frame URL.
    assert.equal(
      check({ sender: {}, senderFrame: mainFrame(APP_ENTRY_URL) }),
      false
    )
  })

  it('serves a restrictive production CSP with only required resources', () => {
    const csp = buildProductionCsp()
    const directives = Object.fromEntries(
      csp.split('; ').map((directive) => {
        const [name, ...sources] = directive.split(' ')

        return [name, sources]
      })
    )

    assert.deepEqual(directives['default-src'], ["'none'"])
    assert.deepEqual(directives['frame-ancestors'], ["'none'"])
    assert.deepEqual(directives['frame-src'], ["'none'"])
    assert.deepEqual(directives['object-src'], ["'none'"])
    assert.deepEqual(directives['form-action'], ["'none'"])
    assert.deepEqual(directives['base-uri'], ["'self'"])
    assert.deepEqual(directives['connect-src'], ["'self'"])
    assert.deepEqual(directives['script-src'], ["'self'"])
    // The editor is bundled locally: no remote host may appear in any
    // production directive, so a CDN regression fails here.
    assert.ok(
      !csp.includes('https://'),
      'production CSP must not allow remote hosts'
    )
    assert.ok(!csp.includes('*'), 'production CSP must not wildcard')
    assert.ok(!csp.includes('unsafe-eval'), 'production CSP must not eval')
    assert.ok(
      !directives['script-src'].includes("'unsafe-inline'"),
      'production scripts must not be inline'
    )
  })

  it('keeps the development CSP scoped to HMR needs', () => {
    const csp = buildDevelopmentCsp()

    assert.ok(csp.includes("connect-src 'self' ws://127.0.0.1:5173"))
    assert.ok(csp.includes("script-src 'self' 'unsafe-inline'"))
    assert.ok(
      !csp.includes('https://'),
      'development CSP must not allow remote hosts'
    )
    assert.ok(!csp.includes('unsafe-eval'))
    assert.ok(!csp.includes('*'))
  })

  it('serves only files inside the bundled dist folder', async () => {
    const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-dist-'))
    await fs.mkdir(path.join(dist, 'assets'), { recursive: true })
    await fs.writeFile(path.join(dist, 'index.html'), '<html></html>')
    await fs.writeFile(path.join(dist, 'assets', 'app.js'), 'console.log(1)')

    // Sibling outside dist: a naive join would resolve escapes here.
    const outsideName = `kryom-outside-${Date.now()}.txt`
    await fs.writeFile(
      path.join(path.dirname(dist), outsideName),
      'secret'
    )

    const csp = buildProductionCsp()
    const handle = createAppProtocolHandler({
      distDir: dist,
      contentSecurityPolicy: csp,
    })
    const get = (url) => handle({ method: 'GET', url })

    const entry = await get('kryom://app/index.html')

    assert.equal(entry.status, 200)
    assert.match(entry.headers.get('content-type'), /text\/html/)
    assert.equal(entry.headers.get('content-security-policy'), csp)
    assert.equal(entry.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(await entry.text(), '<html></html>')

    const asset = await get('kryom://app/assets/app.js')

    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type'), /text\/javascript/)

    assert.equal((await get('kryom://app/')).status, 200)

    // Plain dot segments never reach the handler: the URL parser
    // normalizes kryom://app/../index.html to /index.html first, so
    // serving the entry here is correct. Encoded variants below are
    // what actually exercise the traversal guard.
    assert.equal((await get('kryom://app/../index.html')).status, 200)
    assert.equal(
      (await get(`kryom://app/..%2F${outsideName}`)).status,
      404
    )
    assert.equal(
      (await get(`kryom://app/..%5C..%5C${outsideName}`)).status,
      404
    )
    assert.equal(
      (await get('kryom://app/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd')).status,
      404
    )

    // Wrong host, credentials, schemes, methods, and missing files.
    assert.equal((await get('kryom://evil/index.html')).status, 404)
    assert.equal((await get('kryom://u@app/index.html')).status, 404)
    assert.equal(
      (await get('file:///C:/Windows/win.ini')).status,
      404
    )
    assert.equal((await get('kryom://app/missing.js')).status, 404)
    assert.equal(
      (await handle({ method: 'POST', url: 'kryom://app/index.html' }))
        .status,
      405
    )
    assert.throws(
      () =>
        createAppProtocolHandler({
          distDir: dist,
          contentSecurityPolicy: '',
        }),
      /requires a CSP/
    )
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

  it('rejects traversal segments in storage paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-store-'))

    for (const segments of [
      ['..'],
      ['.', 'x'],
      ['', 'x'],
      ['a', '..', '..'],
      ['a/b'],
      ['a\\b'],
      ['/abs'],
      [],
      null,
    ]) {
      await assert.rejects(
        () => resolveStoragePath(root, segments),
        /Invalid storage/
      )
    }

    assert.throws(() => assertSafeSegments(['..']), /Invalid storage/)
    assert.throws(() => assertSafeSegments([]), /Invalid storage/)
    await assert.rejects(
      () => resolveStoragePath('relative-root', ['.kryom']),
      /Invalid storage root/
    )
  })

  it('keeps storage reads and writes inside the root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-store-'))

    const missing = await readStorageFile(root, ['.kryom', 'chat.json'])

    assert.deepEqual(missing, { found: false, data: null })

    await writeStorageFile(root, ['.kryom', 'chat.json'], '{"ok":true}')

    const { path: file, exists } = await resolveStoragePath(root, [
      '.kryom',
      'chat.json',
    ])

    assert.equal(exists, true)
    assert.equal(
      await fs.readFile(path.join(root, '.kryom', 'chat.json'), 'utf8'),
      '{"ok":true}'
    )

    const found = await readStorageFile(root, ['.kryom', 'chat.json'])

    assert.deepEqual(found, { found: true, data: '{"ok":true}' })
    assert.ok(file.startsWith(await fs.realpath(root)))

    const files = await listStorageFiles(root, ['.kryom'])

    assert.deepEqual(
      files.map((entry) => entry.name),
      ['chat.json']
    )
  })

  it('rejects symlinks anywhere in the storage chain', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-store-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-store-out-'))

    // Link at an intermediate level. A real symlink (not a junction)
    // so the lstat layer is what fires.
    try {
      await fs.symlink(outside, path.join(root, '.kryom'), 'dir')
    } catch (error) {
      t.skip(`symlink creation unavailable: ${error.message}`)
      return
    }

    await assert.rejects(
      () => resolveStoragePath(root, ['.kryom', 'chat.json']),
      /Symbolic links/
    )
    await assert.rejects(
      () => writeStorageFile(root, ['.kryom', 'chat.json'], 'x'),
      /Symbolic links/
    )
    await assert.rejects(
      () => readStorageFile(root, ['.kryom', 'chat.json']),
      /Symbolic links/
    )
    await assert.rejects(
      () => ensureStorageDir(root, ['.kryom']),
      /Symbolic links/
    )

    assert.deepEqual(await fs.readdir(outside), [])
  })

  it('rejects planted final-component links on read, replaces them on write', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-store-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-store-out-'))

    await fs.mkdir(path.join(root, '.kryom'), { recursive: true })

    const secret = path.join(outside, 'secret.txt')

    await fs.writeFile(secret, 'outside')

    // Final-component symlink pointing outside.
    try {
      await fs.symlink(secret, path.join(root, '.kryom', 'chat.json'))
    } catch (error) {
      t.skip(`symlink creation unavailable: ${error.message}`)
      return
    }

    // Reads fail loudly: following the link would leak outside data.
    await assert.rejects(
      () => readStorageFile(root, ['.kryom', 'chat.json']),
      /Symbolic links/
    )

    // Writes replace the link itself instead of following it.
    await writeStorageFile(root, ['.kryom', 'chat.json'], '{"ok":true}')

    assert.equal(await fs.readFile(secret, 'utf8'), 'outside')

    const stat = await fs.lstat(path.join(root, '.kryom', 'chat.json'))

    assert.equal(stat.isSymbolicLink(), false)
    assert.equal(
      await fs.readFile(path.join(root, '.kryom', 'chat.json'), 'utf8'),
      '{"ok":true}'
    )
  })

  it('rejects Windows junctions escaping the storage root', async (t) => {
    if (process.platform !== 'win32') {
      t.skip('Windows-only junctions')
      return
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-store-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-store-out-'))

    try {
      await fs.symlink(path.join(outside), path.join(root, '.kryom'), 'junction')
    } catch (error) {
      t.skip(`junction creation unavailable: ${error.message}`)
      return
    }

    // Either layer may fire depending on how the platform's
    // lstat reports junctions (as symlinks here, as directories on
    // other runtimes, where the realpath comparison catches them).
    // The property under test is the same: no escape, nothing leaks.
    await assert.rejects(
      () => resolveStoragePath(root, ['.kryom', 'chat.json']),
      /Symbolic links|escapes/
    )
    await assert.rejects(
      () => writeStorageFile(root, ['.kryom', 'chat.json'], 'x'),
      /Symbolic links|escapes/
    )

    assert.deepEqual(await fs.readdir(outside), [])
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

  it('ships no vulnerable dompurify transitive copy', () => {
    // monaco-editor (a @monaco-editor/react peer) pulls dompurify;
    // versions through 3.4.16 carry critical DOM-XSS advisories
    // (GHSA-p98j-92pf-mc4p and siblings). The tree must resolve at or
    // above the patched floor. Absent copy: nothing to check.
    let installed = null

    try {
      installed = require('../../node_modules/dompurify/package.json').version
    } catch (error) {
      if (error && error.code === 'MODULE_NOT_FOUND') {
        return
      }

      throw error
    }

    const [major, minor, patch] = String(installed).split('.').map(Number)
    const patched =
      major > 3 ||
      (major === 3 && (minor > 4 || (minor === 4 && patch >= 17)))

    assert.ok(
      patched,
      `dompurify ${installed} is below the patched 3.4.17 floor`
    )
  })
})
