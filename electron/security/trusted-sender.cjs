// Builds the trusted-renderer check for IPC handlers. Only the app's
// own windows may invoke privileged channels. The getter may return a
// single window (or null) or an array of windows for multi-window mode.
//
// When options.isTrustedAppUrl is provided, the calling frame must
// additionally be the app's own main frame: a known webContents alone
// is not enough, so an attacker-navigated page or subframe cannot
// ride the preload bridge.

function createTrustedSender(getWindows, options = {}) {
  const isTrustedAppUrl =
    options && typeof options.isTrustedAppUrl === 'function'
      ? options.isTrustedAppUrl
      : null

  return function isTrustedSender(event) {
    if (!event || !event.sender) {
      return false
    }

    const target = getWindows()
    const list = Array.isArray(target) ? target : [target]

    const known = list.some(
      (window) =>
        Boolean(window) &&
        !window.isDestroyed() &&
        window.webContents === event.sender
    )

    if (!known) {
      return false
    }

    if (!isTrustedAppUrl) {
      return true
    }

    const frame = event.senderFrame

    if (!frame || typeof frame.url !== 'string') {
      return false
    }

    // Main frame only: WebFrameMain.parent is null exactly for the
    // top-level frame.
    if (frame.parent !== null) {
      return false
    }

    return isTrustedAppUrl(frame.url)
  }
}

module.exports = {
  createTrustedSender,
}
