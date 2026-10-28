// Safe URL retrieval for research sources. Treats every fetched page
// as untrusted data: blocks local-network targets, caps size and time,
// strips markup, and returns short excerpts only. Never executes or
// interprets retrieved content.
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('research-fetch')

const FETCH_TIMEOUT_MS = 15000
const MAX_BYTES = 512 * 1024
const MAX_EXCERPT_CHARS = 2000
const MAX_DECLARED_BYTES = 8 * 1024 * 1024

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '')

  if (!host) {
    return true
  }

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true
  }

  // IPv4: loopback, private, link-local, CGNAT, metadata.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)

  if (ipv4) {
    const [, a, b] = ipv4.map(Number)

    if (a === 10 || a === 127) {
      return true
    }

    if (a === 172 && b >= 16 && b <= 31) {
      return true
    }

    if (a === 192 && b === 168) {
      return true
    }

    if (a === 169 && b === 254) {
      return true
    }

    if (a === 100 && b >= 64 && b <= 127) {
      return true
    }

    if (a === 0) {
      return true
    }
  }

  // IPv6: loopback, link-local, unique-local.
  if (host === '::1' || host === '[::1]') {
    return true
  }

  const bare = host.replace(/^\[|\]$/g, '')

  if (/^(fe80|fc00|fd00)/i.test(bare.replace(/:/g, ''))) {
    return true
  }

  if (bare.includes(':') && /^(::ffff:)?(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(bare)) {
    return true
  }

  return false
}

function assertSafeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('A URL is required.')
  }

  let parsed = null

  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new Error('That URL is invalid.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs can be retrieved.')
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with credentials are not allowed.')
  }

  if (isBlockedHost(parsed.hostname)) {
    throw new Error('Local-network and internal addresses are blocked.')
  }

  return parsed.toString().slice(0, 2000)
}

function stripMarkup(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)

  if (!match) {
    return ''
  }

  return match[1].replace(/\s+/g, ' ').trim().slice(0, 300)
}

// Reads at most MAX_BYTES from a response body, cancelling the
// stream early. A huge response can never fill memory: only the
// bounded prefix is kept.
async function readBoundedBody(response) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0

    try {
      for (;;) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        if (!value || value.length === 0) {
          continue
        }

        total += value.length

        if (total > MAX_BYTES) {
          const keep = value.length - (total - MAX_BYTES)

          if (keep > 0) {
            chunks.push(value.slice(0, keep))
          }

          try {
            await reader.cancel()
          } catch {
            // Already closed; the prefix we kept is enough.
          }

          break
        }

        chunks.push(value)
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // Best effort on doubles without a real lock.
      }
    }

    return Buffer.concat(chunks)
  }

  const buffer = Buffer.from(await response.arrayBuffer())

  return buffer.length > MAX_BYTES ? buffer.slice(0, MAX_BYTES) : buffer
}

// Fetches one page and returns a bounded excerpt. Returns an object
// with ok:false instead of throwing for HTTP-level failures so the
// caller can record per-source access status honestly.
async function fetchExcerpt(rawUrl, { fetchImpl = fetch, signal, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const url = assertSafeUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const onAbort = () => controller.abort()

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      throw new Error('Reading was cancelled.')
    }

    signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'KryomCode-Research/0.1', Accept: 'text/html,text/plain,application/pdf;q=0.5' },
      signal: controller.signal,
      redirect: 'follow',
    })

    // Redirects are followed by fetch but never re-validated by it:
    // a benign URL could land on a blocked destination. Re-check the
    // final URL before reading anything.
    if (response.url) {
      try {
        assertSafeUrl(response.url)
      } catch (error) {
        return { ok: false, url, accessStatus: 'blocked', excerpt: '', title: '', detail: error.message }
      }
    }

    if (response.status === 401 || response.status === 403 || response.status === 402) {
      return { ok: false, url, accessStatus: 'paywalled', excerpt: '', title: '', detail: `HTTP ${response.status}` }
    }

    if (response.status === 404 || response.status === 410) {
      return { ok: false, url, accessStatus: 'missing', excerpt: '', title: '', detail: `HTTP ${response.status}` }
    }

    if (!response.ok) {
      return { ok: false, url, accessStatus: 'unreachable', excerpt: '', title: '', detail: `HTTP ${response.status}` }
    }

    const contentType = response.headers && typeof response.headers.get === 'function'
      ? String(response.headers.get('content-type') || '')
      : ''

    if (/application\/pdf/i.test(contentType)) {
      return { ok: false, url, accessStatus: 'pdf-unparsed', excerpt: '', title: '', detail: 'PDF full text was not downloaded.' }
    }

    const declared = response.headers && typeof response.headers.get === 'function'
      ? Number(response.headers.get('content-length'))
      : NaN

    if (Number.isFinite(declared) && declared > MAX_DECLARED_BYTES) {
      return { ok: false, url, accessStatus: 'too-large', excerpt: '', title: '', detail: `Declared ${declared} bytes exceeds the read limit.` }
    }

    const buffer = await readBoundedBody(response)

    if (buffer.length >= MAX_BYTES) {
      log.warn(`Truncated oversized page at ${buffer.length} bytes.`)
    }

    const text = buffer.toString('utf8')
    const stripped = stripMarkup(text)

    if (!stripped) {
      return { ok: false, url, accessStatus: 'empty', excerpt: '', title: extractTitle(text), detail: 'No readable text found.' }
    }

    return {
      ok: true,
      url,
      accessStatus: 'read',
      excerpt: stripped.slice(0, MAX_EXCERPT_CHARS),
      title: extractTitle(text),
      detail: '',
    }
  } catch (error) {
    if (error && error.name === 'AbortError') {
      if (signal && signal.aborted) {
        throw new Error('Reading was cancelled.')
      }

      return { ok: false, url, accessStatus: 'timeout', excerpt: '', title: '', detail: 'Timed out.' }
    }

    if (error instanceof TypeError) {
      return { ok: false, url, accessStatus: 'unreachable', excerpt: '', title: '', detail: 'Network request failed.' }
    }

    throw error
  } finally {
    clearTimeout(timer)

    if (signal) {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

module.exports = {
  assertSafeUrl,
  isBlockedHost,
  stripMarkup,
  fetchExcerpt,
  FETCH_TIMEOUT_MS,
  MAX_EXCERPT_CHARS,
}
