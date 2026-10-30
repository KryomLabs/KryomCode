// Support bundle: non-secret facts only, home-dir redaction, error
// ring bounds, atomic local writes. No env dumping, no key material.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  recordSupportError,
  readRecentErrors,
  collectSupportBundle,
  writeSupportBundle,
  redactHome,
} = require('./support-bundle.cjs')

describe('support-bundle', () => {
  it('redacts home directories from paths', () => {
    assert.equal(redactHome('/home/ada/project', '/home/ada'), '~/project')
    assert.equal(redactHome('C:\\Users\\Ada\\proj', 'C:\\Users\\Ada'), '~\\proj')
    assert.equal(redactHome('', '/home/ada'), '')
  })

  it('bounds and redacts the error ring', () => {
    for (let index = 0; index < 30; index += 1) {
      recordSupportError(`boom ${index} MODEL_API_KEY=hunter2-${index}`)
    }

    const errors = readRecentErrors()

    assert.equal(errors.length, 20)
    assert.ok(errors.every((entry) => !JSON.stringify(entry).includes('hunter2')))
    assert.ok(errors.every((entry) => entry.summary.includes('[redacted]')))
    assert.ok(errors[0].summary.includes('boom 10'))
  })

  it('collects versions, platform, and status booleans only', () => {
    const bundle = collectSupportBundle({
      getVersion: () => '1.2.3',
      versions: { electron: '45.0.0', chrome: '130.0', node: '22.1.0' },
      platform: 'win32',
      arch: 'x64',
      environment: { channel: 'stable', environment: 'production', packaged: true },
      providerStatus: {
        selectedProvider: 'meta',
        selectedModel: 'muse-spark-1.3',
        metaConfigured: true,
        metaAvailable: true,
      },
      featureStatus: {
        workspaceOpen: true,
        workspaceRoot: path.join(os.homedir(), 'proj'),
        indexIndexed: true,
        filesIndexed: 12,
        extensionsInstalled: 2,
        extensionsActive: 1,
        skillsTotal: 4,
        workflowsTotal: 5,
      },
    })

    assert.equal(bundle.kind, 'kryom-support-bundle')
    assert.equal(bundle.app.version, '1.2.3')
    assert.equal(bundle.app.environment, 'production')
    assert.equal(bundle.runtime.platform, 'win32')
    assert.equal(bundle.providers.selectedModel, 'muse-spark-1.3')
    assert.equal(bundle.providers.metaConfigured, true)
    assert.equal(bundle.features.filesIndexed, 12)
    assert.ok(bundle.features.workspaceRoot.startsWith('~'))
    assert.ok(!JSON.stringify(bundle).includes(os.homedir()))
    assert.ok(Array.isArray(bundle.recentErrors))
  })

  it('collects safely with every dependency missing', () => {
    const bundle = collectSupportBundle({
      getVersion: () => {
        throw new Error('no app')
      },
    })

    assert.equal(bundle.app.version, '0.0.0-unknown')
    assert.equal(bundle.providers.selectedProvider, 'unknown')
    assert.equal(bundle.features.workspaceOpen, false)
  })

  it('writes bundles atomically and refuses impostors', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-bundle-'))
    const bundle = collectSupportBundle({ getVersion: () => '9.9.9' })
    const target = path.join(dir, 'support.json')
    const written = await writeSupportBundle(target, bundle)

    assert.equal(written.path, target)
    assert.ok(written.bytes > 100)

    const parsed = JSON.parse(await fs.readFile(target, 'utf8'))

    assert.equal(parsed.app.version, '9.9.9')
    assert.ok(!(await fs.readdir(dir)).some((name) => name.includes('staging')))

    await assert.rejects(
      () => writeSupportBundle(path.join(dir, 'evil.json'), { kind: 'nope' }),
      /Only support bundles/
    )
  })
})
