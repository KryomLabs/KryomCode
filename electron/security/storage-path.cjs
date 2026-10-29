// Contained application storage inside the workspace (`.kryom/`).
// Unlike resolveWorkspacePath — which accepts non-canonical aliases
// for user files — storage paths are app-controlled fixed names, so
// ANY link in the chain is suspicious: every existing component is
// lstat-checked for symlinks, and every level is realpath-compared so
// Windows junctions and reparse points (which lstat reports as plain
// directories) cannot escape detection either. Writes land via
// temp-file + rename, which replaces a planted final-component link
// instead of following it.
//
// Residual race: an attacker with concurrent write access could swap
// a component between validation and use (TOCTOU). Pre-planted links
// — the realistic cloned-repo case — are fully defeated because the
// plants exist before validation runs.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  isInsideScope,
  isSamePath,
} = require('../services/workspace/workspace.service.cjs')

function assertSafeSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('Invalid storage path.')
  }

  for (const segment of segments) {
    if (typeof segment !== 'string' || !segment) {
      throw new Error('Invalid storage path.')
    }

    if (
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      path.isAbsolute(segment)
    ) {
      throw new Error('Invalid storage path.')
    }

    // ADS streams, reserved characters, and Windows' trailing
    // dot/space stripping must not alias two names to one file.
    if (
      process.platform === 'win32' &&
      (/[<>:"|?*\x00-\x1f]/.test(segment) || /[. ]$/.test(segment))
    ) {
      throw new Error('Invalid storage path.')
    }
  }

  return segments
}

// Walks root/segments level by level. Every existing component must
// be link-free and canonicalize exactly where expected; the first
// missing component and everything below it form the missing tail.
// Returns { path, exists, root } with path canonical when fully
// existing, logical-under-canonical-parent otherwise.
async function resolveStoragePath(root, segments) {
  assertSafeSegments(segments)

  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('Invalid storage root.')
  }

  const canonRoot = await fs.realpath(root)
  let logical = root
  let canonical = canonRoot
  const missing = []
  let sawMissing = false

  for (const segment of segments) {
    logical = path.join(logical, segment)

    if (sawMissing) {
      missing.push(segment)
      continue
    }

    let stat = null

    try {
      stat = await fs.lstat(logical)
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        sawMissing = true
        missing.push(segment)
        continue
      }

      throw error
    }

    if (stat.isSymbolicLink()) {
      throw new Error('Symbolic links are not followed.')
    }

    const real = await fs.realpath(logical)

    if (!isSamePath(real, path.join(canonical, segment))) {
      throw new Error('Storage path escapes its root.')
    }

    canonical = real
  }

  if (!isInsideScope(canonRoot, canonical)) {
    throw new Error('Storage path escapes its root.')
  }

  const target = missing.length > 0
    ? path.join(canonical, ...missing)
    : canonical

  if (missing.length > 0 && !isInsideScope(canonRoot, target)) {
    throw new Error('Storage path escapes its root.')
  }

  return { path: target, exists: missing.length === 0, root: canonRoot }
}

// Creates dir segments one level at a time (never recursive, so a
// planted link can never be created through or followed) and
// validates every level. Returns the canonical directory.
async function ensureStorageDir(root, segments) {
  assertSafeSegments(segments)

  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('Invalid storage root.')
  }

  const canonRoot = await fs.realpath(root)
  let logical = root
  let canonical = canonRoot

  for (const segment of segments) {
    logical = path.join(logical, segment)

    try {
      await fs.mkdir(logical)
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error
      }
    }

    const stat = await fs.lstat(logical)

    if (stat.isSymbolicLink()) {
      throw new Error('Symbolic links are not followed.')
    }

    if (!stat.isDirectory()) {
      throw new Error('Storage path is not a directory.')
    }

    const real = await fs.realpath(logical)

    if (!isSamePath(real, path.join(canonical, segment))) {
      throw new Error('Storage path escapes its root.')
    }

    canonical = real
  }

  if (!isInsideScope(canonRoot, canonical)) {
    throw new Error('Storage path escapes its root.')
  }

  return canonical
}

// Windows briefly locks fresh files for antivirus/indexer scans,
// which surfaces as a transient EPERM on rename. Retry those (and
// only those) a bounded number of times; anything else fails fast.
async function renameWithRetry(tmp, target, attempts = 5) {
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.rename(tmp, target)

      return
    } catch (error) {
      lastError = error

      if (
        error &&
        (error.code === 'EPERM' || error.code === 'EACCES') &&
        attempt < attempts
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt))
        continue
      }

      throw error
    }
  }

  throw lastError
}

// Writes via temp-file + rename: rename replaces a planted
// final-component symlink instead of following it, and readers never
// observe a torn file. Temp files carry owner-only permissions.
async function writeStorageFile(root, segments, data, encoding = 'utf8') {
  assertSafeSegments(segments)

  const dir = await ensureStorageDir(root, segments.slice(0, -1))
  const name = segments[segments.length - 1]
  const tmp = path.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
  )

  await fs.writeFile(tmp, data, { encoding, flag: 'wx', mode: 0o600 })

  try {
    await renameWithRetry(tmp, path.join(dir, name))
  } catch (error) {
    await fs.unlink(tmp).catch(() => undefined)
    throw error
  }

  return path.join(dir, name)
}

async function readStorageFile(root, segments, encoding = 'utf8') {
  const { path: file, exists } = await resolveStoragePath(root, segments)

  if (!exists) {
    return { found: false, data: null }
  }

  const stat = await fs.lstat(file)

  if (stat.isSymbolicLink()) {
    throw new Error('Symbolic links are not followed.')
  }

  if (!stat.isFile()) {
    throw new Error('Storage path is not a file.')
  }

  return { found: true, data: await fs.readFile(file, encoding) }
}

// Lists validated regular files in a storage directory. Suspicious
// or unreadable entries are skipped; explicit reads of them still
// fail loudly through readStorageFile.
async function listStorageFiles(root, segments) {
  const dir = await ensureStorageDir(root, segments)
  const entries = await fs.readdir(dir)
  const files = []

  for (const entry of entries) {
    try {
      const { path: file, exists } = await resolveStoragePath(root, [
        ...segments,
        entry,
      ])

      if (!exists) {
        continue
      }

      const stat = await fs.lstat(file)

      if (stat.isSymbolicLink() || !stat.isFile()) {
        continue
      }

      files.push({ name: entry, path: file })
    } catch {
      continue
    }
  }

  return files
}

module.exports = {
  assertSafeSegments,
  resolveStoragePath,
  ensureStorageDir,
  writeStorageFile,
  readStorageFile,
  listStorageFiles,
}
