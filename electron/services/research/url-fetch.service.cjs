// Safe URL retrieval for research sources. Treats every fetched page
// as untrusted data: only public http(s) destinations are dialed,
// redirects are followed manually with each target validated BEFORE
// the next request is sent, DNS answers are checked address by
// address, and the connection is pinned to the validated addresses so
// a rebinding hostname cannot swap the target mid-request. Responses
// are size- and time-bounded, markup is stripped, and short excerpts
// only are returned. Never executes retrieved content.
const dns = require('node:dns')
const net = require('node:net')

const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('research-fetch')

const FETCH_TIMEOUT_MS = 15000
const MAX_BYTES = 512 * 1024
const MAX_EXCERPT_CHARS = 2000
const MAX_DECLARED_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 5

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

// ---------------------------------------------------------------------------
// Address policy: only global-unicast destinations are dialable.
// ---------------------------------------------------------------------------

function parseIPv4(text) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(
    String(text || '').trim()
  )

  if (!match) {
    return null
  }

  const parts = match.slice(1).map(Number)

  if (parts.some((part) => part > 255)) {
    return null
  }

  return parts[0] * 16777216 + parts[1] * 65536 + parts[2] * 256 + parts[3]
}

const BLOCKED_V4_RANGES = [
  ['0.0.0.0', '0.255.255.255'], // software scope ("this host")
  ['10.0.0.0', '10.255.255.255'], // private
  ['100.64.0.0', '100.127.255.255'], // carrier-grade NAT
  ['127.0.0.0', '127.255.255.255'], // loopback
  ['169.254.0.0', '169.254.255.255'], // link-local + cloud metadata
  ['172.16.0.0', '172.31.255.255'], // private
  ['192.0.0.0', '192.0.0.255'], // IETF protocol assignments
  ['192.0.2.0', '192.0.2.255'], // documentation (TEST-NET-1)
  ['192.168.0.0', '192.168.255.255'], // private
  ['198.18.0.0', '198.19.255.255'], // benchmarking
  ['198.51.100.0', '198.51.100.255'], // documentation (TEST-NET-2)
  ['203.0.113.0', '203.0.113.255'], // documentation (TEST-NET-3)
  ['224.0.0.0', '255.255.255.255'], // multicast + reserved
].map(([first, last]) => [parseIPv4(first), parseIPv4(last)])

function isBlockedIPv4(value) {
  return BLOCKED_V4_RANGES.some(
    ([first, last]) => value >= first && value <= last
  )
}

function parseIPv6(text) {
  const input = String(text || '').trim()

  if (!input || input.includes('%') || /[^0-9a-fA-F:.]/.test(input)) {
    return null
  }

  const halves = input.split('::')

  if (halves.length > 2) {
    return null
  }

  const toGroups = (part) => (part === '' ? [] : part.split(':'))

  // An embedded IPv4 tail ('::ffff:1.2.3.4') is valid only as the
  // final group and occupies the last two hextets.
  const expandEmbedded = (groups, isFinal) => {
    if (!groups.some((group) => group.includes('.'))) {
      return groups
    }

    if (!isFinal || groups.slice(0, -1).some((group) => group.includes('.'))) {
      return null
    }

    const quad = parseIPv4(groups[groups.length - 1])

    if (quad === null) {
      return null
    }

    return [
      ...groups.slice(0, -1),
      Math.floor(quad / 65536).toString(16),
      (quad % 65536).toString(16),
    ]
  }

  const head = expandEmbedded(toGroups(halves[0]), halves.length === 1)

  if (head === null) {
    return null
  }

  const tail = expandEmbedded(halves.length === 2 ? toGroups(halves[1]) : [], true)

  if (tail === null) {
    return null
  }

  let groups = null

  if (halves.length === 1) {
    if (head.length !== 8) {
      return null
    }

    groups = head
  } else {
    if (head.length + tail.length > 7) {
      return null
    }

    groups = [
      ...head,
      ...new Array(8 - head.length - tail.length).fill('0'),
      ...tail,
    ]
  }

  const bytes = []

  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null
    }

    const value = parseInt(group, 16)

    bytes.push((value >> 8) & 0xff, value & 0xff)
  }

  return bytes
}

