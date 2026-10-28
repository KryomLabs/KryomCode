const { ipcMain } = require('electron')

const {
  startResearch,
  getStatus,
  cancelResearch,
  resumeResearch,
} = require('../services/research/research.service.cjs')
const {
  listSessions,
  readSession,
  readBrief,
  getActiveSession,
  setActiveSession,
  MAX_OBJECTIVE_LENGTH,
} = require('../services/research/session-store.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
} = require('../security/validate-input.cjs')

// Research runs in the background: start/resume return immediately and
// the renderer polls status. Every response reflects persisted state;
// progress is never simulated.
module.exports = function registerResearchIPC({
  isTrustedSender,
}) {
  ipcMain.handle('research:start', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.objective, 'objective', MAX_OBJECTIVE_LENGTH)

    return startResearch(payload.objective.trim())
  })

  ipcMain.handle('research:status', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research status request')
    assertNonEmptyString(payload.id, 'id', 64)

    return getStatus(payload.id)
  })

  ipcMain.handle('research:active', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    return getActiveSession()
  })

  ipcMain.handle('research:list', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    return listSessions()
  })

  ipcMain.handle('research:get', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.id, 'id', 64)

    return readSession(payload.id)
  })

  ipcMain.handle('research:brief', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.id, 'id', 64)

    const markdown = await readBrief(payload.id)

    return { id: payload.id, markdown }
  })

  ipcMain.handle('research:cancel', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.id, 'id', 64)

    return cancelResearch(payload.id)
  })

  ipcMain.handle('research:resume', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.id, 'id', 64)

    return resumeResearch(payload.id)
  })

  ipcMain.handle('research:select', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.id, 'id', 64)

    await readSession(payload.id)

    return setActiveSession(payload.id)
  })
}
