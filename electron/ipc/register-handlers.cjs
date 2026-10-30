const registerWorkspaceIPC = require('./workspace.ipc.cjs')
const registerFilesystemIPC = require('./filesystem.ipc.cjs')
const registerTerminalIPC = require('./terminal.ipc.cjs')
const registerAIIPC = require('./ai.ipc.cjs')
const registerGitIPC = require('./git.ipc.cjs')
const registerDiagnosticsIPC = require('./diagnostics.ipc.cjs')
const registerIntelligenceIPC = require('./project-intelligence.ipc.cjs')
const registerAgentIPC = require('./agent.ipc.cjs')
const registerSettingsIPC = require('./settings.ipc.cjs')
const registerResearchIPC = require('./research.ipc.cjs')
const registerAppIPC = require('./app.ipc.cjs')
const registerDocumentsIPC = require('./documents.ipc.cjs')
const registerMemoryIPC = require('./memory.ipc.cjs')
const registerPlatformIPC = require('./platform.ipc.cjs')
const registerUpdateIPC = require('./update.ipc.cjs')

module.exports = function registerHandlers({
  getMainWindow,
  getWindows,
  isTrustedSender,
  onUIStateChanged,
  onUIContext,
  onWorkspaceOpened,
}) {
  registerWorkspaceIPC({
    getMainWindow,
    isTrustedSender,
    onWorkspaceOpened,
  })

  registerFilesystemIPC({
    isTrustedSender,
    getMainWindow,
  })

  registerTerminalIPC({
    isTrustedSender,
  })

  registerAIIPC({
    isTrustedSender,
  })

  registerGitIPC({
    isTrustedSender,
    getMainWindow,
    onWorkspaceOpened,
  })

  registerDiagnosticsIPC({
    isTrustedSender,
    getMainWindow,
  })

  registerIntelligenceIPC({
    isTrustedSender,
  })

  registerAgentIPC({
    isTrustedSender,
  })

  registerSettingsIPC({
    isTrustedSender,
  })

  registerResearchIPC({
    isTrustedSender,
  })

  registerAppIPC({
    isTrustedSender,
    getMainWindow,
    onUIStateChanged,
    onUIContext,
    getWindows,
  })

  registerDocumentsIPC({
    isTrustedSender,
    getMainWindow,
  })

  registerMemoryIPC({
    isTrustedSender,
    getMainWindow,
  })

  registerPlatformIPC({
    isTrustedSender,
    getMainWindow,
  })

  registerUpdateIPC({
    isTrustedSender,
  })
}
