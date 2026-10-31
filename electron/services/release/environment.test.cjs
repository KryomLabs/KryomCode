// Environment detection: dev/preview/production separation is exact,
// KRYOM_CHANNEL is honored only when packaged, and descriptors stay
// deterministic.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  CHANNELS,
  ENVIRONMENTS,
  detectEnvironment,
  describeEnvironment,
  currentEnvironment,
  readBakedChannel,
} = require('./environment.cjs')

describe('release-environment', () => {
  it('exposes the channel and environment vocabularies', () => {
    assert.deepEqual(CHANNELS, ['stable', 'preview'])
    assert.deepEqual(ENVIRONMENTS, ['development', 'preview', 'production'])
  })

  it('reports development for any unpackaged run', () => {
    assert.equal(detectEnvironment({ packaged: false }), 'development')
    assert.equal(detectEnvironment({}), 'development')

    // A dev checkout can never impersonate preview/production.
    assert.equal(
      detectEnvironment({ packaged: false, channel: 'preview' }),
      'development'
    )
  })

  it('separates preview from production when packaged', () => {
    assert.equal(detectEnvironment({ packaged: true }), 'production')
    assert.equal(
      detectEnvironment({ packaged: true, channel: 'stable' }),
      'production'
    )
    assert.equal(
      detectEnvironment({ packaged: true, channel: 'preview' }),
      'preview'
    )
    assert.equal(
      detectEnvironment({ packaged: true, channel: 'PREVIEW ' }),
      'production'
    )
  })

  it('describes each environment deterministically', () => {
    assert.deepEqual(describeEnvironment('development'), {
      environment: 'development',
      channel: 'stable',
      devServer: true,
      verboseErrors: true,
      allowDevtools: true,
    })

    assert.deepEqual(describeEnvironment('preview'), {
      environment: 'preview',
      channel: 'preview',
      devServer: false,
      verboseErrors: true,
      allowDevtools: true,
    })

    assert.deepEqual(describeEnvironment('production'), {
      environment: 'production',
      channel: 'stable',
      devServer: false,
      verboseErrors: false,
      allowDevtools: false,
    })
  })

  it('reads live state from the app stub and env', () => {
    const app = { isPackaged: true, getVersion: () => '1.2.3' }

    assert.deepEqual(
      currentEnvironment({ app, env: { KRYOM_CHANNEL: 'preview' } }),
      {
        environment: 'preview',
        channel: 'preview',
        devServer: false,
        verboseErrors: true,
        allowDevtools: true,
        packaged: true,
        version: '1.2.3',
      }
    )

    assert.equal(
      currentEnvironment({ app: { isPackaged: false }, env: {} }).environment,
      'development'
    )
  })

  it('reads the baked channel only when packaged', () => {
    assert.equal(readBakedChannel({ kryomChannel: 'preview' }), 'preview')
    assert.equal(readBakedChannel({ kryomChannel: 'stable' }), null)
    assert.equal(readBakedChannel({}), null)

    const app = { isPackaged: true, getVersion: () => '2.0.0' }

    assert.equal(
      currentEnvironment({ app, env: {}, pkg: { kryomChannel: 'preview' } }).environment,
      'preview'
    )
    assert.equal(
      currentEnvironment({ app, env: {}, pkg: {} }).environment,
      'production'
    )

    // Env override wins over baked metadata.
    assert.equal(
      currentEnvironment({ app, env: { KRYOM_CHANNEL: 'preview' }, pkg: {} }).environment,
      'preview'
    )

    // Unpackaged runs ignore baked metadata entirely.
    assert.equal(
      currentEnvironment({
        app: { isPackaged: false },
        env: {},
        pkg: { kryomChannel: 'preview' },
      }).environment,
      'development'
    )
  })
})
