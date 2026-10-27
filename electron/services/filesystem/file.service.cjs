const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
  isInsideWorkspace,
  isSamePath,
  isSameVolume,
} = require('../workspace/workspace.service.cjs')

const MAX_FILE_SIZE = 1024 * 1024

async function resolveExistingFile(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Invalid file path.')
  }

  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('File is outside the selected workspace.')
  }

  // Relative paths resolve against the workspace root, matching
  // validate-path. Containment is decided after realpath so valid
  // non-canonical forms (Windows 8.3 short names, junctions, case and
  // separator variants) are accepted; only cross-volume paths fail fast.
  const logical = path.resolve(root, filePath)

  if (!isSameVolume(root, logical)) {
    throw new Error('File is outside the selected workspace.')
  }

  const stat = await fs.lstat(logical)

  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Only regular files can be accessed.')
  }

  const realPath = await fs.realpath(logical)

  if (!isInsideWorkspace(realPath) || isSamePath(realPath, root)) {
    throw new Error('File resolves outside the selected workspace.')
  }

  return { resolved: realPath, stat }
}

async function readFile(filePath) {
  const { resolved, stat } = await resolveExistingFile(filePath)

  if (stat.size > MAX_FILE_SIZE) {
    throw new Error('File is larger than 1 MB.')
  }

  return fs.readFile(resolved, 'utf8')
}

async function saveFile(filePath, content) {
  const { resolved } = await resolveExistingFile(filePath)

  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE
  ) {
    throw new Error('Invalid content or file exceeds 1 MB.')
  }

  await fs.writeFile(resolved, content, 'utf8')

  return { success: true }
}

module.exports = {
  readFile,
  saveFile,
}
