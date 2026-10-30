// Persistent bounded code index (Level 3C.1). The project analyzer
// rebuilds a flat listing on every call; this module persists file
// fingerprints under `.kryom/index/manifest.json` so repeated
// intelligence work reuses them, refreshes incrementally, and —
// critically — never silently serves stale content: every entry
// carries its fingerprint, and readers report changed files as stale
// instead of trusting the stored copy.
//
// Read-only toward project sources; writes only `.kryom/`. Generated
// and irrelevant directories are never indexed. Context selection is
// token-budget aware: callers get ranked, deduplicated excerpts that
// fit an explicit character budget.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
  isInsideScope,
} = require('../workspace/workspace.service.cjs')
const {
  ensureStorageDir,
  writeStorageFile,
  readStorageFile,
} = require('../../security/storage-path.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('code-index')

const INDEX_SEGMENTS = ['.kryom', 'index']
const MANIFEST_FILE = 'manifest.json'
const INDEX_VERSION = 1

const MAX_INDEX_FILES = 1000
const MAX_DEPTH = 8
const MAX_HASH_BYTES = 256 * 1024
const MAX_EXCERPT_BYTES = 8 * 1024
const MAX_CONTEXT_CHARS = 24000
const MAX_RESULTS = 50

// Directories that never enter the index: dependencies, VCS state,
// build output, coverage, caches, and our own storage.
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.kryom',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.nyc_output',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.idea',
  '.vscode',
])

const IGNORED_BASENAMES = new Set(['.DS_Store'])

function isSkippedDir(name) {
  return IGNORED_DIRS.has(name)
}

function isSkippedFile(name) {
  return (
    IGNORED_BASENAMES.has(name) ||
    name.startsWith('.env')
  )
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function openRoot() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  return root
}

async function fingerprintFile(fullPath, stat) {
  const base = {
    size: stat.size,
    mtimeMs: Math.floor(stat.mtimeMs),
    sha256: null,
    hashed: false,
  }

  if (stat.size > MAX_HASH_BYTES) {
    return base
  }

  try {
    const buffer = await fs.readFile(fullPath)

    if (buffer.includes(0)) {
      return { ...base, binary: true }
    }

    return { ...base, sha256: sha256Hex(buffer), hashed: true }
  } catch {
    return { ...base, unreadable: true }
  }
}

async function collectFiles(directory, root, depth, out, counts) {
  if (depth > MAX_DEPTH || out.length >= MAX_INDEX_FILES) {
    if (out.length >= MAX_INDEX_FILES) {
      counts.truncated = true
    }

    return
  }

  let entries = []

  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (out.length >= MAX_INDEX_FILES) {
      counts.truncated = true
      break
    }

    if (entry.isSymbolicLink()) {
      counts.skipped += 1
      continue
    }

    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) {
        counts.skipped += 1
        continue
      }

      let real = null

      try {
        real = await fs.realpath(fullPath)
      } catch {
        counts.skipped += 1
        continue
      }

      if (!isInsideScope(root, real)) {
        counts.skipped += 1
        continue
      }

      counts.directories += 1
      await collectFiles(fullPath, root, depth + 1, out, counts)
    } else if (entry.isFile()) {
      if (isSkippedFile(entry.name)) {
        counts.skipped += 1
        continue
      }

      let stat = null

      try {
        stat = await fs.stat(fullPath)
      } catch {
        continue
      }

      counts.files += 1
      out.push({
        relativePath: path.relative(root, fullPath).split(path.sep).join('/'),
        fullPath,
        stat,
      })
    }
  }
}

function manifestSegments() {
  return [...INDEX_SEGMENTS, MANIFEST_FILE]
}

