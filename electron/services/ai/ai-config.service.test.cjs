const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  SUPPORTED_MODELS,
  DEFAULT_MODEL,
  isSupportedModel,
  resolveModel,
  getAIConfig,
} = require('./ai-config.service.cjs')

function saveEnv() {
  return {
    MODEL_API_KEY: process.env.MODEL_API_KEY,
    META_MODEL: process.env.META_MODEL,
  }
}

function restoreEnv(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('ai-config.service', () => {
  it('defaults to Muse Spark and lists both supported models', () => {
    assert.equal(DEFAULT_MODEL, 'muse-spark-1.3')
    assert.deepEqual(SUPPORTED_MODELS, [
      'muse-spark-1.3',
      'muse-wonder-1.0',
    ])
  })

  it('accepts only supported model IDs', () => {
    assert.equal(isSupportedModel('muse-spark-1.3'), true)
    assert.equal(isSupportedModel('muse-wonder-1.0'), true)
    assert.equal(isSupportedModel('gpt-4'), false)
    assert.equal(isSupportedModel(''), false)
    assert.equal(isSupportedModel(null), false)
    assert.equal(isSupportedModel(undefined), false)
  })

  it('resolves per-request overrides against the allowlist', () => {
    assert.equal(
      resolveModel(undefined, 'muse-spark-1.3'),
      'muse-spark-1.3'
    )
    assert.equal(
      resolveModel(null, 'muse-wonder-1.0'),
      'muse-wonder-1.0'
    )
    assert.equal(
      resolveModel('muse-wonder-1.0', 'muse-spark-1.3'),
      'muse-wonder-1.0'
    )
    assert.throws(
      () => resolveModel('gpt-4', 'muse-spark-1.3'),
      /Unsupported model/
    )
    assert.throws(
      () => resolveModel('', 'muse-spark-1.3'),
      /Unsupported model/
    )
  })

  it('reads the default model from META_MODEL', () => {
    const saved = saveEnv()
    process.env.MODEL_API_KEY = 'test-key'
    process.env.META_MODEL = 'muse-wonder-1.0'

    try {
      const config = getAIConfig()

      assert.equal(config.model, 'muse-wonder-1.0')
      assert.equal(config.apiKey, 'test-key')
    } finally {
      restoreEnv(saved)
    }
  })

  it('falls back to Muse Spark when META_MODEL is unset', () => {
    const saved = saveEnv()
    process.env.MODEL_API_KEY = 'test-key'
    delete process.env.META_MODEL

    try {
      assert.equal(getAIConfig().model, 'muse-spark-1.3')
    } finally {
      restoreEnv(saved)
    }
  })

  it('rejects an invalid META_MODEL', () => {
    const saved = saveEnv()
    process.env.MODEL_API_KEY = 'test-key'
    process.env.META_MODEL = 'gpt-4'

    try {
      assert.throws(() => getAIConfig(), /Invalid META_MODEL/)
    } finally {
      restoreEnv(saved)
    }
  })

  it('requires MODEL_API_KEY', () => {
    const saved = saveEnv()
    delete process.env.MODEL_API_KEY
    delete process.env.META_MODEL

    try {
      assert.throws(() => getAIConfig(), /not configured/)
    } finally {
      restoreEnv(saved)
    }
  })
})
