const fs = require('node:fs/promises')
const path = require('node:path')

const MAX_MANIFEST_SIZE = 200 * 1024

// Reads the workspace package manifest without executing anything.
// Returns dependency and script metadata used by the project analyzer.
// Missing or invalid manifests yield empty metadata, never an exception,
// so intelligence works for non-Node projects too.

async function readManifest(root) {
  const manifestPath = path.join(root, 'package.json')

  try {
    const stat = await fs.stat(manifestPath)

    if (!stat.isFile() || stat.size > MAX_MANIFEST_SIZE) {
      return null
    }

    return JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

function pickKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const output = {}

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      output[key] = entry.slice(0, 200)
    }
  }

  return output
}

async function analyzeDependencies(root) {
  const manifest = await readManifest(root)

  if (!manifest) {
    return {
      hasManifest: false,
      name: null,
      version: null,
      description: null,
      scripts: {},
      dependencies: {},
      devDependencies: {},
      frameworks: [],
    }
  }

  const dependencies = pickKeys(manifest.dependencies)
  const devDependencies = pickKeys(manifest.devDependencies)
  const scripts = pickKeys(manifest.scripts)
  const all = { ...dependencies, ...devDependencies }
  const frameworks = []

  if (all.react) frameworks.push('react')
  if (all.vue) frameworks.push('vue')
  if (all.svelte) frameworks.push('svelte')
  if (all.next) frameworks.push('next')
  if (all.vite) frameworks.push('vite')
  if (all.electron) frameworks.push('electron')
  if (all.typescript) frameworks.push('typescript')
  if (all.express || all.fastify || all.koa) frameworks.push('node-server')

  return {
    hasManifest: true,
    name: typeof manifest.name === 'string' ? manifest.name.slice(0, 200) : null,
    version: typeof manifest.version === 'string' ? manifest.version.slice(0, 50) : null,
    description:
      typeof manifest.description === 'string'
        ? manifest.description.slice(0, 500)
        : null,
    scripts,
    dependencies,
    devDependencies,
    frameworks,
  }
}

module.exports = {
  analyzeDependencies,
}
