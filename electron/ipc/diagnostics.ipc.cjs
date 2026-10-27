const { ipcMain } = require('electron')

const {
  runDiagnostics,
} = require('../services/diagnostics/diagnostics.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
} = require('../security/validate-input.cjs')

module.exports = function registerDiagnosticsIPC({
  isTrustedSender,
}) {
  ipcMain.handle('diagnostics:run', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized diagnostics request.')
    }

    assertPlainObject(payload, 'diagnostics payload')
    assertNonEmptyString(payload.command, 'command', 2000)

    return runDiagnostics(payload.command)
  })
}
