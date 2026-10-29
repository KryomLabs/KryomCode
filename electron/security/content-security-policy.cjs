// Renderer Content Security Policy builders. The production policy
// ships two ways — as the Content-Security-Policy header on every
// kryom:// response and as the meta tag Vite injects into the built
// index.html — from this single source of truth. Development gets its
// own clearly scoped policy so Vite HMR keeps working.

// Monaco is bundled locally (see src/utils/monaco-setup.ts, which
// configures the @monaco-editor/react loader with the installed
// monaco-editor package), so the renderer loads no remote resources:
// every directive below is same-origin plus the narrow exceptions
// Monaco itself needs (inline <style> injection, data:/blob: assets).
const { WS_DEV_ORIGIN } = require('./renderer-urls.cjs')

function buildProductionCsp() {
  return [
    "default-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "script-src 'self'",
    // Monaco injects its theme and layout rules as inline <style>
    // elements at runtime; no inline <script> is permitted.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The renderer performs no fetches of its own; every backend call
    // crosses the IPC bridge. 'self' covers same-origin worker and
    // module loads only.
    "connect-src 'self'",
    "worker-src 'self' blob:",
  ].join('; ')
}

// Development: the production policy plus exactly what Vite HMR
// needs — inline bootstrap scripts and the HMR websocket to the
// configured dev server. No 'unsafe-eval', no wildcard hosts.
function buildDevelopmentCsp() {
  return [
    "default-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${WS_DEV_ORIGIN}`,
    "worker-src 'self' blob:",
  ].join('; ')
}

module.exports = {
  buildProductionCsp,
  buildDevelopmentCsp,
}
