// Dependency and impact analysis (Level 3C.1). Before significant
// changes, identifies direct and indirect dependents, affected
// files, important callers, related tests, and configuration
// dependencies — each with file-and-line evidence.
//
// Resolution is relative-import only over indexed JavaScript/
// TypeScript files: aliases, absolute imports, and external packages
// are reported as unresolvable, never guessed. Risk flags are
// structural (importer counts, entry-point reach) rather than
// invented numeric scores.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  checkIndexFreshness,
} = require('./code-index.service.cjs')
const {
  indexSymbols,
} = require('./symbol-index.service.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('impact-analysis')

const MAX_FILES = 200
const MAX_DEPTH = 3
const MAX_IMPORTERS = 50
const MAX_EVIDENCE = 100
const MAX_FILE_BYTES = 256 * 1024

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

function openRoot() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  return root
}

function normalizeRelative(value) {
  return value.split(path.sep).join('/')
}

function isRelativeSpecifier(specifier) {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  )
}

// Resolves a relative import against indexed files only. Returns the
// indexed relative path or null with a reason; never touches
// node_modules and never guesses aliases.
function resolveRelative(specifier, fromFile, indexedSet) {
  if (!isRelativeSpecifier(specifier)) {
    return { path: null, reason: 'Non-relative import (alias, absolute, or package).' }
  }

  const fromDir = path.posix.dirname(fromFile)
  const logical = path.posix.normalize(path.posix.join(fromDir, specifier))
  const candidates = [logical]

  if (!path.posix.extname(logical)) {
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(`${logical}${ext}`)
    }

    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(`${logical}/index${ext}`)
    }
  }

  for (const candidate of candidates) {
    if (indexedSet.has(candidate)) {
      return { path: candidate, reason: null }
    }
  }

  return { path: null, reason: 'Target is not an indexed project file.' }
}

function isTestFile(relativePath) {
  return /(\.test\.|\.spec\.|__tests__)/.test(relativePath)
}

async function readLines(root, relativePath, line, radius = 1) {
  try {
    const buffer = await fs.readFile(path.join(root, relativePath))

    if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) {
      return ''
    }

    const lines = buffer.toString('utf8').split('\n')
    const start = Math.max(0, line - 1 - radius)

    return lines.slice(start, line + radius).join('\n').trim().slice(0, 500)
  } catch {
    return ''
  }
}

async function currentIndexedFiles(root) {
  const { readStorageFile } = require('../../security/storage-path.cjs')
  const stored = await readStorageFile(root, ['.kryom', 'index', 'manifest.json'])

  if (!stored.found || !stored.data) {
    throw new Error('No code index exists yet. Refresh the index first.')
  }

  const manifest = JSON.parse(stored.data)
  const candidates = Object.keys(manifest.files || {}).slice(0, MAX_FILES)
  const freshness = await checkIndexFreshness(candidates)

  return {
    manifest,
    current: freshness.entries.filter((entry) => entry.status === 'current'),
    stale: freshness.entries.filter((entry) => entry.status !== 'current'),
  }
}

