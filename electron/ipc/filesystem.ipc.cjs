const { ipcMain } = require('electron')

const {
  readFile,
  saveFile,
} = require('../services/filesystem/file.service.cjs')

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
}