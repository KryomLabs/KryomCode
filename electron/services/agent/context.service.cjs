// Bounded source context for the coding agent. Reads user-selected
// project files in the main process so the planner grounds edits in
// actual file contents instead of filenames alone.
//
// Safety rules: every path is resolved against the open workspace
// (traversal, outside roots, and symlinks reject loudly); sensitive
// locations (.env, credentials, private .kryom history, .git,
// node_modules, generated output) and binary or oversized files are
// excluded with a stated reason, never silently truncated or skipped.
// Callers report the included/excluded lists so the user always knows
// exactly what the model received.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  resolveWorkspacePath,
} = require('../../security/validate-path.cjs')

const MAX_CONTEXT_FILES = 8
const MAX_CONTEXT_FILE_BYTES = 32 * 1024
const MAX_CONTEXT_TOTAL_BYTES = 96 * 1024

// Directory segments that are never eligible for model context.
const EXCLUDED_DIR_SEGMENTS = new Set([
  '.git',
  '.kryom',
  '__pycache__',
  '.venv',
  'venv',
  'build',
  'coverage',
  'dist',
  '.next',
  'node_modules',
  'out',
])

// Basename patterns for secrets and non-source files.
const EXCLUDED_BASENAME_PATTERNS = [
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /\.jks$/i,
  /secret/i,
  /credential/i,
]

function isExcludedName(baseName) {
  if (baseName.startsWith('.env') || baseName === '.DS_Store') {
    return true
  }

  return EXCLUDED_BASENAME_PATTERNS.some((pattern) => pattern.test(baseName))
}

function exclusionReason(relativePath) {
  const segments = relativePath.split(path.sep)
  const baseName = segments[segments.length - 1] || ''

  if (segments.some((segment) => EXCLUDED_DIR_SEGMENTS.has(segment))) {
    return 'inside an excluded directory'
  }

  if (isExcludedName(baseName)) {
    return 'sensitive or non-source file name'
  }

  return null
}

function isMissingError(error) {
  return Boolean(
    error &&
      typeof error.message === 'string' &&
      error.message.includes('does not exist')
  )
}

// Gathers validated file contents for model context. Throws on
// traversal, outside-workspace, and symlink inputs (fail closed);
// benign per-file problems (missing, excluded, oversized, binary,
// over budget) land in `excluded` with reasons. Never returns
// partial file contents.
async function gatherSourceContext(requestedPaths) {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  if (requestedPaths === undefined || requestedPaths === null) {
    return { files: [], excluded: [], totalBytes: 0 }
  }

  if (!Array.isArray(requestedPaths)) {
    throw new Error('Invalid context paths: an array is required.')
  }

  const files = []
  const excluded = []
  const seen = new Set()
  let totalBytes = 0

  for (const raw of requestedPaths) {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new Error('Invalid context paths: every entry must be text.')
    }

    const label = raw.trim()

    let resolved = null

    try {
      resolved = await resolveWorkspacePath(label)
    } catch (error) {
      if (isMissingError(error)) {
        excluded.push({ path: label, reason: 'file not found' })
        continue
      }

      throw error
    }

    if (!resolved.stat.isFile()) {
      excluded.push({ path: label, reason: 'not a regular file' })
      continue
    }

    if (seen.has(resolved.path)) {
      continue
    }

    seen.add(resolved.path)

    const relativePath = path.relative(root, resolved.path)
    const exclusion = exclusionReason(relativePath)

    if (exclusion) {
      excluded.push({ path: label, reason: exclusion })
      continue
    }

    if (resolved.stat.size > MAX_CONTEXT_FILE_BYTES) {
      excluded.push({
        path: label,
        reason: `too large (${resolved.stat.size} bytes, limit ${MAX_CONTEXT_FILE_BYTES})`,
      })
      continue
    }

    if (files.length >= MAX_CONTEXT_FILES) {
      excluded.push({
        path: label,
        reason: `file limit reached (${MAX_CONTEXT_FILES})`,
      })
      continue
    }

    if (totalBytes + resolved.stat.size > MAX_CONTEXT_TOTAL_BYTES) {
      excluded.push({
        path: label,
        reason: `context budget exceeded (${MAX_CONTEXT_TOTAL_BYTES} bytes total)`,
      })
      continue
    }

    const buffer = await fs.readFile(resolved.path)

    if (buffer.includes(0)) {
      excluded.push({ path: label, reason: 'binary file' })
      continue
    }

    // Re-check the budget against bytes actually read: the file may
    // have grown between stat and read. Oversized content is
    // excluded, never truncated.
    if (
      buffer.length > MAX_CONTEXT_FILE_BYTES ||
      totalBytes + buffer.length > MAX_CONTEXT_TOTAL_BYTES
    ) {
      excluded.push({
        path: label,
        reason: `too large (${buffer.length} bytes read)`,
      })
      continue
    }

    files.push({
      path: resolved.path,
      relativePath,
      bytes: buffer.length,
      content: buffer.toString('utf8'),
    })
    totalBytes += buffer.length
  }

  return { files, excluded, totalBytes }
}

module.exports = {
  gatherSourceContext,
  MAX_CONTEXT_FILES,
  MAX_CONTEXT_FILE_BYTES,
  MAX_CONTEXT_TOTAL_BYTES,
}
