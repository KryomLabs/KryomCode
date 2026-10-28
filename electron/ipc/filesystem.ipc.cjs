const { ipcMain, dialog } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  readFile,
  saveFile,
} = require('../services/filesystem/file.service.cjs')
const {
  getWorkspaceRoot,
} = require('../services/workspace/workspace.service.cjs')
const {
  resolveWorkspacePath,
} = require('../security/validate-path.cjs')
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
  getMainWindow,
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

  // Save As: the main process chooses the destination with a native
  // dialog rooted at the workspace, then rejects anything outside it.
  // Creates the file or overwrites it; returns fresh file metadata.
  ipcMain.handle(
    'filesystem:save-as',
    async (event, content, suggestedName) => {
      if (!isTrustedSender(event)) {
        throw new Error('Unauthorized file request.')
      }

      if (
        typeof content !== 'string' ||
        Buffer.byteLength(content, 'utf8') > 1024 * 1024
      ) {
        throw new Error('Invalid content or file exceeds 1 MB.')
      }

      const root = getWorkspaceRoot()

      if (!root) {
        throw new Error('Open a project folder first.')
      }

      const safeName =
        typeof suggestedName === 'string' && suggestedName.trim()
          ? path.basename(suggestedName.trim()).slice(0, 255)
          : 'untitled.txt'

      const mainWindow =
        typeof getMainWindow === 'function' ? getMainWindow() : null

      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save As',
        defaultPath: path.join(root, safeName),
      })

      if (result.canceled || !result.filePath) {
        return null
      }

      const resolved = await resolveWorkspacePath(result.filePath, {
        allowMissing: true,
      })

      await fs.writeFile(resolved.path, content, 'utf8')
      const stat = await fs.stat(resolved.path)

      return { path: resolved.path, content, mtimeMs: stat.mtimeMs }
    }
  )

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
