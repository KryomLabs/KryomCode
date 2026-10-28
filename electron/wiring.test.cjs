const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Wiring regression net: every backend module must load in plain Node
// with its documented exports, every IPC module must export a register
// function, and every relative require inside main/preload must resolve.
// main.cjs and preload.cjs cannot execute outside Electron, so their
// bodies are covered by static require resolution instead.

const MODULES = [
  ['./services/workspace/workspace.service.cjs', ['getWorkspaceRoot', 'setWorkspaceRoot', 'closeWorkspace', 'isInsideWorkspace', 'isInsideScope', 'buildTree']],
  ['./services/filesystem/file.service.cjs', ['readFile', 'saveFile']],
  ['./services/filesystem/directory.service.cjs', ['createFile', 'createDirectory', 'renamePath', 'deletePath', 'readFileWithMeta', 'writeFileIfUnchanged']],
  ['./services/filesystem/file-search.service.cjs', ['searchFiles']],
  ['./services/terminal/terminal.service.cjs', ['runCommand', 'buildChildEnv', 'listRunningProcesses', 'cancelRunningProcesses', 'killAllActiveProcesses']],
  ['./services/terminal/process-manager.cjs', ['registerProcess', 'unregisterProcess', 'listProcesses', 'killAllProcesses', 'killProcessTree']],
  ['./services/terminal/command-validator.cjs', ['classifyCommand']],
  ['./services/ai/ai.service.cjs', ['chat', 'cancelChat']],
  ['./services/ai/chat-store.cjs', ['saveChat', 'restoreChat', 'sanitizeMessages']],
  ['./services/ai/ai-config.service.cjs', ['getAIConfig', 'resolveModel', 'isSupportedModel']],
  ['./services/ai/providers/provider.interface.cjs', ['assertImplementsProvider']],
  ['./services/ai/providers/meta-muse.provider.cjs', ['MetaMuseProvider']],
  ['./services/ai/providers/mock.provider.cjs', ['MockProvider']],
  ['./services/agent/agent.service.cjs', ['planTask', 'applyEdits', 'cancelPlan']],
  ['./services/git/git.service.cjs', ['runGit', 'ensureRepository', 'getStatus', 'getRemotes', 'verifyRemote', 'cloneRepository', 'stageFiles', 'unstageFiles', 'discardChanges', 'commitChanges', 'pushChanges', 'pullChanges', 'killAllActiveProcesses']],
  ['./services/git/git-diff.service.cjs', ['getDiff', 'getChangedFiles']],
  ['./services/diagnostics/diagnostics.service.cjs', ['runDiagnostics']],
  ['./services/diagnostics/problem-parser.cjs', ['parseOutput']],
  ['./services/project-intelligence/project-analyzer.service.cjs', ['getWorkspaceSummary', 'buildWorkspaceContext']],
  ['./services/project-intelligence/dependency-analyzer.service.cjs', ['analyzeDependencies']],
  ['./services/settings/settings.service.cjs', ['readSettings', 'updateSettings']],
  ['./services/settings/secrets.service.cjs', ['getSecret', 'isSecretKey']],
  ['./services/ui/ui-state.service.cjs', ['readUIState', 'writeUIState', 'addRecent', 'clearRecent', 'removeRecent', 'setAutoSave']],
  ['./security/validate-path.cjs', ['resolveWorkspacePath']],
  ['./security/validate-input.cjs', ['assertPlainObject', 'assertNonEmptyString', 'assertOptionalString', 'assertStringArray', 'assertEnum', 'assertBoolean', 'assertExternalUrl']],
  ['./security/trusted-sender.cjs', ['createTrustedSender']],
  ['./utils/errors.cjs', ['createError']],
  ['./utils/logger.cjs', ['createLogger', 'redact']],
  ['./services/research/search-providers.cjs', ['searchAll', 'deduplicateSources', 'normalizeSource']],
  ['./services/research/url-fetch.service.cjs', ['fetchExcerpt', 'assertSafeUrl']],
  ['./services/research/session-store.cjs', ['createSession', 'readSession', 'writeSession', 'listSessions', 'getActiveSession']],
  ['./services/research/brief.service.cjs', ['validateBrief', 'buildExtractiveBrief', 'buildResearchContext', 'loadResearchContext']],
  ['./services/research/research.service.cjs', ['startResearch', 'getStatus', 'cancelResearch', 'resumeResearch']],
  ['./services/documents/document.service.cjs', ['exportBriefDocx', 'exportTextDocx', 'importDocxFile']],
]

const IPC_MODULES = [
  './ipc/workspace.ipc.cjs',
  './ipc/filesystem.ipc.cjs',
  './ipc/terminal.ipc.cjs',
  './ipc/ai.ipc.cjs',
  './ipc/git.ipc.cjs',
  './ipc/diagnostics.ipc.cjs',
  './ipc/project-intelligence.ipc.cjs',
  './ipc/agent.ipc.cjs',
  './ipc/settings.ipc.cjs',
  './ipc/research.ipc.cjs',
  './ipc/app.ipc.cjs',
  './ipc/documents.ipc.cjs',
  './ipc/register-handlers.cjs',
]

function relativeRequires(sourcePath) {
  const source = fs.readFileSync(sourcePath, 'utf8')

  return [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
    .map((match) => match[1])
    .filter((spec) => spec.startsWith('.'))
}

describe('backend wiring', () => {
  it('loads every service, security, and utility module', () => {
    for (const [modulePath, exports] of MODULES) {
      const loaded = require(modulePath)

      for (const name of exports) {
        assert.equal(
          typeof loaded[name] === 'function' || typeof loaded[name] === 'object',
          true,
          `${modulePath} must export ${name}`
        )
      }
    }
  })

  it('loads every IPC module with a register function', () => {
    for (const modulePath of IPC_MODULES) {
      assert.equal(typeof require(modulePath), 'function', modulePath)
    }
  })

  it('resolves every relative require in main and preload', () => {
    const mainRequires = relativeRequires(path.join(__dirname, 'main.cjs'))

    assert.ok(mainRequires.length > 0, 'main.cjs should have relative requires')

    for (const entry of ['main.cjs', 'preload.cjs']) {
      for (const spec of relativeRequires(path.join(__dirname, entry))) {
        assert.doesNotThrow(
          () => require.resolve(path.join(__dirname, spec)),
          `${entry}: ${spec}`
        )
      }
    }
  })
})
