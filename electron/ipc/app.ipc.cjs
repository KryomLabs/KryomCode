const { ipcMain, app } = require('electron')

const {
  readUIState,
  setAutoSave,
  clearRecent,
} = require('../services/ui/ui-state.service.cjs')
const { getSecret } = require('../services/settings/secrets.service.cjs')
const {
  assertPlainObject,
  assertBoolean,
} = require('../security/validate-input.cjs')

module.exports = function registerAppIPC({
  isTrustedSender,
  onUIStateChanged,
  onUIContext,
}) {
  ipcMain.handle('app:get-version', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized app request.')
    }

    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
    }
  })

  // Configuration presence only: booleans cross the bridge, never key
  // material. The Connections view uses this for setup guidance.
  ipcMain.handle('app:get-ai-status', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized app request.')
    }

    return {
      modelKeyConfigured: getSecret('MODEL_API_KEY').length > 0,
      researchKeyConfigured: getSecret('TAVILY_API_KEY').length > 0,
    }
  })

  ipcMain.handle('ui:get', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized UI request.')
    }

    return readUIState()
  })

  ipcMain.handle('ui:set', async (event, patch) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized UI request.')
    }

    assertPlainObject(patch, 'UI patch')

    let state = await readUIState()

    if (patch.autoSave !== undefined) {
      state = await setAutoSave(assertBoolean(patch.autoSave, 'autoSave'))
    }

    if (patch.clearRecent === true) {
      state = await clearRecent()
    }

    if (typeof onUIStateChanged === 'function') {
      onUIStateChanged(state)
    }

    return state
  })

  // Renderer capability push for native-menu enabled states. Plain
  // booleans; unknown or malformed input disables guarded items.
  ipcMain.handle('ui:context', async (event, ctx) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized UI request.')
    }

    if (typeof onUIContext === 'function' && ctx && typeof ctx === 'object') {
      onUIContext({
        hasWorkspace: ctx.hasWorkspace === true,
        hasEditor: ctx.hasEditor === true,
      })
    }

    return { success: true }
  })
}
