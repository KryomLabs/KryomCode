const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  CRASH_WINDOW_MS,
  MAX_CRASHES_IN_WINDOW,
  summarizeCrash,
  pruneCrashes,
  shouldOfferReload,
  describeMainFailure,
} = require('./crash-recovery.cjs')

describe('crash-recovery', () => {
  it('summarizes renderer crash details', () => {
    assert.equal(
      summarizeCrash({ reason: 'crashed', exitCode: 1 }),
      'crashed (exit 1)'
    )
    assert.equal(summarizeCrash({ reason: 'oom' }), 'oom')
    assert.equal(summarizeCrash({}), 'unknown')
    assert.equal(summarizeCrash(null), 'unknown cause')
    assert.equal(summarizeCrash('boom'), 'unknown cause')
  })

  it('prunes crash stamps outside the window', () => {
    const now = 1_000_000

    assert.deepEqual(
      pruneCrashes([now - CRASH_WINDOW_MS - 1, now - 1000, now], now),
      [now - 1000, now]
    )
    assert.deepEqual(pruneCrashes(['x', null, now], now), [now])
    assert.deepEqual(pruneCrashes(null, now), [])
  })

  it('offers reload until crashes repeat inside the window', () => {
    const now = 1_000_000

    assert.equal(shouldOfferReload([], now), true)
    assert.equal(shouldOfferReload([now - 1000], now), true)
    assert.equal(
      shouldOfferReload(
        Array(MAX_CRASHES_IN_WINDOW).fill(now - 1000),
        now
      ),
      false
    )
    assert.equal(
      shouldOfferReload(
        Array(MAX_CRASHES_IN_WINDOW).fill(now - CRASH_WINDOW_MS - 1),
        now
      ),
      true
    )
  })

  it('describes main-process failures briefly and redacted', () => {
    assert.equal(
      describeMainFailure(new Error('boom\nsecond line')),
      'Error: boom'
    )
    assert.equal(describeMainFailure(null), 'unknown error')
    assert.equal(describeMainFailure(undefined), 'unknown error')
    assert.equal(describeMainFailure('plain string'), 'plain string')

    const long = describeMainFailure(new Error(`x${'y'.repeat(500)}`))

    assert.equal(long.length, 300)

    const leaked = describeMainFailure(
      new Error('call failed with Bearer test-secret-token')
    )

    assert.ok(!leaked.includes('test-secret-token'))
    assert.ok(leaked.includes('[redacted]'))
  })
})
