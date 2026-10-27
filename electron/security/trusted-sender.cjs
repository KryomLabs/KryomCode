// Builds the trusted-renderer check for IPC handlers. Only the app's own
// main window may invoke privileged channels.

function createTrustedSender(getMainWindow) {
  return function isTrustedSender(event) {
    const mainWindow = getMainWindow()

    return Boolean(
      mainWindow &&
        !mainWindow.isDestroyed() &&
        event &&
        event.sender === mainWindow.webContents
    )
  }
}

module.exports = {
  createTrustedSender,
}
