const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  CODES,
  createError,
  validationError,
  isCodedError,
  boundDetail,
} = require('./errors.cjs')
const { createLogger, redact, redactText } = require('./logger.cjs')

describe('utils', () => {
  it('builds coded errors with readable messages', () => {
    const error = createError(CODES.WRITE_CONFLICT, 'Conflict happened.')

    assert.equal(error.message, 'Conflict happened.')
    assert.equal(error.code, 'E_WRITE_CONFLICT')
    assert.equal(isCodedError(error), true)
    assert.equal(isCodedError(new Error('plain')), false)
    assert.equal(validationError('Bad input.').code, CODES.VALIDATION)
  })

  it('bounds untrusted detail text for user-facing messages', () => {
    assert.equal(boundDetail('  padded  ', 100), 'padded')
    assert.equal(boundDetail('x'.repeat(2000), 500), 'x'.repeat(500))
    assert.equal(boundDetail('', 500), '')
    assert.equal(boundDetail(undefined, 500), '')
    assert.equal(boundDetail(null, 500), '')
    assert.equal(boundDetail({ nested: true }, 500), '')
    assert.equal(boundDetail(42, 500), '')
  })

  it('redacts secrets from text and objects', () => {
    assert.equal(
      redactText('Authorization: Bearer abc123xyz'),
      'Authorization: Bearer [redacted]'
    )
    assert.equal(
      redactText('MODEL_API_KEY=topsecretvalue'),
      'MODEL_API_KEY=[redacted]'
    )
    assert.equal(redactText('nothing sensitive here'), 'nothing sensitive here')

    const redacted = redact({
      MODEL_API_KEY: 'shh',
      nested: { token: 'shh', keep: 'visible' },
    })

    assert.equal(redacted.MODEL_API_KEY, '[redacted]')
    assert.equal(redacted.nested.token, '[redacted]')
    assert.equal(redacted.nested.keep, 'visible')
  })

  it('handles circular structures without throwing', () => {
    const circular = { name: 'loop' }
    circular.self = circular

    const logger = createLogger('test')

    assert.doesNotThrow(() => redact(circular))
    assert.doesNotThrow(() => logger.info('circular check', { ok: true }))
  })
})
