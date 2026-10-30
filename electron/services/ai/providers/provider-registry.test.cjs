const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const {
  registerProvider,
  unregisterProvider,
  getProvider,
  describeProvider,
  listProviders,
  isProviderAvailable,
  createInstance,
  registerBuiltins,
} = require('./provider-registry.cjs')
const {
  mockDescriptor,
} = require('./mock.provider.cjs')

const SAVED_KEY = process.env.MODEL_API_KEY

afterEach(() => {
  unregisterProvider('mock')
  unregisterProvider('custom')

  if (SAVED_KEY === undefined) {
    delete process.env.MODEL_API_KEY
  } else {
    process.env.MODEL_API_KEY = SAVED_KEY
  }
})

describe('provider-registry', () => {
  it('registers builtins with the Meta provider first-class', () => {
    const providers = registerBuiltins()
    const meta = providers.find((entry) => entry.id === 'meta')

    assert.ok(meta)
    assert.equal(meta.displayName, 'Meta AI')
    assert.deepEqual(
      meta.models.map((model) => model.id).sort(),
      ['muse-spark-1.3', 'muse-wonder-1.0']
    )
    assert.equal(meta.models[0].capabilities.text, true)
    assert.equal(meta.models[0].contextWindow, null)
  })

  it('rejects duplicate registration', () => {
    registerBuiltins()

    assert.throws(
      () => registerProvider({ ...require('./meta-muse.provider.cjs').metaDescriptor }),
      /already registered/
    )
  })

  it('validates descriptors strictly', () => {
    assert.throws(() => registerProvider(null), /object is required/)
    assert.throws(
      () => registerProvider({ id: 'Bad!', displayName: 'x', models: [], createInstance: () => ({}) }),
      /id must be/
    )
    assert.throws(
      () =>
        registerProvider({
          id: 'custom',
          displayName: 'Custom',
          models: [],
          createInstance: () => ({}),
        }),
      /1 to 50 models/
    )
    assert.throws(
      () =>
        registerProvider({
          id: 'custom',
          displayName: 'Custom',
          models: [{ id: 'm', capabilities: { text: true } }],
          auth: { kind: 'api-key', secretEnv: 'EVIL_KEY' },
          createInstance: () => ({}),
        }),
      /allowlisted secret/
    )
  })

  it('reports availability from key presence without exposing values', () => {
    registerBuiltins()
    delete process.env.MODEL_API_KEY

    assert.equal(isProviderAvailable('meta'), false)

    const described = describeProvider('meta')

    assert.equal(described.auth.configured, false)
    assert.ok(!JSON.stringify(described).includes('sk-'))

    process.env.MODEL_API_KEY = 'test-key'

    assert.equal(isProviderAvailable('meta'), true)
    assert.equal(describeProvider('meta').auth.configured, true)
  })

  it('creates contract-checked instances', () => {
    registerBuiltins()
    registerProvider(mockDescriptor)

    const mock = createInstance('mock')

    assert.equal(typeof mock.chat, 'function')

    registerProvider({
      id: 'custom',
      displayName: 'Broken',
      models: [{ id: 'm', capabilities: { text: true } }],
      auth: { kind: 'none' },
      createInstance: () => ({}),
    })

    assert.throws(() => createInstance('custom'), /async chat/)
  })

  it('lists providers with metadata only', () => {
    registerBuiltins()
    registerProvider(mockDescriptor)

    const listed = listProviders()

    assert.deepEqual(listed.map((entry) => entry.id), ['meta', 'mock'])
    assert.ok(listed.every((entry) => entry.createInstance === undefined))
    assert.equal(getProvider('mock').id, 'mock')
    assert.throws(() => getProvider('nope'), /Unknown provider/)
  })
})
