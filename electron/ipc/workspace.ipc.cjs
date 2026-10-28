const { ipcMain, dialog } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  setWorkspaceRoot,
  closeWorkspace,
  getWorkspaceRoot,
  buildTree,
} = require('../services/workspace/workspace.service.cjs')
const {
  addRecent,
  removeRecent,
} = require('../services/ui/ui-state.service.cjs')
const {
  assertNonEmptyString,
} = require('../security/validate-input.cjs')

module.exports = function registerWorkspaceIPC({
  getMainWindow,
  isTrustedSender,
  onWorkspaceOpened,
}) {
  const notifyOpened = () => {
    if (typeof onWorkspaceOpened === 'function') {
      onWorkspaceOpened()
    }
  }

  async function recordRecent(root) {
    try {
      await addRecent(root)
    } catch {
      // Recent tracking is auxiliary: a failure here must never fail
      // the workspace open itself.
    }

    notifyOpened()
  }

  async function pruneRecent(root) {
    try {
      await removeRecent(root)
    } catch {
      // Pruning is auxiliary: the original error below is the report.
    }

    notifyOpened()
  }

  ipcMain.handle('workspace:open', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized workspace request.')
    }

    const mainWindow = getMainWindow()

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Project Folder',
      properties: ['openDirectory'],
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    const root = await setWorkspaceRoot(result.filePaths[0])
    const tree = await buildTree(root)

    await recordRecent(root)

    return { root, tree }
  })

  // Opens a single file by making its parent folder the workspace. File
  // operations stay workspace-rooted, so no renderer input can escape
  // the main-process path validation.
  ipcMain.handle('workspace:open-file', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized workspace request.')
    }

    const mainWindow = getMainWindow()

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open File',
      properties: ['openFile'],
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    const filePath = result.filePaths[0]
    const stat = await fs.stat(filePath)

    if (!stat.isFile()) {
      throw new Error('Only regular files can be opened.')
    }

    const root = await setWorkspaceRoot(path.dirname(filePath))
    const tree = await buildTree(root)

    await recordRecent(root)

    return { root, tree, filePath }
  })

  // Reopens a recent workspace without a dialog. The path must be an
  // existing directory; setWorkspaceRoot canonicalizes and validates it.
  ipcMain.handle('workspace:open-path', async (event, dirPath) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized workspace request.')
    }

    assertNonEmptyString(dirPath, 'path', 2000)

    let stat = null

    try {
      stat = await fs.stat(dirPath)
    } catch {
      await pruneRecent(dirPath)
      throw new Error(
        'That folder no longer exists. It was removed from recent projects.'
      )
    }

    if (!stat.isDirectory()) {
      await pruneRecent(dirPath)
      throw new Error('That path is not a folder.')
    }

    const root = await setWorkspaceRoot(dirPath)
    const tree = await buildTree(root)

    await recordRecent(root)

    return { root, tree }
  })

  ipcMain.handle('workspace:close', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized workspace request.')
    }

    return closeWorkspace()
  })

  ipcMain.handle('workspace:refresh', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized workspace request.')
    }

    const root = getWorkspaceRoot()

    if (!root) {
      throw new Error('Open a project folder first.')
    }

    const tree = await buildTree(root)

    return { root, tree }
  })
}
