// Serves the packaged renderer over the private app scheme. Only
// files inside the bundled dist folder are reachable; traversal,
// wrong hosts, credentials, and non-GET methods get a bare 404/405.

const fs = require('node:fs/promises')
const path = require('node:path')
const { APP_HOST, APP_SCHEME } = require('./renderer-urls.cjs')

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.eot': 'application/vnd.ms-fontobject',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function mimeFor(filePath) {
  return (
    MIME_TYPES[path.extname(filePath).toLowerCase()] ||
    'application/octet-stream'
  )
}

// Resolves a request pathname to a file inside root, or null when it
// escapes, names the root itself, or is otherwise unusable.
function resolveInside(root, pathname) {
  let decoded = null

  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  // Backslashes are separators on Windows but not in URLs; normalize
  // them before collapsing dot segments so %5C cannot smuggle ../ out.
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/'))
  const relative = normalized.replace(/^\/+/, '')

  if (!relative) {
    return null
  }

  const candidate = path.normalize(path.join(root, relative))
  const rel = path.relative(root, candidate)

  if (
    !rel ||
    rel === '..' ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  ) {
    return null
  }

  return candidate
}

function createAppProtocolHandler({ distDir, contentSecurityPolicy }) {
  const root = path.resolve(distDir)

  if (
    typeof contentSecurityPolicy !== 'string' ||
    !contentSecurityPolicy
  ) {
    throw new Error('createAppProtocolHandler requires a CSP string.')
  }

  return async function handleAppProtocol(request) {
    const headers = {
      'Content-Security-Policy': contentSecurityPolicy,
      'X-Content-Type-Options': 'nosniff',
      // Local reads are cheap and the entry document is not
      // content-hashed: never let a stale bundle survive an update.
      'Cache-Control': 'no-store',
    }

    if (!request || request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers })
    }

    let parsed = null

    try {
      parsed = new URL(request.url)
    } catch {
      return new Response('Not found', { status: 404, headers })
    }

    if (
      parsed.protocol !== `${APP_SCHEME}:` ||
      parsed.hostname !== APP_HOST ||
      parsed.port !== '' ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      return new Response('Not found', { status: 404, headers })
    }

    const pathname = parsed.pathname === '/' ? '/index.html' : parsed.pathname
    const filePath = resolveInside(root, pathname)

    if (!filePath) {
      return new Response('Not found', { status: 404, headers })
    }

    try {
      const body = await fs.readFile(filePath)

      return new Response(body, {
        status: 200,
        headers: { ...headers, 'Content-Type': mimeFor(filePath) },
      })
    } catch {
      return new Response('Not found', { status: 404, headers })
    }
  }
}

module.exports = {
  createAppProtocolHandler,
}
