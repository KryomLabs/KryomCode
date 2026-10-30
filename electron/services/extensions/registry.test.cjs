const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  installExtension,
  removeExtension,
  getExtension,
  listExtensions,
  setExtensionEnabled,
} = require('./registry.cjs')

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-extreg-'))
}

async function makePackage(dir, manifest = {}, files = {}) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, 'kryom-extension.json'),
    JSON.stringify({
      manifestVersion: 1,
      id: 'acme.hello',
      name: 'Hello',
      description: 'Says hello.',
      version: '1.0.0',
      publisher: 'acme',
      main: 'main.js',
      apiVersion: 1,
      permissions: ['workspace.read'],
      contributes: { commands: [{ id: 'acme.hello', title: 'Say hello' }] },
      ...manifest,
    })
  )
  await fs.writeFile(path.join(dir, 'main.js'), 'module.exports.activate = () => {}\n')

  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content)
  }

  return dir
}

describe('extension-registry', () => {
  it('installs a local package disabled by default', async () => {
    const base = await tempBase()
    const source = await makePackage(path.join(base, 'src'))

    const entry = await installExtension(source, { baseDir: base })

    assert.equal(entry.id, 'acme.hello')
    assert.equal(entry.source, 'local')
    assert.equal(entry.enabled, false)
    assert.ok(entry.path.includes('kryomcode-extensions'))

    const listed = await listExtensions({ baseDir: base })

    assert.equal(listed.extensions.length, 1)

    const fetched = await getExtension('acme.hello', { baseDir: base })

    assert.equal(fetched.version, '1.0.0')
  })

  it('rejects duplicates, bad manifests, and missing entries', async () => {
    const base = await tempBase()
    const source = await makePackage(path.join(base, 'src'))

    await installExtension(source, { baseDir: base })
    await assert.rejects(() => installExtension(source, { baseDir: base }), /already installed/)

    const bad = path.join(base, 'bad')

    await fs.mkdir(bad, { recursive: true })
    await assert.rejects(() => installExtension(bad, { baseDir: base }), /missing kryom-extension.json/)

    const noEntry = await makePackage(path.join(base, 'noentry'), { id: 'acme.noentry' })

    await fs.unlink(path.join(noEntry, 'main.js'))
    await assert.rejects(() => installExtension(noEntry, { baseDir: base }), /entry .* missing/)
  })

  it('rejects oversized and disallowed package contents', async () => {
    const base = await tempBase()
    const source = await makePackage(
      path.join(base, 'src'),
      { id: 'acme.big' },
      { 'run.exe': 'binary' }
    )

    await assert.rejects(() => installExtension(source, { baseDir: base }), /disallowed file type/)
  })

  it('links dev extensions without copying', async () => {
    const base = await tempBase()
    const source = await makePackage(path.join(base, 'dev'), { id: 'acme.dev' })

    const entry = await installExtension(source, { dev: true, baseDir: base })

    assert.equal(entry.source, 'dev')
    assert.equal(entry.path, source)
  })

  it('enables, disables, and uninstalls safely', async () => {
    const base = await tempBase()
    const source = await makePackage(path.join(base, 'src'))

    await installExtension(source, { baseDir: base })

    const enabled = await setExtensionEnabled('acme.hello', true, { baseDir: base })

    assert.equal(enabled.enabled, true)

    const removed = await removeExtension('acme.hello', { baseDir: base })

    assert.equal(removed.removed, true)

    const listed = await listExtensions({ baseDir: base })

    assert.equal(listed.extensions.length, 0)

    // The source directory is untouched; only our copy was removed.
    assert.ok((await fs.stat(path.join(source, 'main.js'))).isFile())

    await assert.rejects(() => getExtension('acme.hello', { baseDir: base }), /not installed/)
  })
})
