const { ipcMain, dialog } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  exportBriefDocx,
  exportTextDocx,
  importDocxFile,
} = require('../services/documents/document.service.cjs')
const {
  getWorkspaceRoot,
} = require('../services/workspace/workspace.service.cjs')
const {
  resolveWorkspacePath,
} = require('../security/validate-path.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
} = require('../security/validate-input.cjs')

module.exports = function registerDocumentsIPC({
  isTrustedSender,
  getMainWindow,
}) {
  async function saveBuffer(buffer, fileName) {
    const root = getWorkspaceRoot()

    if (!root) {
      throw new Error('Open a project folder first.')
    }

    const mainWindow =
      typeof getMainWindow === 'function' ? getMainWindow() : null

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Word document',
      defaultPath: path.join(root, fileName),
      filters: [{ name: 'Word document', extensions: ['docx'] }],
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    const resolved = await resolveWorkspacePath(result.filePath, {
      allowMissing: true,
    })

    if (path.extname(resolved.path).toLowerCase() !== '.docx') {
      throw new Error('Destination must be a .docx file inside the project.')
    }

    await fs.writeFile(resolved.path, buffer)

    return { path: resolved.path, bytes: buffer.length }
  }

  ipcMain.handle('documents:export-brief', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized document request.')
    }

    assertPlainObject(payload, 'export payload')
    assertNonEmptyString(payload.sessionId, 'session id', 64)

    const exported = await exportBriefDocx(
      payload.sessionId,
      payload.template
    )

    return saveBuffer(exported.buffer, exported.fileName)
  })

  ipcMain.handle('documents:export-text', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized document request.')
    }

    assertPlainObject(payload, 'export payload')
    assertNonEmptyString(payload.title, 'title', 200)

    if (typeof payload.markdown !== 'string') {
      throw new Error('Invalid markdown: text is required.')
    }

    const exported = await exportTextDocx(
      payload.title,
      payload.markdown,
      payload.template
    )

    return saveBuffer(exported.buffer, exported.fileName)
  })

  ipcMain.handle('documents:import', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized document request.')
    }

    const mainWindow =
      typeof getMainWindow === 'function' ? getMainWindow() : null

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Word document',
      properties: ['openFile'],
      filters: [{ name: 'Word document', extensions: ['docx'] }],
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    // Imports may come from outside the workspace (read-only); the
    // service validates the file itself before parsing.
    return importDocxFile(result.filePaths[0])
  })
}
