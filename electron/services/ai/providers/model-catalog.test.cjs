const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const {
  unregisterProvider,
} = require('./provider-registry.cjs')
const {
  mockDescriptor,
} = require('./mock.provider.cjs')
const {
  KNOWN_CAPABILITIES,
  listModels,
  getModel,
  defaultModel,
  validateModelCapabilities,
} = require('./model-catalog.cjs')

afterEach(() => {
  unregisterProvider('mock')
})

describe('model-catalog', () => {
  it('discovers builtin models with honest capability flags', () => {
    const models = listModels()

    assert.ok(models.length >= 2)
    assert.ok(models.every((entry) => KNOWN_CAPABILITIES.every((cap) => typeof entry.capabilities[cap] === 'boolean')))
    assert.ok(models.every((entry) => entry.contextWindow === null))
  })

  it('resolves single models and provider defaults', () => {
    const spark = getModel('meta', 'muse-spark-1.3')

    assert.equal(spark.displayName, 'Muse Spark 1.3')
    assert.equal(defaultModel('meta').modelId, 'muse-spark-1.3')
    assert.throws(() => getModel('meta', 'nope'), /Unknown model/)
    assert.throws(() => getModel('nope', 'x'), /Unknown provider/)
  })

  it('validates capabilities fail-closed', () => {
    const { registerProvider } = require('./provider-registry.cjs')

    registerProvider(mockDescriptor)

    assert.equal(validateModelCapabilities('mock', 'mock', ['text']).modelId, 'mock')
    assert.throws(
      () => validateModelCapabilities('mock', 'mock', ['vision']),
      /does not support: vision/
    )
    assert.throws(
      () => validateModelCapabilities('mock', 'mock', ['teleport']),
      /Unknown capability/
    )
  })
})