async function loadManifest(root) {
  try {
    const { found, data } = await readStorageFile(root, manifestSegments())

    if (!found || !data) {
      return null
    }

    const parsed = JSON.parse(data)

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.version !== INDEX_VERSION ||
      !parsed.files ||
      typeof parsed.files !== 'object'
    ) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

async function storeManifest(root, manifest) {
  await ensureStorageDir(root, INDEX_SEGMENTS)
  await writeStorageFile(
    root,
    manifestSegments(),
    JSON.stringify(manifest, null, 2)
  )
}

// Refreshes the persisted index incrementally: only new or changed
// files are re-fingerprinted; unchanged entries keep their stored
// fingerprint and indexedAt. Reports exactly what moved so callers
// can invalidate derived state (symbols, search caches).
async function refreshIndex({ force = false } = {}) {
  const root = openRoot()
  const previous = force ? null : await loadManifest(root)
  const previousFiles = (previous && previous.files) || {}

  const found = []
  const counts = { files: 0, directories: 0, skipped: 0, truncated: false }

  await collectFiles(root, root, 0, found, counts)

  const files = {}
  const added = []
  const changed = []
  const removed = []
  let unchanged = 0
  const now = new Date().toISOString()

  for (const entry of found) {
    const prior = previousFiles[entry.relativePath]
    const print = await fingerprintFile(entry.fullPath, entry.stat)

    if (
      prior &&
      prior.size === print.size &&
      prior.mtimeMs === print.mtimeMs &&
      prior.sha256 === print.sha256 &&
      !print.unreadable
    ) {
      files[entry.relativePath] = prior
      unchanged += 1
      continue
    }

    const record = {
      size: print.size,
      mtimeMs: print.mtimeMs,
      sha256: print.sha256,
      hashed: print.hashed,
      binary: print.binary === true,
      unreadable: print.unreadable === true,
      indexedAt: now,
    }

    files[entry.relativePath] = record

    if (prior) {
      changed.push(entry.relativePath)
    } else {
      added.push(entry.relativePath)
    }
  }

  for (const relativePath of Object.keys(previousFiles)) {
    if (!files[relativePath]) {
      removed.push(relativePath)
    }
  }

  const manifest = {
    version: INDEX_VERSION,
    root,
    refreshedAt: now,
    counts,
    files,
  }

  await storeManifest(root, manifest)

  log.info(
    `Index refreshed: ${added.length} added, ${changed.length} changed, ` +
      `${removed.length} removed, ${unchanged} unchanged.`
  )

  return {
    refreshedAt: now,
    counts,
    added,
    changed,
    removed,
    unchanged,
    total: Object.keys(files).length,
    truncated: counts.truncated,
  }
}

async function getIndexStatus() {
  const root = openRoot()
  const manifest = await loadManifest(root)

  if (!manifest) {
    return { indexed: false, root, total: 0 }
  }

  return {
    indexed: true,
    root,
    refreshedAt: manifest.refreshedAt,
    counts: manifest.counts,
    total: Object.keys(manifest.files).length,
    truncated: manifest.counts.truncated === true,
  }
}

// Verifies stored fingerprints against the live workspace. Any file
// whose size, mtime, or hash moved is reported stale with evidence;
// missing files are reported missing. Callers must treat stale
// entries as unusable for grounding until a refresh.
async function checkIndexFreshness(relativePaths) {
  const root = openRoot()

  if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
    throw new Error('No index entries were provided.')
  }

  if (relativePaths.length > MAX_INDEX_FILES) {
    throw new Error(`At most ${MAX_INDEX_FILES} entries can be checked at once.`)
  }

  const manifest = await loadManifest(root)

  if (!manifest) {
    return {
      indexed: false,
      entries: relativePaths.map((relativePath) => ({
        path: relativePath,
        status: 'unindexed',
        reason: 'No index exists yet; refresh first.',
      })),
    }
  }

  const entries = []

  for (const relativePath of relativePaths) {
    const stored = manifest.files[relativePath]

    if (!stored) {
      entries.push({
        path: relativePath,
        status: 'unindexed',
        reason: 'Not present in the index.',
      })
      continue
    }

    const fullPath = path.join(root, relativePath)
    let stat = null

    try {
      stat = await fs.stat(fullPath)
    } catch {
      entries.push({
        path: relativePath,
        status: 'missing',
        reason: 'Indexed but no longer on disk.',
      })
      continue
    }

    if (!stat.isFile()) {
      entries.push({
        path: relativePath,
        status: 'missing',
        reason: 'Indexed path is no longer a regular file.',
      })
      continue
    }

    if (stat.size !== stored.size || Math.floor(stat.mtimeMs) !== stored.mtimeMs) {
      entries.push({
        path: relativePath,
        status: 'stale',
        reason: 'Size or modification time changed since indexing.',
      })
      continue
    }

    if (stored.hashed && stat.size <= MAX_HASH_BYTES) {
      let current = null

      try {
        current = await fs.readFile(fullPath)
      } catch {
        entries.push({
          path: relativePath,
          status: 'stale',
          reason: 'File cannot be re-read for verification.',
        })
        continue
      }

      if (sha256Hex(current) !== stored.sha256) {
        entries.push({
          path: relativePath,
          status: 'stale',
          reason: 'Content hash changed since indexing.',
        })
        continue
      }
    }

    entries.push({
      path: relativePath,
      status: 'current',
      reason: 'Fingerprint matches the indexed baseline.',
    })
  }

  return {
    indexed: true,
    refreshedAt: manifest.refreshedAt,
    entries,
    allCurrent: entries.every((entry) => entry.status === 'current'),
  }
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length >= 3)
    .slice(0, 32)
}