function allZero(bytes, from, to) {
  for (let index = from; index < to; index += 1) {
    if (bytes[index] !== 0) {
      return false
    }
  }

  return true
}

function bytesToIPv4(bytes) {
  return bytes[0] * 16777216 + bytes[1] * 65536 + bytes[2] * 256 + bytes[3]
}

function isBlockedIPv6(bytes) {
  // IPv4-mapped (::ffff:0:0/96): the embedded address decides.
  if (allZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedIPv4(bytesToIPv4(bytes.slice(12, 16)))
  }

  // NAT64 (well-known 64:ff9b::/96 and local-use 64:ff9b:1::/48):
  // the last 32 bits are the target IPv4 address.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    ((bytes[4] === 0x00 && bytes[5] === 0x00 && allZero(bytes, 6, 12)) ||
      (bytes[4] === 0x00 && bytes[5] === 0x01))
  ) {
    return isBlockedIPv4(bytesToIPv4(bytes.slice(12, 16)))
  }

  // 6to4 (2002::/16): bytes 2-5 carry the target IPv4 address.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isBlockedIPv4(bytesToIPv4(bytes.slice(2, 6)))
  }

  if (allZero(bytes, 0, 16)) {
    return true // unspecified
  }

  if (allZero(bytes, 0, 15) && bytes[15] === 0x01) {
    return true // loopback
  }

  if (allZero(bytes, 0, 12)) {
    return true // deprecated IPv4-compatible range
  }

  if (bytes[0] === 0xff) {
    return true // multicast ff00::/8
  }

  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) {
    return true // link-local fe80::/10
  }

  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) {
    return true // deprecated site-local fec0::/10
  }

  if ((bytes[0] & 0xfe) === 0xfc) {
    return true // unique-local fc00::/7
  }

  if (bytes[0] === 0x01 && allZero(bytes, 1, 8)) {
    return true // discard 100::/64
  }

  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] === 0x00 && bytes[3] === 0x00) {
      return true // Teredo 2001::/32: embeds IPv4 opaquely, blocked whole
    }

    // ORCHID 2001:10::/28 and 2001:20::/28: the /28 fixes nibbles
    // "2001:1x", so the third group's high byte is 0x00 and its low
    // byte carries 0x1x/0x2x.
    if (
      bytes[2] === 0x00 &&
      ((bytes[3] & 0xf0) === 0x10 || (bytes[3] & 0xf0) === 0x20)
    ) {
      return true
    }

    // Documentation 2001:db8::/32: group 0x0db8 is bytes 0x0d, 0xb8.
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) {
      return true
    }
  }

  return false
}

// True for prohibited IP literals. Non-literal input is not an IP
// verdict at all: hostname policy lives in isBlockedHost (names) and
// DNS validation (resolved addresses), so this returns false there.
function isBlockedIp(value) {
  const bare = String(value || '')
    .trim()
    .replace(/^\[(.*)\]$/, '$1')
  const family = net.isIP(bare)

  if (family === 4) {
    const parsed = parseIPv4(bare)

    return parsed === null ? true : isBlockedIPv4(parsed)
  }

  if (family === 6) {
    const parsed = parseIPv6(bare)

    return parsed === null ? true : isBlockedIPv6(parsed)
  }

  return false
}

