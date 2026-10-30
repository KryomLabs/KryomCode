// Log levels: KRYOM_LOG_LEVEL filters info/warn, errors always emit,
// invalid values fall back to info, and redaction still applies.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  createLogger,
  setLogLevel,
  currentLevel,
} = require('./logger.cjs')

function capture(method) {
  const lines = []
  const original = console[method]

  console[method] = (...args) => {
    lines.push(args.join(' '))
  }

  return {
    lines,
    restore: () => {
      console[method] = original
    },
  }
}

describe('logger-levels', () => {
  it('defaults to info and normalizes invalid levels', () => {
    delete process.env.KRYOM_LOG_LEVEL
    setLogLevel('info')

    assert.equal(currentLevel(), 'info')
    assert.equal(setLogLevel('nope'), 'info')
    assert.equal(setLogLevel('WARN'), 'warn')

    setLogLevel('info')
  })

  it('honors KRYOM_LOG_LEVEL when no explicit level is set', () => {
    const modulePath = require.resolve('./logger.cjs')

    delete require.cache[modulePath]
    process.env.KRYOM_LOG_LEVEL = 'error'

    const fresh = require('./logger.cjs')

    assert.equal(fresh.currentLevel(), 'error')

    delete process.env.KRYOM_LOG_LEVEL
    delete require.cache[modulePath]
  })

  it('filters info and warn but never errors', () => {
    const log = createLogger('level-probe')
    const out = capture('log')
    const warn = capture('warn')
    const err = capture('error')

    try {
      setLogLevel('error')
      log.info('hidden info')
      log.warn('hidden warn')
      log.error('shown error')

      assert.deepEqual(out.lines, [])
      assert.deepEqual(warn.lines, [])
      assert.equal(err.lines.length, 1)
      assert.match(err.lines[0], /shown error/)

      setLogLevel('warn')
      log.info('still hidden')
      log.warn('shown warn')

      assert.deepEqual(out.lines, [])
      assert.equal(warn.lines.length, 1)
    } finally {
      out.restore()
      warn.restore()
      err.restore()
      setLogLevel('info')
    }
  })

  it('redacts secrets at every level', () => {
    const log = createLogger('redact-probe')
    const err = capture('error')

    try {
      log.error('key MODEL_API_KEY=hunter2 here')

      assert.equal(err.lines.length, 1)
      assert.ok(!err.lines[0].includes('hunter2'))
      assert.match(err.lines[0], /\[redacted\]/)
    } finally {
      err.restore()
    }
  })
})
