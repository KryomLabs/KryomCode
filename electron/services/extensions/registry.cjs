// Extension registry (Level 4A.2). Installed-extension storage
// under user data: validated manifests, bounded package copies,
// dev-directory links, and safe removal. New extensions install
// DISABLED — activation is always an explicit later step, so an
// install can never auto-execute untrusted code.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  MANIFEST_FILE,
  validateManifest,
} = require('./manifest.cjs')

const EXTENSIONS_DIR = 'kryomcode-extensions'
const REGISTRY_FILE = 'registry.json'
const REGISTRY_VERSION = 1

const MAX_PACKAGE_FILES = 200
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024
const MAX_FILE_BYTES = 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.js', '.json', '.md', '.txt'])

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('Extension storage is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

function extensionsRoot(baseDir) {
  return path.join(baseDir || defaultBaseDir(), EXTENSIONS_DIR)
}

function registryPath(baseDir) {
  return path.join(extensionsRoot(baseDir), REGISTRY_FILE)
}

function installedDir(baseDir, id, version) {
  return path.join(extensionsRoot(baseDir), 'installed', id, version)
}

function storageDir(baseDir, id) {
  return path.join(extensionsRoot(baseDir), 'storage', id)
}

function sanitizeRegistry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: REGISTRY_VERSION, extensions: {} }
  }

  const extensions = {}

  if (value.extensions && typeof value.extensions === 'object' && !Array.isArray(value.extensions)) {
    for (const [id, entry] of Object.entries(value.extensions)) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        entry.id !== id ||
        typeof entry.version !== 'string' ||
        typeof entry.path !== 'string' ||
        (entry.source !== 'local' && entry.source !== 'dev')
      ) {
        continue
      }

      extensions[id] = {
        id,
        version: entry.version.slice(0, 40),
        source: entry.source,
        path: entry.path.slice(0, 2000),
        enabled: entry.enabled === true,
        installedAt: typeof entry.installedAt === 'string' ? entry.installedAt.slice(0, 40) : null,
        manifest: entry.manifest && typeof entry.manifest === 'object' ? entry.manifest : null,
        lastError: typeof entry.lastError === 'string' ? entry.lastError.slice(0, 500) : null,
      }
    }
  }

  return { version: REGISTRY_VERSION, extensions }
}

async function readRegistry(baseDir) {
  try {
    const raw = await fs.readFile(registryPath(baseDir), 'utf8')

    return sanitizeRegistry(JSON.parse(raw))
  } catch {
    return sanitizeRegistry(null)
  }
}

async function writeRegistry(registry, baseDir) {
  const sanitized = sanitizeRegistry(registry)
  const filePath = registryPath(baseDir)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(sanitized, null, 2), 'utf8')

  return sanitized
}

async function readManifestFrom(dir) {
  let raw = null

  try {
    raw = await fs.readFile(path.join(dir, MANIFEST_FILE), 'utf8')
  } catch {
    throw new Error(`Extension package is missing ${MANIFEST_FILE}.`)
  }

  let parsed = null

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Extension manifest is not valid JSON.')
  }

  return validateManifest(parsed)
}

async function collectPackageFiles(dir, root = dir, out = [], total = { bytes: 0 }) {
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (out.length >= MAX_PACKAGE_FILES) {
      throw new Error(`Extension package exceeds ${MAX_PACKAGE_FILES} files.`)
    }

    const full = path.join(dir, entry.name)

    if (entry.isSymbolicLink()) {
      throw new Error(`Extension package contains a symlink (${entry.name}); symlinks are rejected.`)
    }

    if (entry.isDirectory()) {
      await collectPackageFiles(full, root, out, total)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()

      if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error(`Extension package contains a disallowed file type (${entry.name}).`)
      }

      const stat = await fs.stat(full)

      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`Extension file ${entry.name} exceeds the 1 MB cap.`)
      }

      total.bytes += stat.size

      if (total.bytes > MAX_PACKAGE_BYTES) {
        throw new Error('Extension package exceeds the 5 MB cap.')
      }

      out.push(path.relative(root, full))
    }
  }

  return out
}

async function copyPackage(sourceDir, destDir) {
  const files = await collectPackageFiles(sourceDir)

  await fs.mkdir(destDir, { recursive: true })

  for (const relative of files) {
    const from = path.join(sourceDir, relative)
    const to = path.join(destDir, relative)

    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.copyFile(from, to)
  }

  return files.length
}

