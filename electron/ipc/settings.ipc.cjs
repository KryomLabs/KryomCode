const { ipcMain } = require('electron')

const {
  readSettings,
  updateSettings,
} = require('../services/settings/settings.service.cjs')
const {
  assertPlainObject,
} = require('../security/validate-input.cjs')

module.exports = function registerSettingsIPC({
  isTrustedSender,
}) {
  ipcMain.handle('settings:get', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized settings request.')
    }

    return readSettings()
  })

  ipcMain.handle('settings:update', async (event, patch) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized settings request.')
    }

    assertPlainObject(patch, 'settings patch')

    return updateSettings(patch)
  })
}
