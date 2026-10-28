const {
  assertImplementsProvider,
} = require('./provider.interface.cjs')

// Deterministic test double. Never touches the network. Records every
// call so tests can assert on the model and messages selected by the
// orchestration layer. Honors AbortSignal (with an optional delay)
// so cancellation paths stay testable without network timing.
class MockProvider {
  constructor({ answer = 'Mock answer.', model = null, delayMs = 0 } = {}) {
    this.answer = answer
    this.defaultModel = model
    this.delayMs = delayMs
    this.calls = []

    assertImplementsProvider(this, 'MockProvider')
  }

  get lastCall() {
    return this.calls[this.calls.length - 1]
  }

  cancelledError() {
    const error = new Error('Mock request was cancelled.')

    error.name = 'AbortError'

    return error
  }

  async chat({ model, messages, signal } = {}) {
    this.calls.push({ model, messages })

    if (signal && signal.aborted) {
      throw this.cancelledError()
    }

    if (this.delayMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          resolve()
        }, this.delayMs)
        const onAbort = () => {
          clearTimeout(timer)
          cleanup()
          reject(this.cancelledError())
        }
        const cleanup = () => {
          if (signal) {
            signal.removeEventListener('abort', onAbort)
          }
        }

        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    }

    return {
      answer: this.answer,
      model: model || this.defaultModel || 'mock',
    }
  }
}

module.exports = {
  MockProvider,
}
