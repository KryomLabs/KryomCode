const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  readProviderConfig,
  updateProviderConfig,
  testConnection,
} = require('./provider-config.cjs')
const {
  registerProvider,
  unregisterProvider,
} = require('./providers/provider-registry.cjs')
const {
  mockDescriptor,
} = require('./providers/mock.provider.cjs')
const {
  MockProvider,
} = require('./providers/mock.provider.cjs')

const SAVED_KEY = process.env.MODEL_API_KEY

afterEach(() => {
  unregisterProvider('mock')

  if (SAVED_KEY === undefined) {
    delete process.env.MODEL_API_KEY
  } else {
    process.env.MODEL_API_KEY = SAVED_KEY
  }
})

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-provconf-'))
}

describe('provider-config', () => {
  it('reads defaults when no file exists and sanitizes corrupt files', async () => {
    const base = await tempBase()
    const fresh = await readProviderConfig(base)

    assert.equal(fresh.selectedProvider, 'meta')
    assert.equal(fresh.selectedModel, 'muse-spark-1.3')
    assert.equal(fresh.fallback, null)

    await fs.writeFile(path.join(base, 'kryomcode-providers.json'), '{nope')

    const sanitized = await readProviderConfig(base)

    assert.equal(sanitized.selectedProvider, 'meta')
  })

  it('updates selection, enablement, fallback, and features', async () => {
    const base = await tempBase()

    const updated = await updateProviderConfig(
      {
        selectedProvider: 'meta',
        selectedModel: 'muse-wonder-1.0',
        enabled: { meta: true, mock: false },
        fallback: { provider: 'meta', model: 'muse-spark-1.3' },
        features: { planning: { provider: 'meta', model: 'muse-wonder-1.0' } },
      },
      base
    )

    assert.equal(updated.selectedModel, 'muse-wonder-1.0')
    assert.equal(updated.enabled.mock, false)
    assert.deepEqual(updated.fallback, { provider: 'meta', model: 'muse-spark-1.3' })
    assert.deepEqual(updated.features.planning, { provider: 'meta', model: 'muse-wonder-1.0' })

    const reread = await readProviderConfig(base)

    assert.deepEqual(reread, updated)
  })

  it('rejects invalid patches and unknown fallback providers', async () => {
    const base = await tempBase()

    await assert.rejects(() => updateProviderConfig({ selectedModel: '' }, base), /Invalid selectedModel/)
    await assert.rejects(() => updateProviderConfig({ enabled: { meta: 'yes' } }, base), /Invalid enabled/)
    await assert.rejects(
      () => updateProviderConfig({ fallback: { provider: 'nope', model: 'x' } }, base),
      /unknown provider/
    )
  })

  it('tests connections locally without network', async () => {
    const base = await tempBase()

    registerProvider(mockDescriptor)
    delete process.env.MODEL_API_KEY

    const mock = await testConnection('mock', { baseDir: base })

    assert.equal(mock.ok, true)
    assert.equal(mock.live, false)

    const meta = await testConnection('meta', { baseDir: base })

    assert.equal(meta.ok, false)
    assert.ok(meta.checks.some((entry) => entry.name === 'authentication' && !entry.ok))

    const unknown = await testConnection('nope', { baseDir: base })

    assert.equal(unknown.ok, false)
  })

  it('runs live tests only when asked, with injected providers', async () => {
    const base = await tempBase()

    registerProvider(mockDescriptor)

    const live = await testConnection('mock', {
      baseDir: base,
      live: true,
      provider: new MockProvider({ answer: 'ok' }),
    })

    assert.equal(live.ok, true)
    assert.equal(live.live, true)
    assert.ok(live.checks.some((entry) => entry.name === 'live' && entry.ok))

    const failing = await testConnection('mock', {
      baseDir: base,
      live: true,
      provider: new MockProvider({ answer: '   ' }),
    })

    assert.equal(failing.ok, false)
  })
})