// Analyzes the blast radius of changing the given files. `paths` must
// be workspace-relative indexed paths.
async function analyzeImpact({ paths }) {
  const root = openRoot()

  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('Provide at least one file path.')
  }

  if (paths.length > 20) {
    throw new Error('At most 20 files can be analyzed at once.')
  }

  const targets = [...new Set(paths.map((entry) => normalizeRelative(String(entry))))]
  const { manifest, current, stale } = await currentIndexedFiles(root)
  const indexedSet = new Set(current.map((entry) => entry.path))

  for (const target of targets) {
    if (!indexedSet.has(target)) {
      const staleEntry = stale.find((entry) => entry.path === target)

      throw new Error(
        staleEntry
          ? `Cannot analyze "${target}": ${staleEntry.status} (${staleEntry.reason}) Refresh the index first.`
          : `Cannot analyze "${target}": not an indexed project file.`
      )
    }
  }

  const supported = current
    .map((entry) => entry.path)
    .filter((entry) => ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']
      .includes(path.extname(entry).toLowerCase()))
    .slice(0, MAX_FILES)

  const indexed = await indexSymbols({ paths: supported })

  // Forward edges: file -> files it imports. Reverse edges: file ->
  // files importing it, with evidence.
  const forward = new Map()
  const reverse = new Map()
  const unresolved = []

  for (const record of indexed.imports) {
    const resolved = resolveRelative(record.specifier, record.file, indexedSet)

    if (!resolved.path) {
      if (unresolved.length < MAX_EVIDENCE) {
        unresolved.push({
          file: record.file,
          line: record.line,
          specifier: record.specifier,
          reason: resolved.reason,
        })
      }

      continue
    }

    if (!forward.has(record.file)) {
      forward.set(record.file, new Set())
    }

    forward.get(record.file).add(resolved.path)

    if (!reverse.has(resolved.path)) {
      reverse.set(resolved.path, [])
    }

    if (reverse.get(resolved.path).length < MAX_IMPORTERS) {
      reverse.get(resolved.path).push({
        file: record.file,
        line: record.line,
        specifier: record.specifier,
        names: record.names,
      })
    }
  }

  // BFS over reverse edges for indirect dependents.
  const direct = new Map()
  const indirect = new Map()
  const queue = []

  for (const target of targets) {
    for (const importer of reverse.get(target) || []) {
      if (!targets.includes(importer.file) && !direct.has(importer.file)) {
        direct.set(importer.file, { via: target, line: importer.line })
        queue.push({ file: importer.file, depth: 1 })
      }
    }
  }

  const seen = new Set([...targets, ...direct.keys()])

  while (queue.length > 0) {
    const { file, depth } = queue.shift()

    if (depth >= MAX_DEPTH) {
      continue
    }

    for (const importer of reverse.get(file) || []) {
      if (seen.has(importer.file)) {
        continue
      }

      seen.add(importer.file)
      indirect.set(importer.file, { via: file, line: importer.line, depth: depth + 1 })
      queue.push({ file: importer.file, depth: depth + 1 })
    }
  }

  const affected = [...new Set([...direct.keys(), ...indirect.keys()])]
  const relatedTests = affected.filter((entry) => isTestFile(entry))
  const directTests = targets.filter((entry) => isTestFile(entry))

  // Evidence: quoted import lines for direct dependents.
  const evidence = []

  for (const [file, info] of direct) {
    const line = await readLines(root, file, info.line)

    evidence.push({
      file,
      line: info.line,
      via: info.via,
      excerpt: line,
    })

    if (evidence.length >= MAX_EVIDENCE) {
      break
    }
  }

  // Structural risk flags (no invented scores).
  const risks = []
  const totalDependents = direct.size + indirect.size

  if (totalDependents === 0) {
    risks.push({
      level: 'low',
      reason: 'No indexed importers found; the change is locally contained.',
    })
  } else {
    risks.push({
      level: totalDependents >= 10 ? 'high' : direct.size >= 3 ? 'medium' : 'low',
      reason:
        `${direct.size} direct and ${indirect.size} indirect dependent(s) ` +
        `within ${MAX_DEPTH} hops.`,
    })
  }

  if (relatedTests.length > 0) {
    risks.push({
      level: 'medium',
      reason: `${relatedTests.length} related test file(s) may need updates or re-runs.`,
    })
  }

  const entryLike = targets.filter((entry) =>
    /(^|\/)(main|index|app|server)\.[a-z]+$/.test(entry)
  )

  if (entryLike.length > 0) {
    risks.push({
      level: 'medium',
      reason: `Entry-like file(s) ${entryLike.join(', ')}: check startup wiring after changes.`,
    })
  }

  log.info(
    `Impact analyzed for ${targets.length} file(s): ` +
      `${direct.size} direct, ${indirect.size} indirect dependent(s).`
  )

  return {
    refreshedAt: manifest.refreshedAt,
    targets,
    directDependents: [...direct.entries()].map(([file, info]) => ({ file, ...info })),
    indirectDependents: [...indirect.entries()].map(([file, info]) => ({ file, ...info })),
    affectedFiles: affected,
    relatedTests: [...new Set([...relatedTests, ...directTests])],
    forwardDependencies: targets.map((target) => ({
      file: target,
      imports: [...(forward.get(target) || [])],
    })),
    evidence,
    risks,
    unresolvedImports: unresolved,
    stale,
    indexTruncated: manifest.counts.truncated === true,
  }
}

module.exports = {
  analyzeImpact,
}