// Selects ranked, deduplicated file excerpts inside an explicit
// character budget. Ranking combines filename and path token overlap
// with the query; files with zero overlap are still returned (in
// path order) when no query is given so callers get stable,
// explainable context. Stale or unindexed inputs are reported, never
// silently included.
async function selectContext({ query = '', paths = null, maxChars = MAX_CONTEXT_CHARS } = {}) {
  const root = openRoot()
  const manifest = await loadManifest(root)

  if (!manifest) {
    throw new Error('No code index exists yet. Refresh the index first.')
  }

  const budget = Math.min(Math.max(1000, maxChars), MAX_CONTEXT_CHARS)
  const tokens = tokenize(query)
  const wanted = paths === null ? Object.keys(manifest.files) : [...new Set(paths)]
  const freshness = await checkIndexFreshness(wanted.slice(0, MAX_INDEX_FILES))

  const scored = []

  for (const entry of freshness.entries) {
    if (entry.status !== 'current') {
      continue
    }

    const stored = manifest.files[entry.path]

    if (!stored || stored.binary || stored.unreadable) {
      continue
    }

    let score = 0

    if (tokens.length > 0) {
      const haystack = entry.path.toLowerCase().replace(/\//g, ' ')

      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += 2
        }
      }

      const base = entry.path.split('/').pop().toLowerCase()

      for (const token of tokens) {
        if (base.includes(token)) {
          score += 3
        }
      }
    }

    scored.push({ path: entry.path, score, size: stored.size })
  }

  scored.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))

  const selected = []
  const skipped = []
  let used = 0
  const seenHashes = new Set()

  for (const candidate of scored.slice(0, MAX_RESULTS)) {
    const stored = manifest.files[candidate.path]

    if (stored.sha256 && seenHashes.has(stored.sha256)) {
      skipped.push({ path: candidate.path, reason: 'Duplicate content already selected.' })
      continue
    }

    let excerpt = ''

    try {
      const buffer = await fs.readFile(path.join(root, candidate.path))

      excerpt = buffer.toString('utf8').slice(0, MAX_EXCERPT_BYTES)
    } catch {
      skipped.push({ path: candidate.path, reason: 'Cannot be read.' })
      continue
    }

    const cost = candidate.path.length + excerpt.length + 32

    if (used + cost > budget) {
      skipped.push({ path: candidate.path, reason: 'Outside the context budget.' })
      continue
    }

    used += cost

    if (stored.sha256) {
      seenHashes.add(stored.sha256)
    }

    selected.push({
      path: candidate.path,
      score: candidate.score,
      bytes: stored.size,
      excerpt,
      truncated: stored.size > MAX_EXCERPT_BYTES,
    })
  }

  const stale = freshness.entries.filter((entry) => entry.status !== 'current')

  return {
    refreshedAt: manifest.refreshedAt,
    queryTokens: tokens,
    budget,
    usedChars: used,
    selected,
    skipped,
    stale,
    totalIndexed: Object.keys(manifest.files).length,
    indexTruncated: manifest.counts.truncated === true,
  }
}

module.exports = {
  MAX_INDEX_FILES,
  MAX_CONTEXT_CHARS,
  refreshIndex,
  getIndexStatus,
  checkIndexFreshness,
  selectContext,
}
