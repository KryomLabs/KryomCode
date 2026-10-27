const { ipcMain, dialog } = require('electron')

const {
  setWorkspaceRoot,
  buildTree,
} = require('../services/workspace/workspace.service.cjs')

module.exports = function registerWorkspaceIPC({
  getMainWindow,
  isTrustedSender,
}) {
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

    return { root, tree }
  })
}