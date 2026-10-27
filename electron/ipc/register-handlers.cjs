const registerWorkspaceIPC = require('./workspace.ipc.cjs')
const registerFilesystemIPC = require('./filesystem.ipc.cjs')

module.exports = function registerHandlers({
  getMainWindow,
  isTrustedSender,
}) {
  registerWorkspaceIPC({
    getMainWindow,
    isTrustedSender,
  })

  registerFilesystemIPC({
    isTrustedSender,
  })
}