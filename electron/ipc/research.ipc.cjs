const { ipcMain } = require('electron')

const {
  startResearch,
  getStatus,
  cancelResearch,
  resumeResearch,
} = require('../services/research/research.service.cjs')
const {
  listSessions,
  searchSessions,
  renameSession,
  deleteSession,
  readSession,
  readBrief,
  getActiveSession,
  setActiveSession,
  MAX_OBJECTIVE_LENGTH,
  MAX_NAME_LENGTH,
} = require('../services/research/session-store.cjs')
const {
  buildHtmlReport,
  buildHandoff,
} = require('../services/research/brief.service.cjs')
const { DEPTHS } = require('../services/research/depth-profiles.cjs')
const { SUPPORTED_MODELS } = require('../services/ai/ai-config.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
  assertOptionalString,
  assertEnum,
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

    const depth = payload.depth === undefined || payload.depth === null
      ? undefined
      : assertEnum(payload.depth, 'depth', DEPTHS)
    const model = payload.model === undefined || payload.model === null
      ? undefined
      : assertEnum(payload.model, 'model', SUPPORTED_MODELS)
    const name = assertOptionalString(payload.name, 'name', MAX_NAME_LENGTH)

    return startResearch(payload.objective.trim(), { depth, model, name })
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

  ipcMain.handle('research:rename', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.id, 'id', 64)
    assertNonEmptyString(payload.name, 'name', MAX_NAME_LENGTH)

    return renameSession(payload.id, payload.name.trim())
  })

  ipcMain.handle('research:delete', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.id, 'id', 64)

    return deleteSession(payload.id)
  })

  ipcMain.handle('research:search', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.query, 'query', 200)

    return searchSessions(payload.query.trim())
  })

  ipcMain.handle('research:export', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.id, 'id', 64)

    const format = payload.format === undefined || payload.format === null
      ? 'markdown'
      : assertEnum(payload.format, 'format', ['markdown', 'html'])
    const session = await readSession(payload.id)

    if (!session.brief || !session.brief.markdown || !session.brief.markdown.trim()) {
      throw new Error('This session has no generated report yet. Run research to completion first.')
    }

    if (format === 'html') {
      return {
        id: session.id,
        format,
        fileName: `report-${session.id.slice(0, 12)}.html`,
        content: buildHtmlReport(session),
      }
    }

    return {
      id: session.id,
      format,
      fileName: `report-${session.id.slice(0, 12)}.md`,
      content: session.brief.markdown,
    }
  })

  ipcMain.handle('research:handoff', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized research request.')
    }

    assertPlainObject(payload, 'research request')
    assertNonEmptyString(payload.id, 'id', 64)

    const target = payload.target === undefined || payload.target === null
      ? 'chat'
      : assertEnum(payload.target, 'target', ['chat', 'agent-brief'])

    let findingIndexes = null

    if (payload.findingIndexes !== undefined && payload.findingIndexes !== null) {
      if (!Array.isArray(payload.findingIndexes) || payload.findingIndexes.length > 20) {
        throw new Error('Invalid findingIndexes: provide up to 20 entries.')
      }

      for (const entry of payload.findingIndexes) {
        if (!Number.isInteger(entry) || entry < 1 || entry > 1000) {
          throw new Error('Invalid findingIndexes: every entry must be an integer from 1 to 1000.')
        }
      }

      findingIndexes = payload.findingIndexes
    }

    const session = await readSession(payload.id)

    return { id: session.id, target, text: buildHandoff(session, { findingIndexes, target }) }
  })
}
