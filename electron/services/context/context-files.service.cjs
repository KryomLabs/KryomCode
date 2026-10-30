// Bounded excerpts of user-picked files for AI prompt context. The
// renderer passes absolute paths returned by the native file picker
// (an explicit user action per file); reads are read-only,
// size-capped, and reject directories, missing files, and binary
// content. Outside-workspace reads are allowed for this flow: the
// user chose each file in a native dialog and every excerpt is shown
// back as an attachment chip, so nothing is silently bundled. (The
// stat-then-read ordering is not hardened against local races; these
// are the user's own files and nothing is written.)
const fs = require('node:fs/promises')
const path = require('node:path')

const MAX_FILE_BYTES = 200000
const MAX_EXCERPT_CHARS = 20000

function displayName(resolved) {
  return path.basename(resolved) || 'file'
}

async function readContextFile(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath || targetPath.length > 4000) {
    throw new Error('Invalid file path.')
  }

  const resolved = path.resolve(targetPath)
  let stat = null

  try {
    stat = await fs.stat(resolved)
  } catch {
    throw new Error(`Cannot read ${displayName(resolved)}: file not found.`)
  }

  if (!stat.isFile()) {
    throw new Error(`Cannot read ${displayName(resolved)}: not a file.`)
  }

  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`Cannot read ${displayName(resolved)}: larger than 200 KB.`)
  }

  const buffer = await fs.readFile(resolved)

  if (buffer.includes(0)) {
    throw new Error(`Cannot read ${displayName(resolved)}: binary files are not supported.`)
  }

  const text = buffer.toString('utf8')
  const truncated = text.length > MAX_EXCERPT_CHARS

  return {
    path: resolved,
    name: displayName(resolved),
    chars: text.length,
    truncated,
    excerpt: truncated ? text.slice(0, MAX_EXCERPT_CHARS) : text,
  }
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_EXCERPT_CHARS,
  readContextFile,
}
