const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

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
const {
  updateProviderConfig,
} = require('./provider-config.cjs')
const {
  normalizeProviderError,
  resolveRoute,
  routeChat,
  defaultRoute,
} = require('./router.cjs')

const SAVED_KEY = process.env.MODEL_API_KEY

afterEach(() => {
  unregisterProvider('mock')
  unregisterProvider('flaky')

  if (SAVED_KEY === undefined) {
    delete process.env.MODEL_API_KEY
  } else {
    process.env.MODEL_API_KEY = SAVED_KEY
  }
})

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-router-'))
}

function scriptedProvider(answers) {
  const queue = [...answers]

  return {
    calls: 0,
    async chat({ model, signal } = {}) {
      this.calls += 1

      if (signal && signal.aborted) {
        const error = new Error('Mock request was cancelled.')

        error.name = 'AbortError'

        throw error
      }

      const next = queue.length > 1 ? queue.shift() : queue[0]

      if (next instanceof Error) {
        throw next
      }

      return { answer: next, model: model || 'mock' }
    },
  }
}

describe('router', () => {
  it('resolves explicit selection with capability validation', async () => {
    const base = await tempBase()

    registerProvider(mockDescriptor)

    const routed = await resolveRoute({
      provider: 'mock',
      model: 'mock',
      requires: ['text'],
      baseDir: base,
    })

    assert.equal(routed.providerId, 'mock')
    assert.equal(routed.usedFallback, null)

    await assert.rejects(
      () => resolveRoute({ provider: 'mock', model: 'mock', requires: ['vision'], baseDir: base }),
      /does not support/
    )
    await assert.rejects(
      () => resolveRoute({ provider: 'mock', model: 'nope', baseDir: base }),
      /Unknown model/
    )
  })

  it('never silently switches providers without explicit fallback', async () => {
    const base = await tempBase()

    delete process.env.MODEL_API_KEY

    await updateProviderConfig({ selectedProvider: 'meta', selectedModel: 'muse-spark-1.3' }, base)

    await assert.rejects(() => resolveRoute({ baseDir: base }), /not configured/)
  })

  it('uses explicit fallback and reports the switch', async () => {
    const base = await tempBase()

    registerProvider(mockDescriptor)
    delete process.env.MODEL_API_KEY

    await updateProviderConfig(
      {
        selectedProvider: 'meta',
        selectedModel: 'muse-spark-1.3',
        fallback: { provider: 'mock', model: 'mock' },
      },
      base
    )

    const routed = await resolveRoute({ baseDir: base })

    assert.equal(routed.providerId, 'mock')
    assert.deepEqual(routed.usedFallback.from, { provider: 'meta', model: 'muse-spark-1.3' })
  })

  it('honors feature overrides and disabled providers', async () => {
    const base = await tempBase()

    registerProvider(mockDescriptor)
    process.env.MODEL_API_KEY = 'test-key'

    await updateProviderConfig(
      {
        selectedProvider: 'meta',
        selectedModel: 'muse-spark-1.3',
        features: { planning: { provider: 'mock', model: 'mock' } },
      },
      base
    )

    const routed = await resolveRoute({ feature: 'planning', baseDir: base })

    assert.equal(routed.providerId, 'mock')

    await updateProviderConfig({ enabled: { meta: false } }, base)
    await assert.rejects(() => resolveRoute({ baseDir: base }), /disabled/)
  })

  it('routes chat with one safe retry on transport failure only', async () => {
    const base = await tempBase()
    const flaky = scriptedProvider([new TypeError('socket hang up'), 'recovered'])

    registerProvider({
      id: 'flaky',
      displayName: 'Flaky',
      models: [{ id: 'mock', capabilities: { text: true } }],
      auth: { kind: 'none' },
      createInstance: () => flaky,
    })

    const result = await routeChat({
      provider: 'flaky',
      model: 'mock',
      messages: [{ role: 'user', content: 'hi' }],
      baseDir: base,
    })

    assert.equal(result.answer, 'recovered')
    assert.equal(flaky.calls, 2)

    const authFail = scriptedProvider([new Error('Meta API authentication failed.')])

    registerProvider({
      id: 'mock',
      displayName: 'Mock',
      models: [{ id: 'mock', capabilities: { text: true } }],
      auth: { kind: 'none' },
      createInstance: () => authFail,
    })

    await assert.rejects(
      () =>
        routeChat({
          provider: 'mock',
          model: 'mock',
          messages: [{ role: 'user', content: 'hi' }],
          baseDir: base,
        }),
      /authentication failed/
    )
    assert.equal(authFail.calls, 1)
  })

  it('propagates cancellation without retry', async () => {
    const base = await tempBase()

    registerProvider({
      id: 'mock',
      displayName: 'Mock',
      models: [{ id: 'mock', capabilities: { text: true } }],
      auth: { kind: 'none' },
      createInstance: () => new MockProvider({ answer: 'late', delayMs: 5000 }),
    })

    const controller = new AbortController()
    const pending = routeChat({
      provider: 'mock',
      model: 'mock',
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
      baseDir: base,
    })

    controller.abort()

    await assert.rejects(() => pending, /cancel/i)
  })

  it('normalizes provider errors and reports defaults', async () => {
    const base = await tempBase()

    assert.equal(normalizeProviderError(new TypeError('x'), 'meta').retryable, true)
    assert.equal(normalizeProviderError(new Error('Meta API authentication failed.'), 'meta').retryable, false)
    assert.equal(normalizeProviderError(new Error('cancelled'), 'meta').code, 'cancelled')

    const route = await defaultRoute({ baseDir: base })

    assert.equal(route.providerId, 'meta')
    assert.equal(route.modelId, 'muse-spark-1.3')
  })
})
