const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  assertSafeUrl,
  isBlockedHost,
  stripMarkup,
  fetchExcerpt,
} = require('./url-fetch.service.cjs')

function headers(entries = {}) {
  const lowered = {}

  for (const [key, value] of Object.entries(entries)) {
    lowered[String(key).toLowerCase()] = value
  }

  return {
    get: (name) => lowered[String(name).toLowerCase()] ?? null,
  }
}

function textResponse(text, { url = 'https://example.com/page', status = 200, contentType = 'text/html' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: headers({ 'content-type': contentType }),
    arrayBuffer: async () => Buffer.from(text, 'utf8'),
  }
}

describe('url-fetch.service', () => {
  it('blocks local-network hosts and unsafe URLs', () => {
    for (const host of [
      'localhost',
      'LOCALHOST',
      'x.localhost',
      'printer.local',
      'db.internal',
      '127.0.0.1',
      '10.0.0.9',
      '192.168.1.1',
      '172.16.5.4',
      '172.31.255.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '[::1]',
      '[fe80::1]',
    ]) {
      assert.equal(isBlockedHost(host), true, host)
      assert.throws(
        () => assertSafeUrl(`https://${host}/`),
        /blocked|required|invalid/,
        host
      )
    }

    assert.equal(isBlockedHost('example.com'), false)
    assert.equal(isBlockedHost('172.15.0.1'), false)
    assert.equal(isBlockedHost('172.32.0.1'), false)
    assert.ok(assertSafeUrl('https://example.com/a?b=c').startsWith('https://example.com/'))

    assert.throws(() => assertSafeUrl('javascript:alert(1)'), /http/)
    assert.throws(() => assertSafeUrl('file:///etc/passwd'), /http/)
    assert.throws(() => assertSafeUrl('https://user:pass@example.com/'), /credentials/)
    assert.throws(() => assertSafeUrl('not a url'), /invalid/)
    assert.throws(() => assertSafeUrl(''), /required/)
  })

  it('re-validates redirect targets before reading', async () => {
    let read = false
    const fetchImpl = async () => ({
      ...textResponse('<p>metadata</p>', { url: 'https://example.com/start' }),
      url: 'http://169.254.169.254/latest/meta-data',
      arrayBuffer: async () => {
        read = true
        return Buffer.from('x')
      },
    })

    const result = await fetchExcerpt('https://example.com/start', { fetchImpl })

    assert.equal(result.ok, false)
    assert.equal(result.accessStatus, 'blocked')
    assert.equal(read, false)
  })

  it('refuses oversized declared bodies without downloading', async () => {
    let read = false
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/big',
      headers: headers({
        'content-type': 'text/html',
        'content-length': String(64 * 1024 * 1024),
      }),
      arrayBuffer: async () => {
        read = true
        return Buffer.from('x')
      },
    })

    const result = await fetchExcerpt('https://example.com/big', { fetchImpl })

    assert.equal(result.ok, false)
    assert.equal(result.accessStatus, 'too-large')
    assert.equal(read, false)
  })

  it('caps streamed bodies and cancels the stream', async () => {
    let cancelled = false
    const chunk = Buffer.alloc(256 * 1024, 'a')
    let served = 0
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/stream',
      headers: headers({ 'content-type': 'text/plain' }),
      body: {
        getReader: () => ({
          read: async () => {
            served += 1

            if (served > 10) {
              return { done: true, value: undefined }
            }

            return { done: false, value: chunk }
          },
          cancel: async () => {
            cancelled = true
          },
          releaseLock: () => {},
        }),
      },
    })

    const result = await fetchExcerpt('https://example.com/stream', { fetchImpl })

    assert.equal(result.ok, true)
    assert.equal(result.accessStatus, 'read')
    assert.ok(result.excerpt.length <= 2000)
    assert.equal(cancelled, true)
    assert.ok(served <= 4)
  })

  it('extracts excerpts and titles from pages', async () => {
    const fetchImpl = async () =>
      textResponse(
        '<html><head><title>Sample Paper</title></head><body><h1>Hi</h1><p>Some body text here.</p></body></html>'
      )

    const result = await fetchExcerpt('https://example.com/paper', { fetchImpl })

    assert.equal(result.ok, true)
    assert.equal(result.title, 'Sample Paper')
    assert.match(result.excerpt, /Some body text/)
    assert.doesNotMatch(result.excerpt, /<p>/)
  })

  it('reports HTTP failures honestly', async () => {
    for (const [status, accessStatus] of [
      [403, 'paywalled'],
      [404, 'missing'],
      [500, 'unreachable'],
    ]) {
      const fetchImpl = async () => textResponse('', { status })
      const result = await fetchExcerpt('https://example.com/x', { fetchImpl })

      assert.equal(result.ok, false)
      assert.equal(result.accessStatus, accessStatus)
    }
  })

  it('distinguishes timeouts from caller cancellation', async () => {
    const timeoutError = new Error('aborted')
    timeoutError.name = 'AbortError'

    const timeoutImpl = async () => {
      throw timeoutError
    }

    const timedOut = await fetchExcerpt('https://example.com/x', {
      fetchImpl: timeoutImpl,
    })

    assert.equal(timedOut.ok, false)
    assert.equal(timedOut.accessStatus, 'timeout')

    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      () =>
        fetchExcerpt('https://example.com/x', {
          fetchImpl: timeoutImpl,
          signal: controller.signal,
        }),
      /cancelled/
    )
  })

  it('strips scripts and markup without executing anything', () => {
    const stripped = stripMarkup(
      '<script>alert(1)</script><style>p{}</style><p>Hello &amp; goodbye</p>'
    )

    assert.doesNotMatch(stripped, /alert|<script/)
    assert.match(stripped, /Hello & goodbye/)
  })
})
