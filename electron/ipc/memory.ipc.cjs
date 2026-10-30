const { ipcMain, dialog } = require('electron')
const path = require('node:path')

const {
  listMemories,
  getMemory,
  createMemory,
  updateMemory,
  deleteMemory,
  deleteAllMemories,
  exportMemoriesToFile,
} = require('../services/memory/memory.store.cjs')
const {
  getWorkspaceRoot,
} = require('../services/workspace/workspace.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
  assertOptionalString,
  assertEnum,
} = require('../security/validate-input.cjs')

// Payload shapes are checked here so malformed renderer input fails
// fast; the store re-validates everything (including source refs and
// digests, which only the service may capture).
function assertSourceSpec(spec, index) {
  assertPlainObject(spec, `sources[${index}]`)

  const kind = assertEnum(
    spec.kind,
    `sources[${index}].kind`,
    ['file', 'chat', 'research', 'commit']
  )

  if (kind === 'file') {
    assertNonEmptyString(spec.path, `sources[${index}].path`, 2000)

    return { kind, path: spec.path }
  }

  if (kind === 'research') {
    assertNonEmptyString(spec.sessionId, `sources[${index}].sessionId`, 64)

    return { kind, sessionId: spec.sessionId }
  }

  if (kind === 'commit') {
    assertNonEmptyString(spec.sha, `sources[${index}].sha`, 64)

    return { kind, sha: spec.sha }
  }

  return { kind }
}

function assertSourceSpecs(value) {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value) || value.length > 20) {
    throw new Error('Invalid sources: provide an array of at most 20.')
  }

  return value.map((spec, index) => assertSourceSpec(spec, index))
}

module.exports = function registerMemoryIPC({
  isTrustedSender,
  getMainWindow,
}) {
  ipcMain.handle('memory:list', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized memory request.')
    }

    return listMemories()
  })

  ipcMain.handle('memory:get', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized memory request.')
    }

    assertPlainObject(payload, 'memory request')

    return getMemory(assertNonEmptyString(payload.id, 'id', 80))
  })

  ipcMain.handle('memory:create', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized memory request.')
    }

    assertPlainObject(payload, 'memory record')

    return createMemory({
      type: assertEnum(payload.type, 'type', ['decision', 'convention', 'fact']),
      title: assertOptionalString(payload.title, 'title', 200) ?? undefined,
      content: assertNonEmptyString(payload.content, 'content', 20000),
      sources: assertSourceSpecs(payload.sources),
    })
  })

  ipcMain.handle('memory:update', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized memory request.')
    }

    assertPlainObject(payload, 'memory update')

    const patch = {}

    if (payload.type !== undefined) {
      patch.type = assertEnum(payload.type, 'type', ['decision', 'convention', 'fact'])
    }

    if (payload.title !== undefined) {
      patch.title =
        payload.title === null
          ? null
          : assertNonEmptyString(payload.title, 'title', 200)
    }

    if (payload.content !== undefined) {
      patch.content = assertNonEmptyString(payload.content, 'content', 20000)
    }

    if (payload.sources !== undefined) {
      patch.sources = assertSourceSpecs(payload.sources)
    }

    return updateMemory(assertNonEmptyString(payload.id, 'id', 80), patch)
  })

  ipcMain.handle('memory:delete', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized memory request.')
    }

    assertPlainObject(payload, 'memory request')

    return deleteMemory(assertNonEmptyString(payload.id, 'id', 80))
  })

  ipcMain.handle('memory:delete-all', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized memory request.')
    }

    return deleteAllMemories()
  })

  // Export asks the OS for a destination: the renderer never supplies
  // the path, so it may live anywhere (backup use). Cancellation is a
  // normal outcome, not an error.
  ipcMain.handle('memory:export', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized memory request.')
    }

    const root = getWorkspaceRoot()

    if (!root) {
      throw new Error('Open a project folder first.')
    }

    const mainWindow =
      typeof getMainWindow === 'function' ? getMainWindow() : null

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export project memory',
      defaultPath: path.join(root, 'memory-export.json'),
      filters: [{ name: 'JSON document', extensions: ['json'] }],
    })

    if (result.canceled || !result.filePath) {
      return { cancelled: true }
    }

    return {
      cancelled: false,
      ...(await exportMemoriesToFile(result.filePath)),
    }
  })
}
