const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const {
  assertSafeUrl,
  isBlockedHost,
  isBlockedIp,
  stripMarkup,
  fetchExcerpt,
  buildPinnedLookup,
  buildPinnedTransport,
  MAX_REDIRECTS,
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

function redirectResponse(location, { url = 'https://example.com/start', status = 302 } = {}) {
  return {
    ok: false,
    status,
    url,
    headers: headers(location === null ? {} : { location }),
    arrayBuffer: async () => Buffer.from(''),
  }
}

// Deterministic DNS: fetch tests must never touch a real resolver.
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

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

  it('blocks prohibited IPv4 destinations and allows public ones', () => {
    for (const address of [
      '0.0.0.0',
      '0.12.34.56',
      '10.0.0.1',
      '100.64.0.1',
      '100.127.255.255',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.1',
      '192.0.2.44',
      '192.168.0.1',
      '198.18.0.1',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      assert.equal(isBlockedIp(address), true, address)
      assert.equal(isBlockedHost(address), true, address)
    }

    for (const address of [
      '1.1.1.1',
      '8.8.8.8',
      '93.184.216.34',
      '100.63.255.255',
      '100.128.0.0',
      '172.15.255.255',
      '172.32.0.0',
      '192.167.1.1',
      '192.169.0.1',
      '223.255.255.255',
    ]) {
      assert.equal(isBlockedIp(address), false, address)
      assert.equal(isBlockedHost(address), false, address)
    }
  })

  it('blocks prohibited IPv6 destinations, including embedded IPv4', () => {
    for (const address of [
      '::',
      '::1',
      'fe80::1',
      'fec0::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      '100::1',
      '2001::1',
      '2001:db8::1',
      '2001:10::1',
      '2001:20::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::7f00:1',
      '64:ff9b::a9fe:a9fe',
      '2002:7f00:1::',
      '2002:a9fe:a9fe::',
    ]) {
      assert.equal(isBlockedIp(address), true, address)
      assert.equal(isBlockedIp(`[${address}]`), true, `[${address}]`)
      assert.equal(isBlockedHost(`[${address}]`), true, `[${address}]`)
    }

    for (const address of [
      '2606:4700:4700::1111',
      '2001:4860:4860::8888',
      '::ffff:8.8.8.8',
      '64:ff9b::808:808',
      '2002:808:808::',
    ]) {
      assert.equal(isBlockedIp(address), false, address)
      assert.equal(isBlockedHost(`[${address}]`), false, `[${address}]`)
    }
  })

  it('rejects non-canonical IP spellings', () => {
    for (const host of ['0x7f.0.0.1', '0xC0.0xA8.0x0.0x1', '2130706433', '0177.0.0.1']) {
      assert.equal(isBlockedHost(host), true, host)
      assert.throws(() => assertSafeUrl(`http://${host}/`), /blocked/, host)
    }
  })

  it('follows redirect chains without re-requesting validated hops', async () => {
    const seen = []
    const fetchImpl = async (url) => {
      seen.push(String(url))

      if (String(url) === 'https://example.com/start') {
        return redirectResponse('/middle')
      }

      return textResponse('<p>arrived</p>', { url: 'https://example.com/middle' })
    }

    const result = await fetchExcerpt('https://example.com/start', {
      fetchImpl,
      lookupImpl: publicLookup,
    })

    assert.equal(result.ok, true)
    assert.equal(result.accessStatus, 'read')
    assert.deepEqual(seen, [
      'https://example.com/start',
      'https://example.com/middle',
    ])
  })

  it('validates each cross-host redirect target with its own DNS check', async () => {
    const seen = []
    const lookedUp = []
    const fetchImpl = async (url) => {
      seen.push(String(url))

      if (String(url) === 'https://example.com/start') {
        return redirectResponse('https://example.org/next')
      }

      return textResponse('<p>arrived</p>', { url: 'https://example.org/next' })
    }

    const result = await fetchExcerpt('https://example.com/start', {
      fetchImpl,
      lookupImpl: async (hostname) => {
        lookedUp.push(hostname)

        return hostname === 'example.org'
          ? [{ address: '1.1.1.1', family: 4 }]
          : [{ address: '93.184.216.34', family: 4 }]
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(lookedUp, ['example.com', 'example.org'])
    assert.deepEqual(seen, [
      'https://example.com/start',
      'https://example.org/next',
    ])
  })

  it('blocks redirect targets before sending the redirected request', async () => {
    for (const location of [
      'http://127.0.0.1:9999/admin',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.9/',
      'http://[::1]/',
    ]) {
      const seen = []
      const fetchImpl = async (url) => {
        seen.push(String(url))

        return redirectResponse(location)
      }

      const result = await fetchExcerpt('https://example.com/start', {
        fetchImpl,
        lookupImpl: publicLookup,
      })

      assert.equal(result.ok, false, location)
      assert.equal(result.accessStatus, 'blocked', location)
      assert.deepEqual(seen, ['https://example.com/start'], location)
    }
  })

  it('stops redirect loops and caps long chains', async () => {
    const loopSeen = []
    const loopImpl = async (url) => {
      loopSeen.push(String(url))

      return redirectResponse(
        String(url).endsWith('/b') ? '/start' : '/b',
        { url: String(url) }
      )
    }

    const looped = await fetchExcerpt('https://example.com/start', {
      fetchImpl: loopImpl,
      lookupImpl: publicLookup,
    })

    assert.equal(looped.ok, false)
    assert.equal(looped.accessStatus, 'blocked')
    assert.match(looped.detail, /loop/)
    assert.deepEqual(loopSeen, [
      'https://example.com/start',
      'https://example.com/b',
    ])

    let hops = 0
    const chainImpl = async (url) => {
      hops += 1

      return redirectResponse(`/hop-${hops}`, { url: String(url) })
    }

    const chained = await fetchExcerpt('https://example.com/start', {
      fetchImpl: chainImpl,
      lookupImpl: publicLookup,
    })

    assert.equal(chained.ok, false)
    assert.equal(chained.accessStatus, 'blocked')
    assert.match(chained.detail, /Too many redirects/)
    assert.equal(hops, MAX_REDIRECTS + 1)
  })

  it('rejects redirects to unsupported schemes without requesting them', async () => {
    for (const location of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://example.com/file',
      'gopher://example.com/',
      'https://user:pass@example.com/',
    ]) {
      const seen = []
      const fetchImpl = async (url) => {
        seen.push(String(url))

        return redirectResponse(location)
      }

      const result = await fetchExcerpt('https://example.com/start', {
        fetchImpl,
        lookupImpl: publicLookup,
      })

      assert.equal(result.ok, false, location)
      assert.equal(result.accessStatus, 'blocked', location)
      assert.deepEqual(seen, ['https://example.com/start'], location)
    }
  })

  it('handles missing and malformed redirect locations safely', async () => {
    const missing = await fetchExcerpt('https://example.com/start', {
      fetchImpl: async () => redirectResponse(null),
      lookupImpl: publicLookup,
    })

    assert.equal(missing.ok, false)
    assert.equal(missing.accessStatus, 'unreachable')
    assert.match(missing.detail, /location/)

    const malformed = await fetchExcerpt('https://example.com/start', {
      fetchImpl: async () => redirectResponse('http://exa mple.com/'),
      lookupImpl: publicLookup,
    })

    assert.equal(malformed.ok, false)
    assert.equal(malformed.accessStatus, 'unreachable')
    assert.match(malformed.detail, /invalid/)
  })

  it('never consults response.url after the request', async () => {
    // The transport-reported final URL is untrusted metadata: the
    // request already went to the pre-validated target, so a hostile
    // url field must neither block nor redirect anything.
    const fetchImpl = async () =>
      textResponse('<p>real body</p>', { url: 'http://169.254.169.254/x' })

    const result = await fetchExcerpt('https://example.com/start', {
      fetchImpl,
      lookupImpl: publicLookup,
    })

    assert.equal(result.ok, true)
    assert.equal(result.accessStatus, 'read')
    assert.match(result.excerpt, /real body/)
  })

  it('blocks when any resolved address is prohibited', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1

      return textResponse('nope')
    }

    const mixedV4 = await fetchExcerpt('https://example.com/start', {
      fetchImpl,
      lookupImpl: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.1.2.3', family: 4 },
      ],
    })

    assert.equal(mixedV4.ok, false)
    assert.equal(mixedV4.accessStatus, 'blocked')

    const mixedV6 = await fetchExcerpt('https://example.com/start', {
      fetchImpl,
      lookupImpl: async () => [
        { address: '2606:4700:4700::1111', family: 6 },
        { address: '::1', family: 6 },
      ],
    })

    assert.equal(mixedV6.ok, false)
    assert.equal(mixedV6.accessStatus, 'blocked')
    assert.equal(calls, 0)
  })

  it('reports unresolvable hosts as unreachable without requesting', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1

      return textResponse('nope')
    }

    const missing = new Error('getaddrinfo ENOTFOUND example.com')
    missing.code = 'ENOTFOUND'

    const failed = await fetchExcerpt('https://example.com/start', {
      fetchImpl,
      lookupImpl: async () => {
        throw missing
      },
    })

    assert.equal(failed.ok, false)
    assert.equal(failed.accessStatus, 'unreachable')

    const empty = await fetchExcerpt('https://example.com/start', {
      fetchImpl,
      lookupImpl: async () => [],
    })

    assert.equal(empty.ok, false)
    assert.equal(empty.accessStatus, 'unreachable')
    assert.equal(calls, 0)
  })

  it('reports network failures after validation honestly', async () => {
    const result = await fetchExcerpt('https://example.com/start', {
      fetchImpl: async () => {
        throw new TypeError('fetch failed')
      },
      lookupImpl: publicLookup,
    })

    assert.equal(result.ok, false)
    assert.equal(result.accessStatus, 'unreachable')
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

    const result = await fetchExcerpt('https://example.com/big', {
      fetchImpl,
      lookupImpl: publicLookup,
    })

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

    const result = await fetchExcerpt('https://example.com/stream', {
      fetchImpl,
      lookupImpl: publicLookup,
    })

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

    const result = await fetchExcerpt('https://example.com/paper', {
      fetchImpl,
      lookupImpl: publicLookup,
    })

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
      const result = await fetchExcerpt('https://example.com/x', {
        fetchImpl,
        lookupImpl: publicLookup,
      })

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
      lookupImpl: publicLookup,
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
          lookupImpl: publicLookup,
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

  it('serves only pinned addresses from the pinned lookup', async () => {
    const lookup = buildPinnedLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ])
    const query = (options) =>
      new Promise((resolve, reject) => {
        lookup('anything.example', options, (error, address, family) =>
          error ? reject(error) : resolve({ address, family })
        )
      })
    const queryAll = (options) =>
      new Promise((resolve, reject) => {
        lookup('anything.example', options, (error, addresses) =>
          error ? reject(error) : resolve(addresses)
        )
      })

    assert.deepEqual(await query({}), {
      address: '93.184.216.34',
      family: 4,
    })
    assert.deepEqual(await query({ family: 6 }), {
      address: '2606:4700:4700::1111',
      family: 6,
    })
    assert.deepEqual(await queryAll({ all: true }), [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ])

    const v4Only = buildPinnedLookup([{ address: '93.184.216.34', family: 4 }])

    await assert.rejects(
      () =>
        new Promise((resolve, reject) => {
          v4Only('anything.example', { family: 6 }, (error, address) =>
            error ? reject(error) : resolve(address)
          )
        }),
      /ENOTFOUND/
    )
  })

  it('steers the real connection to the pinned address', async (t) => {
    const transport = buildPinnedTransport([
      { address: '127.0.0.1', family: 4 },
    ])

    if (!transport) {
      t.skip('undici unavailable')
      return
    }

    // The hostname never resolves via real DNS: reaching the local
    // server proves the socket used the pinned address (the DNS
    // rebinding scenario, inverted for the test).
    const server = http.createServer((_, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('pinned')
    })

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

    try {
      const { port } = server.address()
      const response = await transport.fetch(
        `http://rebind-proof.invalid:${port}/`,
        { dispatcher: transport.agent }
      )
      const body = await response.text()

      assert.equal(response.status, 200)
      assert.equal(body, 'pinned')
    } finally {
      await transport.agent.close().catch(() => undefined)
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
