const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  PERMISSIONS,
  TRUST_LEVELS,
  validatePermission,
  validateSubject,
  checkPermission,
  requirePermission,
  grantPermission,
  revokePermission,
  listGrants,
  setTrustLevel,
  describePermissions,
} = require('./permission.service.cjs')

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-perm-'))
}

describe('permissions', () => {
  it('exposes a granular catalog with no wildcard', () => {
    const ids = Object.keys(PERMISSIONS)

    assert.ok(ids.length >= 12)
    assert.ok(!ids.some((id) => id.includes('*') || id.includes('admin')))
    assert.ok(ids.includes('workspace.read'))
    assert.ok(ids.includes('terminal.execute'))
    assert.deepEqual(TRUST_LEVELS, ['builtin', 'user', 'third-party', 'untrusted'])
    assert.equal(describePermissions().length, ids.length)
  })

  it('validates permissions, subjects, and trust strictly', () => {
    assert.equal(validatePermission('git.read'), 'git.read')
    assert.equal(validateSubject('extension:acme.hello'), 'extension:acme.hello')
    assert.throws(() => validatePermission('everything'), /Unknown permission/)
    assert.throws(() => validateSubject('root'), /Invalid permission subject/)
    assert.throws(() => validateSubject('extension:../escape'), /Invalid permission subject/)
  })

  it('denies by default and grants explicitly', async () => {
    const base = await tempBase()
    const subject = 'extension:acme.hello'

    const denied = await checkPermission(subject, 'workspace.read', base)

    assert.equal(denied.granted, false)
    assert.equal(denied.trust, 'untrusted')

    await assert.rejects(
      () => requirePermission(subject, 'workspace.read', base),
      /Permission denied/
    )

    const granted = await grantPermission(subject, 'workspace.read', base)

    assert.equal(granted.granted, true)

    const required = await requirePermission(subject, 'workspace.read', base)

    assert.equal(required.granted, true)
  })

  it('revokes single permissions and whole subjects', async () => {
    const base = await tempBase()
    const subject = 'skill:user:greet'

    await grantPermission(subject, 'ai.provider', base)
    await grantPermission(subject, 'workspace.read', base)

    const one = await revokePermission(subject, 'ai.provider', base)

    assert.deepEqual(one.revoked, ['ai.provider'])
    assert.equal((await checkPermission(subject, 'ai.provider', base)).granted, false)
    assert.equal((await checkPermission(subject, 'workspace.read', base)).granted, true)

    const all = await revokePermission(subject, null, base)

    assert.deepEqual(all.revoked, ['workspace.read'])
    assert.equal((await checkPermission(subject, 'workspace.read', base)).granted, false)
  })

  it('lists grants and tracks trust without auto-granting', async () => {
    const base = await tempBase()
    const subject = 'extension:acme.hello'

    await setTrustLevel(subject, 'user', base)
    await grantPermission(subject, 'git.read', base)

    const listed = await listGrants(null, base)

    assert.equal(listed.grants.length, 1)
    assert.equal(listed.grants[0].trust, 'user')
    assert.equal(listed.grants[0].permissions[0].permission, 'git.read')

    // Trust alone grants nothing.
    await setTrustLevel('extension:acme.other', 'user', base)
    assert.equal(
      (await checkPermission('extension:acme.other', 'git.read', base)).granted,
      false
    )
  })

  it('sanitizes corrupt stores instead of crashing', async () => {
    const base = await tempBase()

    await fs.writeFile(path.join(base, 'kryomcode-permissions.json'), '{corrupt')

    const listed = await listGrants(null, base)

    assert.deepEqual(listed.grants, [])
  })
})
