const { ipcMain } = require('electron')

const {
  readFile,
  saveFile,
} = require('../services/filesystem/file.service.cjs')
const {
  createFile,
  createDirectory,
  renamePath,
  deletePath,
  readFileWithMeta,
  writeFileIfUnchanged,
} = require('../services/filesystem/directory.service.cjs')
const {
  searchFiles,
} = require('../services/filesystem/file-search.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
  assertOptionalString,
  assertEnum,
} = require('../security/validate-input.cjs')

module.exports = function registerFilesystemIPC({
  isTrustedSender,
}) {
  ipcMain.handle('workspace:read-file', async (event, filePath) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized file request.')
    }

    return readFile(filePath)
  })

  ipcMain.handle(
    'workspace:save-file',
    async (event, filePath, content) => {
      if (!isTrustedSender(event)) {
        throw new Error('Unauthorized file request.')
      }

      return saveFile(filePath, content)
    }
  )

  ipcMain.handle('filesystem:read-meta', async (event, filePath) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized file request.')
    }

    assertNonEmptyString(filePath, 'file path', 2000)

    return readFileWithMeta(filePath)
  })

  ipcMain.handle(
    'filesystem:save-conditional',
    async (event, filePath, content, expectedMtimeMs) => {
      if (!isTrustedSender(event)) {
        throw new Error('Unauthorized file request.')
      }

      assertNonEmptyString(filePath, 'file path', 2000)

      return writeFileIfUnchanged(filePath, content, expectedMtimeMs)
    }
  )

  ipcMain.handle('filesystem:create', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized file request.')
    }

    assertPlainObject(payload, 'create payload')
    assertNonEmptyString(payload.path, 'path', 2000)
    assertEnum(payload.type, 'type', ['file', 'directory'])

    if (payload.type === 'directory') {
      return createDirectory(payload.path)
    }

    return createFile(
      payload.path,
      assertOptionalString(payload.content, 'content', 1024 * 1024) ?? ''
    )
  })

  ipcMain.handle('filesystem:rename', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized file request.')
    }

    assertPlainObject(payload, 'rename payload')
    assertNonEmptyString(payload.oldPath, 'current path', 2000)
    assertNonEmptyString(payload.newPath, 'new path', 2000)

    return renamePath(payload.oldPath, payload.newPath)
  })

  ipcMain.handle('filesystem:delete', async (event, targetPath) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized file request.')
    }

    assertNonEmptyString(targetPath, 'path', 2000)

    return deletePath(targetPath)
  })

  ipcMain.handle('search:files', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized search request.')
    }

    assertPlainObject(payload, 'search payload')
    assertNonEmptyString(payload.query, 'query', 200)

    const mode = payload.mode === undefined ? 'name' : payload.mode
    assertEnum(mode, 'mode', ['name', 'content'])

    return searchFiles(payload.query, { mode })
  })
}