// Canonicalizes a hostname the way the URL parser sees it, so IPv4
// spelled as hex, octal, or a bare integer ('0x7f.0.0.1',
// '2130706433') cannot dodge the address table.
function canonicalHostForCheck(hostname) {
  const raw = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')

  if (!raw) {
    return ''
  }

  const needsBrackets = raw.includes(':') && !raw.startsWith('[')

  try {
    const parsed = new URL(`http://${needsBrackets ? `[${raw}]` : raw}/`)

    return parsed.hostname
      .toLowerCase()
      .replace(/^\[(.*)\]$/, '$1')
      .replace(/\.$/, '')
  } catch {
    return raw.replace(/^\[(.*)\]$/, '$1')
  }
}

function isBlockedHost(hostname) {
  const host = canonicalHostForCheck(hostname)

  if (!host) {
    return true
  }

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true
  }

  return net.isIP(host) === 0 ? false : isBlockedIp(host)
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

// ---------------------------------------------------------------------------
// DNS validation + connection pinning (anti-rebinding).
// ---------------------------------------------------------------------------

function defaultLookup(hostname) {
  return dns.promises.lookup(hostname, { all: true })
}

// Internal hop failure. Carries the honest accessStatus so redirect
// hops degrade to results while the initial hop keeps its existing
// throw contract for invalid URLs.
class HopError extends Error {
  constructor(accessStatus, detail) {
    super(detail)
    this.accessStatus = accessStatus
  }
}

function lookupWithDeadline(lookupImpl, hostname, ms) {
  if (!(ms > 0)) {
    const expired = new Error('Timed out.')

    expired.name = 'AbortError'

    return Promise.reject(expired)
  }

  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const expired = new Error('Timed out.')

      expired.name = 'AbortError'
      reject(expired)
    }, ms)
  })

  return Promise.race([lookupImpl(hostname), timeout]).finally(() => {
    clearTimeout(timer)
  })
}

// Resolves a validated URL's host and rejects unless EVERY returned
// address is dialable. Literal IPs skip resolution (nothing to
// rebind) but were already table-checked by assertSafeUrl.
async function resolveHopAddresses(url, { lookupImpl, deadline, signal }) {
  const hostname = new URL(url).hostname
  const bare = hostname.replace(/^\[(.*)\]$/, '$1')

  if (net.isIP(bare) !== 0) {
    return []
  }

  if (signal && signal.aborted) {
    throw new Error('Reading was cancelled.')
  }

  let records = null

  try {
    records = await lookupWithDeadline(
      lookupImpl,
      hostname,
      deadline - Date.now()
    )
  } catch (error) {
    if (signal && signal.aborted) {
      throw new Error('Reading was cancelled.')
    }

    if (error && error.name === 'AbortError') {
      throw new HopError('timeout', 'Timed out.')
    }

    throw new HopError('unreachable', 'The host name could not be resolved.')
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new HopError('unreachable', 'The host name could not be resolved.')
  }

  for (const record of records) {
    const address = record && record.address

    if (!address || isBlockedIp(address)) {
      throw new HopError(
        'blocked',
        'Local-network and internal addresses are blocked.'
      )
    }
  }

  return records.map((record) => ({
    address: record.address,
    family: Number(record.family) === 6 ? 6 : 4,
  }))
}

// dns.lookup-compatible resolver serving only validated addresses.
// Plugged into the socket layer so the address checked above is the
// address connected to, even if the hostname's DNS answers change
// between validation and connect (DNS rebinding).
function buildPinnedLookup(addresses) {
  const pool = addresses.map((entry) => ({
    address: entry.address,
    family: Number(entry.family) === 6 ? 6 : 4,
  }))

  return function pinnedLookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }

    const want = Number((options && options.family) || 0)
    const matching = want === 0 ? pool : pool.filter((entry) => entry.family === want)

    if (matching.length === 0) {
      const error = new Error(`getaddrinfo ENOTFOUND ${hostname}`)

      error.code = 'ENOTFOUND'
      error.syscall = 'getaddrinfo'
      error.hostname = hostname
      callback(error)

      return
    }

    if (options && options.all) {
      callback(
        null,
        matching.map((entry) => ({ address: entry.address, family: entry.family }))
      )
    } else {
      callback(null, matching[0].address, matching[0].family)
    }
  }
}

