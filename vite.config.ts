import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildProductionCsp, buildDevelopmentCsp } = require(
  './electron/security/content-security-policy.cjs'
) as {
  buildProductionCsp: () => string
  buildDevelopmentCsp: () => string
}

// Injects the renderer CSP meta tag: the scoped development policy
// (HMR-safe) while serving, the restrictive production policy into
// the built index.html. Both come from the shared security module so
// the header served over kryom:// and the meta tag cannot drift.
function kryomCsp(): Plugin {
  return {
    name: 'kryom-csp',
    transformIndexHtml(html, ctx) {
      const policy = ctx.server
        ? buildDevelopmentCsp()
        : buildProductionCsp()
      const tag =
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`

      return html.replace('</head>', `    ${tag}\n  </head>`)
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), kryomCsp()],
})
