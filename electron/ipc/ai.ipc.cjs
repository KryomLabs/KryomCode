const { ipcMain } = require('electron')

const {
  chat,
} = require('../services/ai/ai.service.cjs')

module.exports = function registerAIIPC({
  isTrustedSender,
}) {
  ipcMain.handle('ai:chat', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    return chat(payload)
  })
}
