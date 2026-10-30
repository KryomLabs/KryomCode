const { ipcMain } = require('electron')

const {
  getWorkspaceSummary,
  buildWorkspaceContext,
} = require('../services/project-intelligence/project-analyzer.service.cjs')
const {
  refreshIndex,
  getIndexStatus,
  checkIndexFreshness,
} = require('../services/project-intelligence/code-index.service.cjs')
const {
  indexSymbols,
  findSymbol,
  findReferences,
} = require('../services/project-intelligence/symbol-index.service.cjs')
const {
  analyzeArchitecture,
} = require('../services/project-intelligence/architecture.service.cjs')
const {
  searchProject,
} = require('../services/project-intelligence/semantic-search.service.cjs')
const {
  analyzeImpact,
} = require('../services/project-intelligence/impact-analysis.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
  assertStringArray,
} = require('../security/validate-input.cjs')

function assertOptionalPaths(value) {
  if (value === undefined || value === null) {
    return undefined
  }

  return assertStringArray(value, 'paths', { maxItems: 200, maxLength: 1000 })
}

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

  // Deep project intelligence (3C.1). All channels are read-only over
  // project sources; the index persists under .kryom/ only.

  ipcMain.handle('intelligence:index-status', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    return getIndexStatus()
  })

  ipcMain.handle('intelligence:index-refresh', async (event, payload = {}) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return refreshIndex({ force: options.force === true })
  })

  ipcMain.handle('intelligence:index-freshness', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    assertPlainObject(payload, 'freshness request')

    return checkIndexFreshness(
      assertStringArray(payload.paths, 'paths', { maxItems: 1000, maxLength: 1000 })
    )
  })

  ipcMain.handle('intelligence:symbols', async (event, payload = {}) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return indexSymbols({ paths: assertOptionalPaths(options.paths) ?? null })
  })

  ipcMain.handle('intelligence:symbol', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    assertPlainObject(payload, 'symbol request')

    return findSymbol(assertNonEmptyString(payload.name, 'symbol name', 200))
  })

  ipcMain.handle('intelligence:references', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    assertPlainObject(payload, 'references request')

    return findReferences(assertNonEmptyString(payload.name, 'symbol name', 200))
  })

  ipcMain.handle('intelligence:search', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    assertPlainObject(payload, 'search request')

    return searchProject(assertNonEmptyString(payload.query, 'query', 500))
  })

  ipcMain.handle('intelligence:impact', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    assertPlainObject(payload, 'impact request')

    return analyzeImpact({
      paths: assertStringArray(payload.paths, 'paths', { maxItems: 20, maxLength: 1000 }),
    })
  })

  ipcMain.handle('intelligence:architecture', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized intelligence request.')
    }

    return analyzeArchitecture()
  })
}
