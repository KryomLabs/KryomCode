const { ipcMain } = require('electron')

const {
  getStatus,
  stageFiles,
  commitChanges,
  pushChanges,
} = require('../services/git/git.service.cjs')
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
}) {
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
}
