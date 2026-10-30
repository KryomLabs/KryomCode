const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  PLATFORM_API_VERSION,
  validateManifest,
  compareVersions,
  checkHostCompatibility,
} = require('./manifest.cjs')

function validManifest(overrides = {}) {
  return {
    manifestVersion: 1,
    id: 'acme.hello',
    name: 'Hello',
    description: 'Says hello.',
    version: '1.2.3',
    publisher: 'acme',
    main: 'main.js',
    apiVersion: PLATFORM_API_VERSION,
    engines: { kryomcode: '1.0.0' },
    permissions: ['workspace.read'],
    optionalPermissions: ['git.read'],
    contributes: { commands: [{ id: 'acme.hello', title: 'Say hello' }] },
    dependencies: {},
    ...overrides,
  }
}

describe('extension-manifest', () => {
  it('accepts a valid manifest', () => {
    const manifest = validateManifest(validManifest())

    assert.equal(manifest.id, 'acme.hello')
    assert.equal(manifest.contributes.commands.length, 1)
    assert.deepEqual(manifest.permissions, ['workspace.read'])
  })

  it('rejects bad identity and versioning', () => {
    assert.throws(() => validateManifest(null), /object is required/)
    assert.throws(() => validateManifest(validManifest({ manifestVersion: 2 })), /manifestVersion/)
    assert.throws(() => validateManifest(validManifest({ id: 'no-dot' })), /publisher\.name/)
    assert.throws(() => validateManifest(validManifest({ version: '1.0' })), /semver/)
    assert.throws(() => validateManifest(validManifest({ apiVersion: 99 })), /Unsupported extension API/)
  })

  it('rejects path traversal and non-js entry points', () => {
    assert.throws(() => validateManifest(validManifest({ main: '../evil.js' })), /without traversal/)
    assert.throws(() => validateManifest(validManifest({ main: '/abs.js' })), /relative/)
    assert.throws(() => validateManifest(validManifest({ main: 'run.exe' })), /relative .js/)
  })

  it('rejects unknown, duplicate, and overlapping permissions', () => {
    assert.throws(
      () => validateManifest(validManifest({ permissions: ['everything'] })),
      /unknown permission/
    )
    assert.throws(
      () => validateManifest(validManifest({ permissions: ['git.read', 'git.read'] })),
      /duplicate permission/
    )
    assert.throws(
      () => validateManifest(validManifest({ optionalPermissions: ['workspace.read'] })),
      /both required and optional/
    )
  })

  it('rejects bad commands and dependencies', () => {
    assert.throws(
      () => validateManifest(validManifest({ contributes: { commands: [{ id: 'x', title: 't' }] } })),
      /bad id/
    )
    assert.throws(
      () => validateManifest(validManifest({ dependencies: { nope: '^1.0.0' } })),
      /bad dependency id/
    )
    assert.throws(
      () => validateManifest(validManifest({ engines: { kryomcode: 'soon' } })),
      /must be semver/
    )
  })

  it('compares versions and checks host compatibility', () => {
    assert.ok(compareVersions('1.2.3', '1.2.3') === 0)
    assert.ok(compareVersions('1.10.0', '1.2.0') > 0)
    assert.ok(compareVersions('0.9.9', '1.0.0') < 0)

    const manifest = validateManifest(validManifest())

    assert.equal(checkHostCompatibility(manifest, '1.5.0').compatible, true)
    assert.equal(checkHostCompatibility(manifest, '0.1.0').compatible, false)

    const unpinned = validateManifest(validManifest({ engines: undefined }))

    assert.equal(checkHostCompatibility(unpinned, '0.0.1').compatible, true)
  })
})
