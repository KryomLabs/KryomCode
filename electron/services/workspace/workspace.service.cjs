const fs = require('node:fs/promises')
const path = require('node:path')

const IGNORED = new Set([
  'node_modules',
  '.git',
  '.kryom',
  'dist',
  '.next',
  'coverage',
])

let workspaceRoot = null

// Single-slot previous root for in-flight saves. A chat save
// dispatched before a project switch must still land in the project
// it was written for, not the newly opened one (Level 2B.2). Only
// ever a root the user actually opened; never an arbitrary path.
let previousWorkspaceRoot = null

function getWorkspaceRoot() {
  return workspaceRoot
}

function getPreviousWorkspaceRoot() {
  return previousWorkspaceRoot
}

async function setWorkspaceRoot(directoryPath) {
  if (typeof directoryPath !== 'string' || !directoryPath.trim()) {
    throw new Error('A valid workspace directory is required.')
  }

  const resolved = await fs.realpath(directoryPath)
  const stat = await fs.stat(resolved)

  if (!stat.isDirectory()) {
    throw new Error('The selected workspace is not a directory.')
  }

  // Opening over an empty root (after a close) keeps the previously
  // closed root, so close-then-open switches behave like direct ones.
  if (workspaceRoot) {
    previousWorkspaceRoot = workspaceRoot
  }

  workspaceRoot = resolved
  return workspaceRoot
}

function closeWorkspace() {
  if (workspaceRoot) {
    previousWorkspaceRoot = workspaceRoot
  }

  workspaceRoot = null

  return { success: true }
}

function isInsideWorkspace(targetPath) {
  if (!workspaceRoot || typeof targetPath !== 'string') {
    return false
  }

  const resolved = path.resolve(targetPath)

  // Windows compares paths case-insensitively. Normalize both sides so
  // containment does not depend on Node's per-version relative() casing
  // behavior. Separators and drive letters are normalized by resolve().
  if (process.platform === 'win32') {
    const relative = path.relative(
      workspaceRoot.toLowerCase(),
      resolved.toLowerCase()
    )

    return relative === '' ||
      (!path.isAbsolute(relative) &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`))
  }

  const relative = path.relative(workspaceRoot, resolved)

  return relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
}

// Scope check for directory walkers: true when the already-resolved
// target stays inside the already-resolved scope root. Walkers use
// this (after realpath) so junctions and reparse points — which
// Dirent reports as plain directories — cannot pull outside content
// into the tree, index, or search results.
function isInsideScope(scopeRoot, targetPath) {
  if (typeof scopeRoot !== 'string' || typeof targetPath !== 'string') {
    return false
  }

  const relative =
    process.platform === 'win32'
      ? path.relative(scopeRoot.toLowerCase(), targetPath.toLowerCase())
      : path.relative(scopeRoot, targetPath)

  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
  )
}

// Case-insensitive on Windows, exact elsewhere. Compares two already
// resolved absolute paths for identity (workspace-root targeting).
function isSamePath(firstPath, secondPath) {
  if (typeof firstPath !== 'string' || typeof secondPath !== 'string') {
    return false
  }

  if (process.platform === 'win32') {
    return firstPath.toLowerCase() === secondPath.toLowerCase()
  }

  return firstPath === secondPath
}

// True when both resolved absolute paths share one volume (drive letter
// or UNC root, case-insensitive on Windows). Paths on different volumes
// can never canonicalize inside each other, so callers can reject them
// before touching the filesystem.
function isSameVolume(firstPath, secondPath) {
  if (typeof firstPath !== 'string' || typeof secondPath !== 'string') {
    return false
  }

  const firstRoot = path.parse(firstPath).root
  const secondRoot = path.parse(secondPath).root

  if (!firstRoot || !secondRoot) {
    return false
  }

  if (process.platform === 'win32') {
    return firstRoot.toLowerCase() === secondRoot.toLowerCase()
  }

  return firstRoot === secondRoot
}

async function buildTree(
  directoryPath = workspaceRoot,
  depth = 0,
  counter = { count: 0 },
  scopeRoot = null
) {
  if (!directoryPath || depth > 8 || counter.count >= 2000) {
    return []
  }

  const scope = scopeRoot ?? directoryPath

  let entries = null

  try {
    entries = await fs.readdir(directoryPath, {
      withFileTypes: true,
    })
  } catch {
    // Unreadable directories are skipped, not fatal: one denied
    // folder must not abort the whole workspace tree.
    return []
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1
    }

    return a.name.localeCompare(b.name)
  })

  const result = []

  for (const entry of entries) {
    if (counter.count >= 2000) break
    if (IGNORED.has(entry.name) || entry.isSymbolicLink()) continue

    const fullPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      // Junctions and reparse points look like directories but can
      // point anywhere (including cycles): descend only when the
      // canonical path stays inside the tree being built.
      let real = null

      try {
        real = await fs.realpath(fullPath)
      } catch {
        continue
      }

      if (!isInsideScope(scope, real)) {
        continue
      }

      counter.count++
      result.push({
        name: entry.name,
        path: fullPath,
        type: 'directory',
        children: await buildTree(fullPath, depth + 1, counter, scope),
      })
    } else if (entry.isFile()) {
      counter.count++
      result.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
      })
    }
  }

  return result
}

module.exports = {
  getWorkspaceRoot,
  getPreviousWorkspaceRoot,
  setWorkspaceRoot,
  closeWorkspace,
  isInsideWorkspace,
  isInsideScope,
  isSamePath,
  isSameVolume,
  buildTree,
}
