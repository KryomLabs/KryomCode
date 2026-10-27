const { ipcMain } = require('electron')

const {
  getWorkspaceSummary,
  buildWorkspaceContext,
} = require('../services/project-intelligence/project-analyzer.service.cjs')

module.exports = function registerIntelligenceIPC({
  isTrustedSender,
}) {
  ipcMain.handle('intelligence:summary', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    return getWorkspaceSummary()
  })

  ipcMain.handle('intelligence:context', async (event, payload = {}) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}
    const maxChars =
      typeof options.maxChars === 'number' &&
      Number.isFinite(options.maxChars)
        ? Math.min(Math.max(1000, Math.floor(options.maxChars)), 12000)
        : undefined

    return buildWorkspaceContext(
      maxChars === undefined ? {} : { maxChars }
    )
  })
}
