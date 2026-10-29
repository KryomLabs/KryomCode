// Single source of truth for which URLs the app's own renderer may
// occupy. Navigation guards and IPC sender checks share these parsed
// validators so string-prefix bypasses (userinfo, sibling hosts or
// ports, sibling schemes, arbitrary file paths) cannot slip through.

// Exact configured Vite origin. The dev script binds 127.0.0.1 with
// --strictPort, so host and port never drift.
const DEV_ORIGIN = 'http://127.0.0.1:5173'

// WebSocket twin of the dev origin for the HMR client.
const WS_DEV_ORIGIN = 'ws://127.0.0.1:5173'

// Packaged renderer origin. Production loads over this private scheme
// (protocol.handle serves only the bundled dist folder), never file:,
// so arbitrary local files are unreachable and the origin is stable
// for CSP 'self' and frame checks.
const APP_SCHEME = 'kryom'
const APP_HOST = 'app'
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
const APP_ENTRY_PATH = '/index.html'
const APP_ENTRY_URL = `${APP_ORIGIN}${APP_ENTRY_PATH}`

function parseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  try {
    return new URL(value)
  } catch {
    return null
  }
}

function hasCredentials(parsed) {
  return parsed.username !== '' || parsed.password !== ''
}

// Development: any path on exactly the configured origin. Origin
// comparison (not a prefix match) rejects userinfo tricks such as
// http://127.0.0.1:5173@attacker.example/ (whose host is
// attacker.example) as well as sibling hosts, ports, and schemes.
function isDevAppUrl(value, devOrigin = DEV_ORIGIN) {
  const parsed = parseUrl(value)
  const expected = parseUrl(devOrigin)

  if (!parsed || !expected || hasCredentials(parsed)) {
    return false
  }

  return parsed.origin === expected.origin
}

// Production: only the packaged entry document. Query and fragment
// are ignored (the protocol handler strips them); every other path,
// host, port, or scheme — including every file: URL — fails.
function isProdEntryUrl(value) {
  const parsed = parseUrl(value)

  if (!parsed || hasCredentials(parsed)) {
    return false
  }

  return (
    parsed.protocol === `${APP_SCHEME}:` &&
    parsed.hostname === APP_HOST &&
    parsed.port === '' &&
    parsed.pathname === APP_ENTRY_PATH
  )
}

// Main-frame policy shared by navigation guards and IPC sender
// checks. Development also accepts the packaged entry so the
// no-dev-server fallback keeps working.
function isAllowedMainFrameUrl(value, options = {}) {
  const packaged = options.packaged === true
  const devOrigin = options.devOrigin || DEV_ORIGIN

  if (packaged) {
    return isProdEntryUrl(value)
  }

  return isDevAppUrl(value, devOrigin) || isProdEntryUrl(value)
}

module.exports = {
  DEV_ORIGIN,
  WS_DEV_ORIGIN,
  APP_SCHEME,
  APP_HOST,
  APP_ORIGIN,
  APP_ENTRY_PATH,
  APP_ENTRY_URL,
  isDevAppUrl,
  isProdEntryUrl,
  isAllowedMainFrameUrl,
}
