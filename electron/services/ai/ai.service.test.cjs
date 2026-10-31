const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { chat, cancelChat } = require('./ai.service.cjs')
const { MockProvider } = require('./providers/mock.provider.cjs')

function useTestKey() {
  const saved = {
    MODEL_API_KEY: process.env.MODEL_API_KEY,
    META_MODEL: process.env.META_MODEL,
  }

  process.env.MODEL_API_KEY = 'test-key'
  delete process.env.META_MODEL

  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

describe('ai.service', () => {
  it('rejects missing, empty, and oversized prompts', async () => {
    await assert.rejects(() => chat(null), /prompt/)
    await assert.rejects(() => chat({ prompt: '   ' }), /prompt/)
    await assert.rejects(
      () => chat({ prompt: 'x'.repeat(12001) }),
      /prompt/
    )
  })

  it('requires MODEL_API_KEY before any network call', async () => {
    const saved = process.env.MODEL_API_KEY
    delete process.env.MODEL_API_KEY

    try {
      await assert.rejects(
        () => chat({ prompt: 'hi' }),
        /not configured/
      )
    } finally {
      if (saved === undefined) {
        delete process.env.MODEL_API_KEY
      } else {
        process.env.MODEL_API_KEY = saved
      }
    }
  })

  it('aborts the in-flight provider request on cancel', async () => {
    const restore = useTestKey()

    try {
      assert.deepEqual(cancelChat(), { cancelled: false })

      const provider = new MockProvider({ delayMs: 5000 })
      const run = chat({ prompt: 'hi' }, { provider })

      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.deepEqual(cancelChat(), { cancelled: true })
      await assert.rejects(() => run, /cancelled/)
      assert.deepEqual(cancelChat(), { cancelled: false })
    } finally {
      restore()
    }
  })

  it('uses Muse Spark by default', async () => {
    const restore = useTestKey()

    try {
      const provider = new MockProvider({ answer: 'Spark says hi.' })
      const result = await chat({ prompt: 'hi' }, { provider })

      assert.equal(result.answer, 'Spark says hi.')
      assert.equal(result.model, 'muse-spark-1.3')
      assert.equal(provider.lastCall.model, 'muse-spark-1.3')
      assert.ok(
        provider.lastCall.messages.some(
          (message) => message.role === 'user' && message.content === 'hi'
        )
      )
    } finally {
      restore()
    }
  })

  it('accepts a validated per-request override for Muse Wonder', async () => {
    const restore = useTestKey()

    try {
      const provider = new MockProvider({ answer: 'Wonder says hi.' })
      const result = await chat(
        { prompt: 'hi', model: 'muse-wonder-1.0' },
        { provider }
      )

      assert.equal(result.answer, 'Wonder says hi.')
      assert.equal(result.model, 'muse-wonder-1.0')
      assert.equal(provider.lastCall.model, 'muse-wonder-1.0')
    } finally {
      restore()
    }
  })

  it('rejects unsupported per-request models without calling the provider', async () => {
    const restore = useTestKey()

    try {
      const provider = new MockProvider()

      await assert.rejects(
        () => chat({ prompt: 'hi', model: 'gpt-4' }, { provider }),
        /Unsupported model/
      )
      assert.equal(provider.calls.length, 0)
    } finally {
      restore()
    }
  })

  it('rejects objects that do not implement the provider contract', async () => {
    const restore = useTestKey()

    try {
      await assert.rejects(
        () => chat({ prompt: 'hi' }, { provider: {} }),
        /must implement/
      )
    } finally {
      restore()
    }
  })

  it('rejects empty provider answers', async () => {
    const restore = useTestKey()

    try {
      const provider = new MockProvider({ answer: '   ' })

      await assert.rejects(
        () => chat({ prompt: 'hi' }, { provider }),
        /empty or unsupported/
      )
    } finally {
      restore()
    }
  })

  it('retries a transport failure once, then succeeds', async () => {
    const restore = useTestKey()

    try {
      let calls = 0
      const provider = {
        async chat({ model, messages }) {
          calls += 1

          if (calls === 1) {
            throw new TypeError('fetch failed')
          }

          return { answer: 'recovered', model }
        },
      }

      const result = await chat({ prompt: 'hi' }, { provider })

      assert.equal(result.answer, 'recovered')
      assert.equal(calls, 2)
    } finally {
      restore()
    }
  })

  it('never retries auth, rate-limit, or validation failures', async () => {
    const restore = useTestKey()

    try {
      for (const message of [
        'Meta API authentication failed. Check MODEL_API_KEY and try again.',
        'Meta API rate limit reached. Wait a moment and try again.',
        'Meta API request failed (400).',
      ]) {
        let calls = 0
        const provider = {
          async chat() {
            calls += 1
            throw new Error(message)
          },
        }

        await assert.rejects(() => chat({ prompt: 'hi' }, { provider }))
        assert.equal(calls, 1)
      }
    } finally {
      restore()
    }
  })

  it('never retries a cancelled request', async () => {
    const restore = useTestKey()

    try {
      const provider = new MockProvider({ delayMs: 5000 })
      const run = chat({ prompt: 'hi' }, { provider })

      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.deepEqual(cancelChat(), { cancelled: true })
      await assert.rejects(() => run, /cancelled/)
      assert.equal(provider.calls.length, 1)
    } finally {
      restore()
    }
  })

  it('redacts secrets in auto-attached context, never the prompt', async () => {
    const restore = useTestKey()

    try {
      const provider = new MockProvider({ answer: 'ok' })

      await chat(
        {
          prompt: 'Is API_KEY=demo a secret here?',
          context: 'Authorization: Bearer live-token-123\nAPI_KEY=live-secret-456',
        },
        { provider }
      )

      const sent = provider.lastCall.messages
        .map((message) => message.content)
        .join('\n')

      assert.ok(!sent.includes('live-token-123'))
      assert.ok(!sent.includes('live-secret-456'))
      assert.ok(sent.includes('[redacted]'))
      // The user's own words pass through untouched.
      assert.ok(sent.includes('Is API_KEY=demo a secret here?'))
    } finally {
      restore()
    }
  })
})