async function removeDirSafe(dir, root) {
  const resolved = path.resolve(dir)
  const resolvedRoot = path.resolve(root)

  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Refusing to remove a path outside extension storage.')
  }

  await fs.rm(resolved, { recursive: true, force: true })
}

// Installs a local extension directory. Archives are intentionally
// unsupported (no extractor dependency): point at an extracted
// directory. `dev: true` links the directory instead of copying.
async function installExtension(sourceDir, { dev = false, baseDir } = {}) {
  if (typeof sourceDir !== 'string' || !sourceDir) {
    throw new Error('Extension source directory is required.')
  }

  const stat = await fs.stat(sourceDir).catch(() => null)

  if (!stat || !stat.isDirectory()) {
    throw new Error('Extension source must be an existing directory.')
  }

  const manifest = await readManifestFrom(sourceDir)
  const registry = await readRegistry(baseDir)

  if (registry.extensions[manifest.id]) {
    throw new Error(
      `Extension "${manifest.id}" is already installed. Uninstall it first to reinstall.`
    )
  }

  const entryFile = path.join(sourceDir, manifest.main)
  const entryStat = await fs.stat(entryFile).catch(() => null)

  if (!entryStat || !entryStat.isFile()) {
    throw new Error(`Extension entry "${manifest.main}" is missing.`)
  }

  let installPath = sourceDir

  if (!dev) {
    installPath = installedDir(baseDir || defaultBaseDir(), manifest.id, manifest.version)
    await copyPackage(sourceDir, installPath)
  }

  registry.extensions[manifest.id] = {
    id: manifest.id,
    version: manifest.version,
    source: dev ? 'dev' : 'local',
    path: installPath,
    enabled: false,
    installedAt: new Date().toISOString(),
    manifest,
    lastError: null,
  }

  await writeRegistry(registry, baseDir)

  return registry.extensions[manifest.id]
}

async function removeExtension(id, { baseDir } = {}) {
  const registry = await readRegistry(baseDir)
  const entry = registry.extensions[id]

  if (!entry) {
    throw new Error(`Extension "${String(id).slice(0, 80)}" is not installed.`)
  }

  const root = extensionsRoot(baseDir || defaultBaseDir())

  // Only ever remove paths inside our own storage root; dev links
  // remove the registration, never the developer's directory.
  if (entry.source === 'local') {
    await removeDirSafe(installedDir(baseDir || defaultBaseDir(), entry.id, entry.version), root)
  }

  await removeDirSafe(storageDir(baseDir || defaultBaseDir(), entry.id), root).catch(() => undefined)

  delete registry.extensions[id]
  await writeRegistry(registry, baseDir)

  return { id, removed: true }
}

async function getExtension(id, { baseDir } = {}) {
  const registry = await readRegistry(baseDir)
  const entry = registry.extensions[id]

  if (!entry) {
    throw new Error(`Extension "${String(id).slice(0, 80)}" is not installed.`)
  }

  return entry
}

async function listExtensions({ baseDir } = {}) {
  const registry = await readRegistry(baseDir)

  return {
    extensions: Object.values(registry.extensions).sort((a, b) =>
      a.id < b.id ? -1 : 1
    ),
  }
}

async function setExtensionEnabled(id, enabled, { baseDir } = {}) {
  const registry = await readRegistry(baseDir)
  const entry = registry.extensions[id]

  if (!entry) {
    throw new Error(`Extension "${String(id).slice(0, 80)}" is not installed.`)
  }

  entry.enabled = enabled === true

  await writeRegistry(registry, baseDir)

  return entry
}

async function setExtensionError(id, error, { baseDir } = {}) {
  const registry = await readRegistry(baseDir)
  const entry = registry.extensions[id]

  if (!entry) {
    throw new Error(`Extension "${String(id).slice(0, 80)}" is not installed.`)
  }

  entry.lastError = typeof error === 'string' && error ? error.slice(0, 500) : null

  await writeRegistry(registry, baseDir)

  return entry
}

module.exports = {
  EXTENSIONS_DIR,
  installExtension,
  removeExtension,
  getExtension,
  listExtensions,
  setExtensionEnabled,
  setExtensionError,
  storageDir,
}
