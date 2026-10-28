// Builds the trusted-renderer check for IPC handlers. Only the app's
// own windows may invoke privileged channels. The getter may return a
// single window (or null) or an array of windows for multi-window mode.

function createTrustedSender(getWindows) {
  return function isTrustedSender(event) {
    if (!event || !event.sender) {
      return false
    }

    const target = getWindows()
    const list = Array.isArray(target) ? target : [target]

    return list.some(
      (window) =>
        Boolean(window) &&
        !window.isDestroyed() &&
        window.webContents === event.sender
    )
  }
}

module.exports = {
  createTrustedSender,
}