let undiciModule = null
let undiciMissingLogged = false

function loadUndici() {
  if (undiciModule) {
    return undiciModule
  }

  try {
    undiciModule = require('undici')
  } catch {
    undiciModule = null
  }

  if ((!undiciModule || typeof undiciModule.Agent !== 'function') && !undiciMissingLogged) {
    undiciMissingLogged = true
    log.warn('Connection pinning is unavailable; DNS is validated but rebinding is possible.')
  }

  return undiciModule && typeof undiciModule.Agent === 'function'
    ? undiciModule
    : null
}

// Builds a same-copy undici fetch + agent whose sockets resolve only
// to validated addresses. Hostname, SNI, and Host header still come
// from the URL; only address selection is pinned. Returns null when
// undici is unavailable (caller falls back to unpinned fetch).
function buildPinnedTransport(addresses) {
  const undici = loadUndici()

  if (!undici) {
    return null
  }

  try {
    return {
      fetch: undici.fetch,
      agent: new undici.Agent({
        connect: { lookup: buildPinnedLookup(addresses) },
      }),
    }
  } catch (error) {
    log.warn(`Connection pinning failed: ${error.message}`)

    return null
  }
}

function closeTransport(transport) {
  if (transport && transport.agent && typeof transport.agent.close === 'function') {
    transport.agent.close().catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Body handling (unchanged bounds).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fetch with manual, pre-validated redirects.
// ---------------------------------------------------------------------------

function redirectKey(url) {
  try {
    return new URL(url).toString()
  } catch {
    return String(url)
  }
}

function readLocation(response, currentUrl) {
  const headers = response && response.headers
  const raw =
    headers && typeof headers.get === 'function'
      ? headers.get('location')
      : null

  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, detail: 'Redirect without a location.' }
  }

  try {
    return { ok: true, url: new URL(raw.trim(), currentUrl).toString() }
  } catch {
    return { ok: false, detail: 'Redirect location is invalid.' }
  }
}

async function cancelBody(response) {
  try {
    if (response && response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel()
    }
  } catch {
    // Best effort: the connection is discarded with its transport.
  }
}

function failure(url, accessStatus, detail) {
  return { ok: false, url, accessStatus, excerpt: '', title: '', detail }
}

async function readFinalResponse(url, response) {
  if (response.status === 401 || response.status === 403 || response.status === 402) {
    return failure(url, 'paywalled', `HTTP ${response.status}`)
  }

  if (response.status === 404 || response.status === 410) {
    return failure(url, 'missing', `HTTP ${response.status}`)
  }

  if (!response.ok) {
    return failure(url, 'unreachable', `HTTP ${response.status}`)
  }

  const contentType = response.headers && typeof response.headers.get === 'function'
    ? String(response.headers.get('content-type') || '')
    : ''

  if (/application\/pdf/i.test(contentType)) {
    return failure(url, 'pdf-unparsed', 'PDF full text was not downloaded.')
  }

  const declared = response.headers && typeof response.headers.get === 'function'
    ? Number(response.headers.get('content-length'))
    : NaN

  if (Number.isFinite(declared) && declared > MAX_DECLARED_BYTES) {
    return failure(url, 'too-large', `Declared ${declared} bytes exceeds the read limit.`)
  }

  const buffer = await readBoundedBody(response)

  if (buffer.length >= MAX_BYTES) {
    log.warn(`Truncated oversized page at ${buffer.length} bytes.`)
  }

  const text = buffer.toString('utf8')
  const stripped = stripMarkup(text)

  if (!stripped) {
    return { ...failure(url, 'empty', 'No readable text found.'), title: extractTitle(text) }
  }

  return {
    ok: true,
    url,
    accessStatus: 'read',
    excerpt: stripped.slice(0, MAX_EXCERPT_CHARS),
    title: extractTitle(text),
    detail: '',
  }
}

