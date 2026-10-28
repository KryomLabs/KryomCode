const { ipcMain } = require('electron')

const {
  chat,
  cancelChat,
} = require('../services/ai/ai.service.cjs')
const {
  saveChat,
  restoreChat,
} = require('../services/ai/chat-store.cjs')

module.exports = function registerAIIPC({
  isTrustedSender,
}) {
  ipcMain.handle('ai:chat', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    return chat(payload)
  })

  ipcMain.handle('ai:cancel', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    return cancelChat()
  })

  ipcMain.handle('chat:save', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    if (!payload || !Array.isArray(payload.messages)) {
      throw new Error('Invalid chat history.')
    }

    return saveChat(payload.messages)
  })

  ipcMain.handle('chat:restore', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    return restoreChat()
  })
}
