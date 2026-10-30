const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  satisfiesRange,
  install,
  enable,
  disable,
  activate,
  deactivate,
  uninstall,
  status,
  list,
  runCommand,
  recoverAtStartup,
} = require('./lifecycle.cjs')

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-extlife-'))
}

async function makePackage(dir, { id = 'acme.hello', version = '1.0.0', extra = {}, code } = {}) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, 'kryom-extension.json'),
    JSON.stringify({
      manifestVersion: 1,
      id,
      name: 'Hello',
      description: 'test',
      version,
      publisher: 'acme',
      main: 'main.js',
      apiVersion: 1,
      permissions: [],
      contributes: { commands: [{ id: `${id}.run`, title: 'Run' }] },
      ...extra,
    })
  )
  await fs.writeFile(
    path.join(dir, 'main.js'),
    code ||
      `module.exports.activate = (kryom) => {
        kryom.commands.registerCommand('${id}.run', () => 'ran')
      }`
  )

  return dir
}

describe('extension-lifecycle', () => {
  it('satisfies exact and caret ranges, rejects the rest', () => {
    assert.equal(satisfiesRange('1.2.3', '1.2.3'), true)
    assert.equal(satisfiesRange('1.2.4', '1.2.3'), false)
    assert.equal(satisfiesRange('1.5.0', '^1.2.0'), true)
    assert.equal(satisfiesRange('2.0.0', '^1.2.0'), false)
    assert.throws(() => satisfiesRange('1.0.0', '>=1.0.0'), /Unsupported version range/)
  })

  it('runs the full lifecycle: install, enable, activate, command, deactivate, uninstall', async () => {
    const base = await tempBase()
    const source = await makePackage(path.join(base, 'src'))

    const installed = await install(source, { baseDir: base })

    assert.equal(installed.enabled, false)

    await assert.rejects(() => activate('acme.hello', { baseDir: base }), /disabled/)

    await enable('acme.hello', { baseDir: base })

    const activated = await activate('acme.hello', { baseDir: base, hostVersion: '9.9.9' })

    assert.equal(activated.active, true)
    assert.equal(await runCommand('acme.hello', 'acme.hello.run'), 'ran')

    const current = await status('acme.hello', { baseDir: base })

    assert.equal(current.active, true)
    assert.equal(current.commands.length, 1)

    await deactivate('acme.hello', { baseDir: base })
    assert.equal((await status('acme.hello', { baseDir: base })).active, false)

    await disable('acme.hello', { baseDir: base })
    await uninstall('acme.hello', { baseDir: base })

    const listed = await list({ baseDir: base })

    assert.equal(listed.extensions.length, 0)
  })

  it('detects corrupt installations and disables them', async () => {
    const base = await tempBase()
    const source = await makePackage(path.join(base, 'src'))

    await install(source, { baseDir: base })
    await enable('acme.hello', { baseDir: base })

    const installedManifest = path.join(
      base,
      'kryomcode-extensions',
      'installed',
      'acme.hello',
      '1.0.0',
      'kryom-extension.json'
    )

    await fs.writeFile(installedManifest, '{corrupt')

    await assert.rejects(() => activate('acme.hello', { baseDir: base }), /corrupt/)

    const current = await status('acme.hello', { baseDir: base })

    assert.equal(current.enabled, false)
    assert.ok(current.lastError.includes('Corrupt'))
  })

  it('enforces dependencies and blocks dependent uninstalls', async () => {
    const base = await tempBase()

    await install(await makePackage(path.join(base, 'dep'), { id: 'acme.dep' }), { baseDir: base })
    await install(
      await makePackage(path.join(base, 'app'), {
        id: 'acme.app',
        extra: { dependencies: { 'acme.dep': '^1.0.0' } },
      }),
      { baseDir: base }
    )

    // Dependency disabled: enable fails.
    await assert.rejects(() => enable('acme.app', { baseDir: base }), /disabled/)

    await enable('acme.dep', { baseDir: base })
    await enable('acme.app', { baseDir: base })

    await assert.rejects(() => uninstall('acme.dep', { baseDir: base }), /depends on it/)

    await uninstall('acme.app', { baseDir: base })
    await uninstall('acme.dep', { baseDir: base })
  })

  it('records activation failures without crashing', async () => {
    const base = await tempBase()
    const source = await makePackage(path.join(base, 'src'), {
      code: `throw new Error('kaboom')`,
    })

    await install(source, { baseDir: base })
    await enable('acme.hello', { baseDir: base })

    await assert.rejects(() => activate('acme.hello', { baseDir: base }), /kaboom/)

    const current = await status('acme.hello', { baseDir: base })

    assert.ok(current.lastError.includes('kaboom'))
  })

  it('recovers at startup without throwing', async () => {
    const base = await tempBase()

    await install(await makePackage(path.join(base, 'good')), { baseDir: base })
    await enable('acme.hello', { baseDir: base })

    const first = await recoverAtStartup({ baseDir: base, hostVersion: '9.9.9' })

    assert.deepEqual(first.recovered, ['acme.hello'])
    assert.deepEqual(first.disabled, [])

    const installedManifest = path.join(
      base,
      'kryomcode-extensions',
      'installed',
      'acme.hello',
      '1.0.0',
      'kryom-extension.json'
    )

    await fs.writeFile(installedManifest, '{corrupt')

    const second = await recoverAtStartup({ baseDir: base, hostVersion: '9.9.9' })

    assert.equal(second.disabled.length, 1)
    assert.equal(second.disabled[0].id, 'acme.hello')
  })
})