// Fetches one page and returns a bounded excerpt. Redirects are never
// followed by the transport: each hop is requested with
// redirect:'manual', and the next target is fully validated (scheme,
// address policy, DNS) before its request is sent. response.url is
// never consulted. Returns an object with ok:false instead of
// throwing for HTTP-level failures so the caller can record
// per-source access status honestly.
async function fetchExcerpt(rawUrl, { fetchImpl = fetch, signal, timeoutMs = FETCH_TIMEOUT_MS, lookupImpl = defaultLookup } = {}) {
  const startUrl = assertSafeUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const deadline = Date.now() + timeoutMs

  const onAbort = () => controller.abort()

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      throw new Error('Reading was cancelled.')
    }

    signal.addEventListener('abort', onAbort, { once: true })
  }

  const finish = () => {
    clearTimeout(timer)

    if (signal) {
      signal.removeEventListener('abort', onAbort)
    }
  }

  try {
    let current = startUrl
    const seen = new Set([redirectKey(startUrl)])

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let url = null
      let addresses = []
      let transport = null

      try {
        url = assertSafeUrl(current)
        addresses = await resolveHopAddresses(url, {
          lookupImpl,
          deadline,
          signal: signal || null,
        })

        // Pinning applies to the built-in transport only; injected
        // transports (tests) resolve through their own stack.
        if (fetchImpl === fetch && addresses.length > 0) {
          transport = buildPinnedTransport(addresses)
        }
      } catch (error) {
        if (hop === 0 && !(error instanceof HopError)) {
          throw error
        }

        if (error instanceof HopError) {
          return failure(startUrl, error.accessStatus, error.message)
        }

        return failure(startUrl, 'blocked', error.message)
      }

      const runFetch = transport ? transport.fetch : fetchImpl
      let response = null

      try {
        response = await runFetch(url, {
          headers: { 'User-Agent': 'KryomCode-Research/0.1', Accept: 'text/html,text/plain,application/pdf;q=0.5' },
          signal: controller.signal,
          redirect: 'manual',
          ...(transport ? { dispatcher: transport.agent } : {}),
        })
      } catch (error) {
        closeTransport(transport)

        if (error && error.name === 'AbortError') {
          if (signal && signal.aborted) {
            throw new Error('Reading was cancelled.')
          }

          return failure(startUrl, 'timeout', 'Timed out.')
        }

        if (error instanceof TypeError) {
          return failure(startUrl, 'unreachable', 'Network request failed.')
        }

        throw error
      }

      if (!REDIRECT_STATUSES.has(response.status)) {
        try {
          return await readFinalResponse(startUrl, response)
        } finally {
          closeTransport(transport)
        }
      }

      await cancelBody(response)
      closeTransport(transport)

      if (hop >= MAX_REDIRECTS) {
        return failure(startUrl, 'blocked', `Too many redirects (over ${MAX_REDIRECTS}).`)
      }

      const next = readLocation(response, url)

      if (!next.ok) {
        return failure(startUrl, 'unreachable', next.detail)
      }

      // Scheme/host policy is enforced by next hop's assertSafeUrl
      // before any request; the loop check needs only a canonical key.
      const key = redirectKey(next.url)

      if (seen.has(key)) {
        return failure(startUrl, 'blocked', 'Redirect loop detected.')
      }

      seen.add(key)
      current = next.url
    }

    return failure(startUrl, 'blocked', `Too many redirects (over ${MAX_REDIRECTS}).`)
  } finally {
    finish()
  }
}

module.exports = {
  assertSafeUrl,
  isBlockedHost,
  isBlockedIp,
  stripMarkup,
  fetchExcerpt,
  buildPinnedLookup,
  buildPinnedTransport,
  FETCH_TIMEOUT_MS,
  MAX_EXCERPT_CHARS,
  MAX_REDIRECTS,
}
