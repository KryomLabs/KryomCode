const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
  isInsideScope,
} = require('../workspace/workspace.service.cjs')

const IGNORED = new Set([
  'node_modules',
  '.git',
  '.kryom',
  'dist',
  '.next',
  'coverage',
  '.env',
])

const MAX_FILES = 2000
const MAX_DEPTH = 8
const MAX_FILE_SIZE = 100 * 1024
const MAX_RESULTS = 200

function isIgnored(name) {
  return (
    IGNORED.has(name) ||
    name.startsWith('.env') ||
    name === '.DS_Store'
  )
}

async function collectFiles(directory, depth, files, scope = null) {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) {
    return
  }

  const root = scope ?? directory

  let entries = []

  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (files.length >= MAX_FILES) {
      break
    }

    if (isIgnored(entry.name) || entry.isSymbolicLink()) {
      continue
    }

    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      // Junctions look like directories: descend only when the
      // canonical path stays inside the searched tree.
      let real = null

      try {
        real = await fs.realpath(fullPath)
      } catch {
        continue
      }

      if (!isInsideScope(root, real)) {
        continue
      }

      await collectFiles(fullPath, depth + 1, files, root)
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
}

function toRelative(root, fullPath) {
  return path.relative(root, fullPath)
}

// mode: 'name' matches file names; 'content' greps bounded text files.
// Returns bounded matches plus truncation flags. Binary files and
// oversized files are skipped, never read unbounded.
async function searchFiles(query, { mode = 'name' } = {}) {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  if (typeof query !== 'string' || !query.trim() || query.length > 200) {
    throw new Error('Enter search text up to 200 characters.')
  }

  if (mode !== 'name' && mode !== 'content') {
    throw new Error('Search mode must be "name" or "content".')
  }

  const files = []
  await collectFiles(root, 0, files)

  const needle = query.toLowerCase()
  const matches = []
  let truncated = files.length >= MAX_FILES

  if (mode === 'name') {
    for (const file of files) {
      if (matches.length >= MAX_RESULTS) {
        truncated = true
        break
      }

      if (path.basename(file).toLowerCase().includes(needle)) {
        matches.push({ path: file, relativePath: toRelative(root, file) })
      }
    }

    return { matches, truncated, searchedFiles: files.length }
  }

  for (const file of files) {
    if (matches.length >= MAX_RESULTS) {
      truncated = true
      break
    }

    let stat = null

    try {
      stat = await fs.stat(file)
    } catch {
      continue
    }

    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) {
      continue
    }

    let content = null

    try {
      content = await fs.readFile(file, 'utf8')
    } catch {
      continue
    }

    if (content.includes('\0')) {
      continue
    }

    const lines = content.split('\n')

    for (let index = 0; index < lines.length; index += 1) {
      if (matches.length >= MAX_RESULTS) {
        truncated = true
        break
      }

      if (lines[index].toLowerCase().includes(needle)) {
        matches.push({
          path: file,
          relativePath: toRelative(root, file),
          line: index + 1,
          text: lines[index].slice(0, 500),
        })
      }
    }
  }

  return { matches, truncated, searchedFiles: files.length }
}

module.exports = {
  searchFiles,
}
