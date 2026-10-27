const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  MetaMuseProvider,
  META_BASE_URL,
} = require('./meta-muse.provider.cjs')

function jsonResponse({ ok, status, body }) {
  return {
    ok,
    status,
    json: async () => body,
  }
}

function successFetch(answer) {
  const calls = []

  const fetchImpl = async (url, options) => {
    calls.push({ url, options })

    return jsonResponse({
      ok: true,
      status: 200,
      body: {
        choices: [{ message: { content: answer } }],
      },
    })
  }

  return { calls, fetchImpl }
}

describe('meta-muse.provider', () => {
  it('requires an API key', () => {
    assert.throws(() => new MetaMuseProvider({}), /not configured/)
    assert.throws(
      () => new MetaMuseProvider({ apiKey: '' }),
      /not configured/
    )
  })

  it('posts to the fixed Meta endpoint with Bearer auth', async () => {
    const { calls, fetchImpl } = successFetch('Hi there.')
    const provider = new MetaMuseProvider({
      apiKey: 'test-key',
      fetchImpl,
    })

    const result = await provider.chat({
      model: 'muse-spark-1.3',
      messages: [{ role: 'user', content: 'hi' }],
    })

    assert.equal(result.answer, 'Hi there.')
    assert.equal(result.model, 'muse-spark-1.3')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `${META_BASE_URL}/chat/completions`)
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(
      calls[0].options.headers.Authorization,
      'Bearer test-key'
    )
    assert.equal(
      calls[0].options.headers['Content-Type'],
      'application/json'
    )

    const body = JSON.parse(calls[0].options.body)

    assert.equal(body.model, 'muse-spark-1.3')
    assert.equal(body.temperature, 0.2)
    assert.deepEqual(body.messages, [
      { role: 'user', content: 'hi' },
    ])
  })

  it('uses the same request format for Muse Wonder', async () => {
    const { calls, fetchImpl } = successFetch('Wonder answer.')
    const provider = new MetaMuseProvider({
      apiKey: 'test-key',
      fetchImpl,
    })

    const result = await provider.chat({
      model: 'muse-wonder-1.0',
      messages: [{ role: 'user', content: 'hi' }],
    })

    assert.equal(result.model, 'muse-wonder-1.0')
    assert.equal(calls[0].url, `${META_BASE_URL}/chat/completions`)
    assert.equal(
      JSON.parse(calls[0].options.body).model,
      'muse-wonder-1.0'
    )
  })

  it('maps authentication failures', async () => {
    const provider = new MetaMuseProvider({
      apiKey: 'bad-key',
      fetchImpl: async () =>
        jsonResponse({
          ok: false,
          status: 401,
          body: { error: { message: 'bad key' } },
        }),
    })

    await assert.rejects(
      () =>
        provider.chat({
          model: 'muse-spark-1.3',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      /authentication failed/
    )
  })

  it('maps rate limits', async () => {
    const provider = new MetaMuseProvider({
      apiKey: 'test-key',
      fetchImpl: async () =>
        jsonResponse({
          ok: false,
          status: 429,
          body: { error: { message: 'slow down' } },
        }),
    })

    await assert.rejects(
      () =>
        provider.chat({
          model: 'muse-spark-1.3',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      /rate limit/
    )
  })

  it('surfaces server errors with status', async () => {
    const provider = new MetaMuseProvider({
      apiKey: 'test-key',
      fetchImpl: async () =>
        jsonResponse({ ok: false, status: 500, body: {} }),
    })

    await assert.rejects(
      () =>
        provider.chat({
          model: 'muse-spark-1.3',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      /failed \(500\)/
    )
  })

  it('rejects malformed and empty responses', async () => {
    const malformed = new MetaMuseProvider({
      apiKey: 'test-key',
      fetchImpl: async () =>
        jsonResponse({
          ok: true,
          status: 200,
          body: { choices: [] },
        }),
    })

    await assert.rejects(
      () =>
        malformed.chat({
          model: 'muse-spark-1.3',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      /empty or unsupported/
    )

    const empty = new MetaMuseProvider({
      apiKey: 'test-key',
      fetchImpl: async () =>
        jsonResponse({
          ok: true,
          status: 200,
          body: {
            choices: [{ message: { content: '   ' } }],
          },
        }),
    })

    await assert.rejects(
      () =>
        empty.chat({
          model: 'muse-spark-1.3',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      /empty or unsupported/
    )
  })

  it('times out instead of hanging', async () => {
    const hangingFetch = (url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('Aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    const provider = new MetaMuseProvider({
      apiKey: 'test-key',
      timeoutMs: 20,
      fetchImpl: hangingFetch,
    })

    await assert.rejects(
      () =>
        provider.chat({
          model: 'muse-spark-1.3',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      /timed out/
    )
  })

  it('requires messages', async () => {
    const provider = new MetaMuseProvider({
      apiKey: 'test-key',
      fetchImpl: async () => {
        throw new Error('fetch must not be called')
      },
    })

    await assert.rejects(
      () =>
        provider.chat({ model: 'muse-spark-1.3', messages: [] }),
      /missing messages/
    )
  })
})
