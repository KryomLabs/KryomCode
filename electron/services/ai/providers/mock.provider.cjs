const {
  assertImplementsProvider,
} = require('./provider.interface.cjs')

// Deterministic test double. Never touches the network. Records every
// call so tests can assert on the model and messages selected by the
// orchestration layer.
class MockProvider {
  constructor({ answer = 'Mock answer.', model = null } = {}) {
    this.answer = answer
    this.defaultModel = model
    this.calls = []

    assertImplementsProvider(this, 'MockProvider')
  }

  get lastCall() {
    return this.calls[this.calls.length - 1]
  }

  async chat({ model, messages } = {}) {
    this.calls.push({ model, messages })

    return {
      answer: this.answer,
      model: model || this.defaultModel || 'mock',
    }
  }
}

module.exports = {
  MockProvider,
}
