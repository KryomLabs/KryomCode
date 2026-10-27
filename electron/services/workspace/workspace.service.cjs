const fs = require('node:fs/promises')
const path = require('node:path')

const IGNORED = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'coverage',
])

let workspaceRoot = null

function getWorkspaceRoot() {
  return workspaceRoot
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

  workspaceRoot = resolved
  return workspaceRoot
}

function closeWorkspace() {
  workspaceRoot = null

  return { success: true }
}

function isInsideWorkspace(targetPath) {
  if (!workspaceRoot || typeof targetPath !== 'string') {
    return false
  }

  const resolved = path.resolve(targetPath)
  const relative = path.relative(workspaceRoot, resolved)

  return relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
}

async function buildTree(
  directoryPath = workspaceRoot,
  depth = 0,
  counter = { count: 0 }
) {
  if (!directoryPath || depth > 8 || counter.count >= 2000) {
    return []
  }

  const entries = await fs.readdir(directoryPath, {
    withFileTypes: true,
  })

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
    counter.count++

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: fullPath,
        type: 'directory',
        children: await buildTree(fullPath, depth + 1, counter),
      })
    } else if (entry.isFile()) {
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
  setWorkspaceRoot,
  closeWorkspace,
  isInsideWorkspace,
  buildTree,
}
