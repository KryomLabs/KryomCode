// Update channels (Level 4B.3). User-driven only: the renderer can
// check status, trigger a check, download a verified artifact into
// staging, or cancel. Nothing installs, nothing runs, and the feed
// URL never comes from renderer input.
const { ipcMain, app } = require('electron')

const {
  assertPlainObject,
} = require('../security/validate-input.cjs')

function unauthorized() {
  throw new Error('Unauthorized update request.')
}

module.exports = function registerUpdateIPC({ isTrustedSender }) {
  // At most one active download: a second start cancels nothing and
  // fails loudly instead of interleaving staging writes.
  let activeDownload = null

  ipcMain.handle('update:status', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const {
      currentEnvironment,
    } = require('../services/release/environment.cjs')
    const {
      resolveFeedUrl,
      stagedArtifact,
    } = require('../services/update/update.service.cjs')

    const environment = currentEnvironment({ app })
    const staged = await stagedArtifact()

    return {
      version: environment.version,
      channel: environment.channel,
      environment: environment.environment,
      feedConfigured: resolveFeedUrl({}) !== '',
      staged,
    }
  })

  ipcMain.handle('update:check', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const {
      currentEnvironment,
    } = require('../services/release/environment.cjs')
    const {
      resolveFeedUrl,
      checkForUpdates,
    } = require('../services/update/update.service.cjs')

    const environment = currentEnvironment({ app })

    return checkForUpdates({
      feedUrl: resolveFeedUrl({}),
      currentVersion: environment.version,
      channel: environment.channel,
    })
  })

  ipcMain.handle('update:download', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'update download')

    const {
      currentEnvironment,
    } = require('../services/release/environment.cjs')
    const {
      resolveFeedUrl,
      checkForUpdates,
      downloadArtifact,
    } = require('../services/update/update.service.cjs')

    // Re-check at download time: the renderer never supplies a URL
    // or checksum. Whatever the feed says now is what we fetch.
    const environment = currentEnvironment({ app })
    const checked = await checkForUpdates({
      feedUrl: resolveFeedUrl({}),
      currentVersion: environment.version,
      channel: environment.channel,
    })

    if (!checked.available) {
      throw new Error(`No update to download: ${checked.reason}`)
    }

    const artifact = checked.manifest.artifacts.find(
      (entry) => entry.platform === process.platform
    )

    if (!artifact) {
      throw new Error(`Release ${checked.manifest.version} has no ${process.platform} artifact.`)
    }

    if (activeDownload) {
      throw new Error('An update download is already running.')
    }

    const controller = new AbortController()

    activeDownload = controller

    try {
      return await downloadArtifact({ artifact, signal: controller.signal })
    } finally {
      if (activeDownload === controller) {
        activeDownload = null
      }
    }
  })

  ipcMain.handle('update:cancel', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    if (!activeDownload) {
      return { cancelled: false }
    }

    activeDownload.abort()
    activeDownload = null

    const {
      clearStaged,
    } = require('../services/update/update.service.cjs')

    await clearStaged()

    return { cancelled: true }
  })

  ipcMain.handle('update:clear', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const {
      clearStaged,
    } = require('../services/update/update.service.cjs')

    await clearStaged()

    return { cleared: true }
  })
}
