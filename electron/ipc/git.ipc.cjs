const { ipcMain, dialog } = require('electron')

const {
  getStatus,
  getRemotes,
  verifyRemote,
  cloneRepository,
  stageFiles,
  unstageFiles,
  discardChanges,
  commitChanges,
  pushChanges,
  pullChanges,
} = require('../services/git/git.service.cjs')
const {
  setWorkspaceRoot,
  buildTree,
} = require('../services/workspace/workspace.service.cjs')
const {
  addRecent,
} = require('../services/ui/ui-state.service.cjs')
const {
  getDiff,
  getChangedFiles,
} = require('../services/git/git-diff.service.cjs')
const {
  assertPlainObject,
  assertOptionalString,
  assertStringArray,
  assertNonEmptyString,
} = require('../security/validate-input.cjs')

// Every consequential operation is its own channel: the renderer must
// invoke commit or push explicitly, which is the user-approval boundary.

module.exports = function registerGitIPC({
  isTrustedSender,
  getMainWindow,
  onWorkspaceOpened,
}) {
  async function recordRecent(root) {
    try {
      await addRecent(root)
    } catch {
      // Auxiliary: never fail the clone-open itself.
    }

    if (typeof onWorkspaceOpened === 'function') {
      onWorkspaceOpened()
    }
  }

  ipcMain.handle('git:status', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    return getStatus()
  })

  ipcMain.handle('git:diff', async (event, payload = {}) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return getDiff({
      staged: options.staged === true,
      path: options.path ?? undefined,
    })
  })

  ipcMain.handle('git:changed-files', async (event, payload = {}) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return getChangedFiles({ staged: options.staged === true })
  })

  ipcMain.handle('git:stage', async (event, paths) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    assertStringArray(paths, 'paths', { maxItems: 200 })

    return stageFiles(paths)
  })

  ipcMain.handle('git:unstage', async (event, paths) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    assertStringArray(paths, 'paths', { maxItems: 200 })

    return unstageFiles(paths)
  })

  ipcMain.handle('git:discard', async (event, paths) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    assertStringArray(paths, 'paths', { maxItems: 200 })

    return discardChanges(paths)
  })

  ipcMain.handle('git:commit', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    assertPlainObject(payload, 'commit payload')
    assertNonEmptyString(payload.message, 'commit message', 2000)

    return commitChanges(payload.message)
  })

  ipcMain.handle('git:push', async (event, payload = {}) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return pushChanges(
      assertOptionalString(options.remote, 'remote', 200) ?? undefined,
      assertOptionalString(options.branch, 'branch', 200) ?? undefined
    )
  })

  ipcMain.handle('git:pull', async (event, payload = {}) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return pullChanges(
      assertOptionalString(options.remote, 'remote', 200) ?? undefined,
      assertOptionalString(options.branch, 'branch', 200) ?? undefined
    )
  })

  ipcMain.handle('git:remotes', async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    return getRemotes()
  })

  ipcMain.handle('git:verify', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    assertPlainObject(payload, 'verify payload')
    assertNonEmptyString(payload.url, 'repository URL', 2000)

    return verifyRemote(payload.url)
  })

  ipcMain.handle('git:clone', async (event, payload) => {
    if (!isTrustedSender(event)) {
      throw new Error('Unauthorized git request.')
    }

    assertPlainObject(payload, 'clone payload')
    assertNonEmptyString(payload.url, 'repository URL', 2000)

    const mainWindow =
      typeof getMainWindow === 'function' ? getMainWindow() : null

    const choice = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose clone destination folder',
      properties: ['openDirectory'],
    })

    if (choice.canceled || !choice.filePaths[0]) {
      return null
    }

    const cloned = await cloneRepository(
      payload.url,
      choice.filePaths[0],
      assertOptionalString(payload.name, 'folder name', 100) ?? undefined
    )
    const root = await setWorkspaceRoot(cloned.path)
    const tree = await buildTree(root)

    await recordRecent(root)

    return { root, tree, path: cloned.path }
  })
}
