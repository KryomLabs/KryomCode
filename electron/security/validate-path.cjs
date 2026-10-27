const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
  isInsideWorkspace,
  isSamePath,
  isSameVolume,
} = require('../services/workspace/workspace.service.cjs')

// Resolves a caller-supplied path against the open workspace. Rejects
// traversal outside the root, unresolvable paths, and symbolic links.
// Options:
// - allowMissing: resolve paths that do not exist yet (create flows).
//   Ancestor symlinks are still resolved and validated.
// - allowRoot: permit the workspace root itself (default rejects it).
// - allowDirectory: permit directories (default permits files and dirs;
//   callers check stat for their own needs).
// Returns { path, exists, stat } where path is the validated real path.
async function resolveWorkspacePath(targetPath, options = {}) {
  const { allowMissing = false, allowRoot = false } = options
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw new Error('Invalid file path.')
  }

  // Relative paths resolve against the workspace root, never the
  // process working directory. Absolute paths are unaffected.
  const logical = path.resolve(root, targetPath)

  // Fast fail only across volumes: a path on another drive or UNC share
  // can never canonicalize inside the workspace. Same-volume containment
  // is decided after realpath below, because the caller may pass a valid
  // non-canonical form (Windows 8.3 short names, junctions, case and
  // separator variants) whose string form looks outside while its real
  // path is inside.
  if (!isSameVolume(root, logical)) {
    throw new Error('Path is outside the selected workspace.')
  }

  let existing = logical
  const missing = []

  while (true) {
    let stat = null

    try {
      stat = await fs.lstat(existing)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }

      const parent = path.dirname(existing)

      if (parent === existing) {
        throw new Error('Invalid file path.')
      }

      missing.unshift(path.basename(existing))
      existing = parent
      continue
    }

    if (stat.isSymbolicLink()) {
      throw new Error('Symbolic links are not followed.')
    }

    // Canonicalize before any other decision: containment is judged on
    // the real path so valid non-canonical forms (Windows 8.3 short
    // names, junctions) are accepted, and escapes hiding behind a
    // missing tail are still rejected as outside rather than missing.
    const realBase = await fs.realpath(existing)

    if (!isInsideWorkspace(realBase)) {
      throw new Error('Path resolves outside the selected workspace.')
    }

    const resolved = missing.length > 0
      ? path.join(realBase, ...missing)
      : realBase

    if (!isInsideWorkspace(resolved)) {
      throw new Error('Path is outside the selected workspace.')
    }

    if (missing.length > 0 && !allowMissing) {
      throw new Error('File or folder does not exist.')
    }

    if (!allowRoot && isSamePath(resolved, root)) {
      throw new Error('That operation cannot target the workspace root.')
    }

    return {
      path: resolved,
      exists: missing.length === 0,
      stat: missing.length === 0 ? stat : null,
    }
  }
}

module.exports = {
  resolveWorkspacePath,
}
