const fs = require('node:fs/promises')
const path = require('node:path')

const {
  resolveWorkspacePath,
} = require('../../security/validate-path.cjs')
const {
  CODES,
  createError,
} = require('../../utils/errors.cjs')

const MAX_FILE_SIZE = 1024 * 1024

// Create, rename, delete, and guarded writes. Every path is resolved
// against the open workspace: traversal, symlinks, and operations on
// the workspace root itself are rejected.

async function createFile(filePath, content = '') {
  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE
  ) {
    throw new Error('Invalid content or file exceeds 1 MB.')
  }

  const { path: resolved, exists } = await resolveWorkspacePath(filePath, {
    allowMissing: true,
  })

  if (exists) {
    throw new Error('A file or folder already exists at that path.')
  }

  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, content, 'utf8')

  return { success: true, path: resolved }
}

async function createDirectory(directoryPath) {
  const { path: resolved, exists, stat } = await resolveWorkspacePath(
    directoryPath,
    { allowMissing: true }
  )

  if (exists) {
    if (!stat.isDirectory()) {
      throw new Error('A file already exists at that path.')
    }

    return { success: true, path: resolved }
  }

  await fs.mkdir(resolved, { recursive: true })

  return { success: true, path: resolved }
}

async function renamePath(oldPath, newPath) {
  const source = await resolveWorkspacePath(oldPath)
  const target = await resolveWorkspacePath(newPath, { allowMissing: true })

  if (target.exists) {
    throw new Error('A file or folder already exists at the new path.')
  }

  if (source.path === target.path) {
    throw new Error('The new path is the same as the current path.')
  }

  await fs.mkdir(path.dirname(target.path), { recursive: true })
  await fs.rename(source.path, target.path)

  return { success: true, path: target.path }
}

async function deletePath(targetPath) {
  const { path: resolved, stat } = await resolveWorkspacePath(targetPath)

  if (stat.isDirectory()) {
    await fs.rm(resolved, { recursive: true, force: false })
  } else if (stat.isFile()) {
    await fs.unlink(resolved)
  } else {
    throw new Error('Only files and folders can be deleted.')
  }

  return { success: true }
}

async function readFileWithMeta(filePath) {
  const { path: resolved, stat } = await resolveWorkspacePath(filePath)

  if (!stat.isFile()) {
    throw new Error('Only regular files can be read.')
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new Error('File is larger than 1 MB.')
  }

  const content = await fs.readFile(resolved, 'utf8')

  return {
    content,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    path: resolved,
  }
}

// Writes only when the file is unchanged since expectedMtimeMs, so the
// renderer can protect unsaved edits against conflicting disk writes.
// Pass expectedMtimeMs from readFileWithMeta; omit it for a plain write.
async function writeFileIfUnchanged(filePath, content, expectedMtimeMs) {
  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE
  ) {
    throw new Error('Invalid content or file exceeds 1 MB.')
  }

  const { path: resolved, stat } = await resolveWorkspacePath(filePath)

  if (!stat.isFile()) {
    throw new Error('Only regular files can be written.')
  }

  if (
    expectedMtimeMs !== undefined &&
    expectedMtimeMs !== null &&
    stat.mtimeMs !== Number(expectedMtimeMs)
  ) {
    throw createError(
      CODES.WRITE_CONFLICT,
      'File changed on disk since it was opened. Reload before saving.'
    )
  }

  await fs.writeFile(resolved, content, 'utf8')
  const next = await fs.stat(resolved)

  return { success: true, mtimeMs: next.mtimeMs }
}

module.exports = {
  createFile,
  createDirectory,
  renamePath,
  deletePath,
  readFileWithMeta,
  writeFileIfUnchanged,
}
