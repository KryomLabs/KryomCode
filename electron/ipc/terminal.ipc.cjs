const { ipcMain } = require('electron')

const {
  runCommand,
  listRunningProcesses,
  cancelRunningProcesses,
} = require('../services/terminal/terminal.service.cjs')

module.exports = function registerTerminalIPC({
  isTrustedSender,
}) {
  ipcMain.handle('terminal:run', async (event, command) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized terminal request.')
    }

    return runCommand(command)
  })

  ipcMain.handle('terminal:cancel', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized terminal request.')
    }

    return cancelRunningProcesses()
  })

  ipcMain.handle('terminal:status', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized terminal request.')
    }

    return { running: listRunningProcesses() }
  })
}
