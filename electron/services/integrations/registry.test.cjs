const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  describeAdapter,
  listAdapters,
  normalizeIntegrationError,
  recordConnection,
  clearConnection,
  connectionState,
  registerBuiltins,
} = require('./registry.cjs')

afterEach(() => {
  unregisterAdapter('custom')
})

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-intreg-'))
}

describe('integration-registry', () => {
  it('registers builtins with the tokenless GitHub adapter', () => {
    const adapters = registerBuiltins()
    const github = adapters.find((entry) => entry.id === 'github')

    assert.ok(github)
    assert.equal(github.auth.kind, 'none')
    assert.ok(github.capabilities.includes('history'))
    assert.ok(github.methods.includes('status'))
  })

  it('validates adapters and rejects duplicates', () => {
    registerBuiltins()

    assert.throws(() => registerAdapter(null), /object is required/)
    assert.throws(
      () => registerAdapter({ id: 'Bad!', displayName: 'x', auth: { kind: 'none' }, capabilities: [], status: async () => ({}), disconnect: async () => ({}) }),
      /id must be/
    )
    assert.throws(
      () =>
        registerAdapter({
          id: 'custom',
          displayName: 'Custom',
          auth: { kind: 'token-env', secretEnv: 'EVIL' },
          capabilities: [],
          status: async () => ({}),
          disconnect: async () => ({}),
        }),
      /allowlisted secret/
    )
    assert.throws(
      () =>
        registerAdapter({
          id: 'github',
          displayName: 'Dup',
          auth: { kind: 'none' },
          capabilities: [],
          status: async () => ({}),
          disconnect: async () => ({}),
        }),
      /already registered/
    )
  })

  it('tracks connection state without secrets', async () => {
    const base = await tempBase()

    const empty = await connectionState('github', base)

    assert.equal(empty.state, 'disconnected')

    await recordConnection('github', { state: 'connected', account: 'o/r', detail: 'ok' }, base)

    const stored = await connectionState('github', base)

    assert.equal(stored.state, 'connected')
    assert.equal(stored.account, 'o/r')

    const raw = await fs.readFile(path.join(base, 'kryomcode-integrations.json'), 'utf8')

    assert.ok(!raw.includes('token'))

    await clearConnection('github', base)
    assert.equal((await connectionState('github', base)).state, 'disconnected')
  })

  it('normalizes errors and flags auth failures', () => {
    const auth = normalizeIntegrationError(new Error('Unauthorized: bad token'), 'github')

    assert.equal(auth.authFailure, true)

    const plain = normalizeIntegrationError(new Error('boom'), 'github')

    assert.equal(plain.authFailure, false)
    assert.equal(getAdapter('github').id, 'github')
    assert.ok(describeAdapter('github').methods.includes('disconnect'))
    assert.ok(listAdapters().length >= 1)
  })
})
