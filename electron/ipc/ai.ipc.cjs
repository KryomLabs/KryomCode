const { ipcMain } = require('electron')

const {
  chat,
  cancelChat,
} = require('../services/ai/ai.service.cjs')
const {
  saveChat,
  restoreChat,
  listChatSessions,
  createChatSession,
  switchChatSession,
  renameChatSession,
  deleteChatSession,
} = require('../services/ai/chat-store.cjs')
const {
  assertNonEmptyString,
  assertOptionalString,
} = require('../security/validate-input.cjs')

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

    const root = assertOptionalString(payload.root, 'root', 2000)

    return saveChat(payload.messages, { root: root ?? undefined })
  })

  ipcMain.handle('chat:restore', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    return restoreChat()
  })

  ipcMain.handle('chat:sessions', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    return listChatSessions()
  })

  ipcMain.handle('chat:create', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return createChatSession(assertOptionalString(options.title, 'title', 80) ?? undefined)
  })

  ipcMain.handle('chat:switch', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return switchChatSession(assertNonEmptyString(options.id, 'id', 64))
  })

  ipcMain.handle('chat:rename', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return renameChatSession(
      assertNonEmptyString(options.id, 'id', 64),
      assertOptionalString(options.title, 'title', 80) ?? undefined
    )
  })

  ipcMain.handle('chat:delete', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized AI request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return deleteChatSession(assertNonEmptyString(options.id, 'id', 64))
  })
}
