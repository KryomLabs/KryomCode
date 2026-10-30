const { ipcMain, dialog } = require('electron')

const {
  registerBuiltins: registerProviderBuiltins,
  listProviders,
  describeProvider,
  getProvider,
} = require('../services/ai/providers/provider-registry.cjs')
const {
  listModels,
  getModel,
} = require('../services/ai/providers/model-catalog.cjs')
const {
  readProviderConfig,
  updateProviderConfig,
  testConnection,
} = require('../services/ai/provider-config.cjs')
const {
  defaultRoute,
} = require('../services/ai/router.cjs')
const {
  checkPermission,
  requirePermission,
  grantPermission,
  revokePermission,
  listGrants,
  describePermissions,
} = require('../services/permissions/permission.service.cjs')
const {
  appendAudit,
  listAudit,
} = require('../services/audit/audit.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
  assertOptionalString,
  assertStringArray,
  assertEnum,
} = require('../security/validate-input.cjs')

function unauthorized() {
  throw new Error('Unauthorized platform request.')
}

async function audit(type, subject, detail, outcome = null) {
  try {
    await appendAudit(type, { subject, detail, outcome }, undefined)
  } catch {
    // Audit failure never fails the platform operation.
  }
}

module.exports = function registerPlatformIPC({
  isTrustedSender,
  getMainWindow,
}) {
  // Providers (4A.1). Selection and configuration only; secrets
  // stay in the env allowlist and never cross this boundary.
  ipcMain.handle('provider:list', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    registerProviderBuiltins()

    return { providers: listProviders() }
  })

  ipcMain.handle('provider:get', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'provider')

    registerProviderBuiltins()

    return describeProvider(assertNonEmptyString(payload.providerId, 'provider id', 60))
  })

  ipcMain.handle('provider:selection', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    registerProviderBuiltins()

    const [config, route] = await Promise.all([readProviderConfig(), defaultRoute()])

    return { config, route }
  })

  ipcMain.handle('provider:configure', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'provider patch')

    registerProviderBuiltins()

    return updateProviderConfig(payload)
  })

  ipcMain.handle('provider:models', async (event, payload = {}) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    registerProviderBuiltins()

    if (options.providerId !== undefined && options.providerId !== null) {
      return {
        models: listModels(assertNonEmptyString(options.providerId, 'provider id', 60)),
      }
    }

    return { models: listModels() }
  })

  ipcMain.handle('provider:model', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'model')

    registerProviderBuiltins()

    return getModel(
      assertNonEmptyString(payload.providerId, 'provider id', 60),
      assertNonEmptyString(payload.modelId, 'model id', 100)
    )
  })

  ipcMain.handle('provider:test', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'connection test')

    registerProviderBuiltins()

    return testConnection(assertNonEmptyString(payload.providerId, 'provider id', 60), {
      live: payload.live === true,
    })
  })

  // User-owned credentials (Level 3C). Keys travel renderer → main
  // only, are encrypted with safeStorage before persisting, and are
  // NEVER returned: every response carries presence info alone.
  ipcMain.handle('provider:set-key', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'provider key')

    registerProviderBuiltins()

    const providerId = assertNonEmptyString(payload.providerId, 'provider id', 60)
    const descriptor = getProvider(providerId)

    if (!descriptor.auth || descriptor.auth.kind !== 'api-key') {
      throw new Error(`Provider "${providerId}" needs no API key.`)
    }

    if (typeof payload.apiKey !== 'string') {
      throw new Error('Invalid API key: a string is required.')
    }

    const { setVaultSecret } = require('../services/settings/credential-vault.cjs')
    const result = await setVaultSecret(descriptor.auth.secretEnv, payload.apiKey)

    await audit('provider.key-saved', providerId, 'API key stored in the OS credential vault.', 'configured')

    return result
  })

  ipcMain.handle('provider:remove-key', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'provider key removal')

    registerProviderBuiltins()

    const providerId = assertNonEmptyString(payload.providerId, 'provider id', 60)
    const descriptor = getProvider(providerId)

    if (!descriptor.auth || descriptor.auth.kind !== 'api-key') {
      throw new Error(`Provider "${providerId}" needs no API key.`)
    }

    const { removeVaultSecret } = require('../services/settings/credential-vault.cjs')
    const result = await removeVaultSecret(descriptor.auth.secretEnv)

    await audit('provider.key-removed', providerId, 'API key removed from the OS credential vault.', 'removed')

    return result
  })

  ipcMain.handle('provider:key-status', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'provider key status')

    registerProviderBuiltins()

    const providerId = assertNonEmptyString(payload.providerId, 'provider id', 60)
    const descriptor = getProvider(providerId)

    const { isVaultAvailable } = require('../services/settings/credential-vault.cjs')
    const { getSecret, getSecretSource } = require('../services/settings/secrets.service.cjs')

    if (!descriptor.auth || descriptor.auth.kind !== 'api-key') {
      return {
        providerId,
        available: isVaultAvailable(),
        configured: true,
        source: 'none',
      }
    }

    return {
      providerId,
      available: isVaultAvailable(),
      configured: getSecret(descriptor.auth.secretEnv).length > 0,
      source: getSecretSource(descriptor.auth.secretEnv),
    }
  })

  // Permissions (4A.7). Grants are explicit user actions from the
  // UI confirm flow; every grant/denial/revocation audits.
  ipcMain.handle('permission:list', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    return { permissions: describePermissions() }
  })

  ipcMain.handle('permission:grants', async (event, payload = {}) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const options = payload && typeof payload === 'object' ? payload : {}

    return listGrants(
      options.subject === undefined || options.subject === null
        ? null
        : assertNonEmptyString(options.subject, 'subject', 200)
    )
  })

  ipcMain.handle('permission:check', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'permission check')

    return checkPermission(
      assertNonEmptyString(payload.subject, 'subject', 200),
      assertNonEmptyString(payload.permission, 'permission', 80)
    )
  })

  ipcMain.handle('permission:grant', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'permission grant')

    const subject = assertNonEmptyString(payload.subject, 'subject', 200)
    const permission = assertNonEmptyString(payload.permission, 'permission', 80)
    const granted = await grantPermission(subject, permission)

    await audit('permission.granted', subject, permission, 'granted')

    return granted
  })

  ipcMain.handle('permission:revoke', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'permission revoke')

    const subject = assertNonEmptyString(payload.subject, 'subject', 200)
    const permission = payload.permission === undefined || payload.permission === null
      ? null
      : assertNonEmptyString(payload.permission, 'permission', 80)
    const revoked = await revokePermission(subject, permission)

    await audit('permission.revoked', subject, permission || 'all', 'revoked')

    return revoked
  })

  ipcMain.handle('audit:list', async (event, payload = {}) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const options = payload && typeof payload === 'object' ? payload : {}
    const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.min(Math.max(1, Math.floor(options.limit)), 500)
      : 100

    return listAudit({ limit })
  })

  // Extensions (4A.2). Install points at local directories only;
  // no archives, no remote registry, no auto-activation.
  ipcMain.handle('extension:list', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const { list } = require('../services/extensions/lifecycle.cjs')

    return list({})
  })

  ipcMain.handle('extension:get', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'extension')

    const { status } = require('../services/extensions/lifecycle.cjs')

    return status(assertNonEmptyString(payload.id, 'id', 100), {})
  })

  ipcMain.handle('extension:pick-directory', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Install Local Extension',
      properties: ['openDirectory'],
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    return { path: result.filePaths[0] }
  })

  ipcMain.handle('extension:install', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'extension install')

    const { install } = require('../services/extensions/lifecycle.cjs')

    return install(assertNonEmptyString(payload.path, 'path', 2000), {
      dev: payload.dev === true,
    })
  })

  ipcMain.handle('extension:enable', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'extension enable')

    const { enable } = require('../services/extensions/lifecycle.cjs')

    return enable(assertNonEmptyString(payload.id, 'id', 100), {})
  })

  ipcMain.handle('extension:disable', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'extension disable')

    const { disable } = require('../services/extensions/lifecycle.cjs')

    return disable(assertNonEmptyString(payload.id, 'id', 100), {})
  })

  ipcMain.handle('extension:activate', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'extension activate')

    const { activate } = require('../services/extensions/lifecycle.cjs')

    return activate(assertNonEmptyString(payload.id, 'id', 100), {})
  })

  ipcMain.handle('extension:deactivate', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'extension deactivate')

    const { deactivate } = require('../services/extensions/lifecycle.cjs')

    return deactivate(assertNonEmptyString(payload.id, 'id', 100), {})
  })

  ipcMain.handle('extension:uninstall', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'extension uninstall')

    const { uninstall } = require('../services/extensions/lifecycle.cjs')

    return uninstall(assertNonEmptyString(payload.id, 'id', 100), {})
  })

  ipcMain.handle('extension:command', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'extension command')

    const { runCommand } = require('../services/extensions/lifecycle.cjs')

    if (payload.args !== undefined && payload.args !== null && typeof payload.args !== 'object') {
      throw new Error('Invalid command args: an object is required.')
    }

    return runCommand(
      assertNonEmptyString(payload.id, 'id', 100),
      assertNonEmptyString(payload.commandId, 'command id', 120),
      payload.args || {}
    )
  })

  // Skills (4A.3). Definitions validate on save; execution enforces
  // grants and approval gates in the runner.
  ipcMain.handle('skill:list', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const { listSkills } = require('../services/skills/skill-store.cjs')

    return listSkills({})
  })

  ipcMain.handle('skill:get', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'skill')

    const { getSkill } = require('../services/skills/skill-store.cjs')

    return getSkill(assertNonEmptyString(payload.id, 'id', 80), {})
  })

  ipcMain.handle('skill:save', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'skill save')
    assertPlainObject(payload.skill, 'skill document')

    const { saveSkill } = require('../services/skills/skill-store.cjs')

    return saveSkill(payload.skill, {
      scope: assertEnum(payload.scope || 'user', 'scope', ['user', 'project']),
    })
  })

  ipcMain.handle('skill:delete', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'skill delete')

    const { deleteSkill } = require('../services/skills/skill-store.cjs')

    return deleteSkill(assertNonEmptyString(payload.id, 'id', 80), {
      scope: assertEnum(payload.scope || 'user', 'scope', ['user', 'project']),
    })
  })

  ipcMain.handle('skill:set-enabled', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'skill enable')

    const { setSkillEnabled } = require('../services/skills/skill-store.cjs')

    if (typeof payload.enabled !== 'boolean') {
      throw new Error('Invalid enabled flag: a boolean is required.')
    }

    return setSkillEnabled(assertNonEmptyString(payload.id, 'id', 80), payload.enabled, {})
  })

  ipcMain.handle('skill:run', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'skill run')

    const { runSkill } = require('../services/skills/skill-runner.cjs')

    return runSkill({
      skillId: assertNonEmptyString(payload.skillId, 'skill id', 80),
      task: assertNonEmptyString(payload.task, 'task', 4000),
      contextPaths: payload.contextPaths === undefined || payload.contextPaths === null
        ? undefined
        : assertStringArray(payload.contextPaths, 'context paths', { maxItems: 32, maxLength: 1000 }),
      planId: assertOptionalString(payload.planId, 'plan id', 80) ?? undefined,
      approved: payload.approved === true,
      params: payload.params !== undefined && payload.params !== null ? payload.params : undefined,
    })
  })

  // Workflows (4A.3). Explicit advance/approve/resume/cancel — the
  // engine never runs autonomously.
  ipcMain.handle('workflow:list', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const { listWorkflows } = require('../services/workflows/workflow-store.cjs')

    return listWorkflows({})
  })

  ipcMain.handle('workflow:get', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'workflow')

    const { getWorkflow } = require('../services/workflows/workflow-store.cjs')

    return getWorkflow(assertNonEmptyString(payload.id, 'id', 80), {})
  })

  ipcMain.handle('workflow:save', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'workflow save')
    assertPlainObject(payload.workflow, 'workflow document')

    const { saveWorkflow } = require('../services/workflows/workflow-store.cjs')

    return saveWorkflow(payload.workflow, {
      scope: assertEnum(payload.scope || 'user', 'scope', ['user', 'project']),
    })
  })

  ipcMain.handle('workflow:delete', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'workflow delete')

    const { deleteWorkflow } = require('../services/workflows/workflow-store.cjs')

    return deleteWorkflow(assertNonEmptyString(payload.id, 'id', 80), {
      scope: assertEnum(payload.scope || 'user', 'scope', ['user', 'project']),
    })
  })

  ipcMain.handle('workflow:start', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'workflow start')

    const { startRun } = require('../services/workflows/workflow-engine.cjs')

    if (payload.inputs !== undefined && payload.inputs !== null && typeof payload.inputs !== 'object') {
      throw new Error('Invalid inputs: an object is required.')
    }

    return startRun({
      workflowId: assertNonEmptyString(payload.workflowId, 'workflow id', 80),
      task: assertOptionalString(payload.task, 'task', 4000) ?? undefined,
      inputs: payload.inputs || undefined,
    })
  })

  ipcMain.handle('workflow:advance', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'workflow advance')

    const { advanceRun } = require('../services/workflows/workflow-engine.cjs')

    return advanceRun(assertNonEmptyString(payload.runId, 'run id', 80))
  })

  ipcMain.handle('workflow:approve', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'workflow approval')

    const { approveRun } = require('../services/workflows/workflow-engine.cjs')

    return approveRun(assertNonEmptyString(payload.runId, 'run id', 80), {
      decision: assertEnum(payload.decision, 'decision', ['approve', 'deny']),
      note: assertOptionalString(payload.note, 'note', 500) ?? undefined,
    })
  })

  ipcMain.handle('workflow:resume', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'workflow resume')

    const { resumeRun } = require('../services/workflows/workflow-engine.cjs')

    return resumeRun(assertNonEmptyString(payload.runId, 'run id', 80))
  })

  ipcMain.handle('workflow:cancel', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'workflow cancel')

    const { cancelRun } = require('../services/workflows/workflow-engine.cjs')

    return cancelRun(assertNonEmptyString(payload.runId, 'run id', 80))
  })

  ipcMain.handle('workflow:get-run', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'workflow status')

    const { getRun } = require('../services/workflows/workflow-engine.cjs')

    return getRun(assertNonEmptyString(payload.runId, 'run id', 80))
  })

  ipcMain.handle('workflow:runs', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const { listRuns } = require('../services/workflows/workflow-engine.cjs')

    return listRuns()
  })

  // Integrations (4A.4). Adapters behind one contract; writes stay
  // on their existing approved channels.
  ipcMain.handle('integration:list', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const { ensureBuiltins, listAdapters } = require('../services/integrations/registry.cjs')

    ensureBuiltins()

    return { integrations: listAdapters() }
  })

  ipcMain.handle('integration:status', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'integration status')

    const { ensureBuiltins, getAdapter } = require('../services/integrations/registry.cjs')

    ensureBuiltins()

    return getAdapter(assertNonEmptyString(payload.id, 'id', 60)).status({})
  })

  ipcMain.handle('integration:connect', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'integration connect')

    const { ensureBuiltins, getAdapter } = require('../services/integrations/registry.cjs')

    ensureBuiltins()

    const adapter = getAdapter(assertNonEmptyString(payload.id, 'id', 60))

    if (typeof adapter.connect !== 'function') {
      throw new Error(`Integration "${adapter.id}" has no connect flow.`)
    }

    const connected = await adapter.connect({})

    await audit('integration.connected', `integration:${adapter.id}`, connected.state || '', 'connected')

    return connected
  })

  ipcMain.handle('integration:disconnect', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'integration disconnect')

    const { ensureBuiltins, getAdapter } = require('../services/integrations/registry.cjs')

    ensureBuiltins()

    const adapter = getAdapter(assertNonEmptyString(payload.id, 'id', 60))
    const cleared = await adapter.disconnect({})

    await audit('integration.disconnected', `integration:${adapter.id}`, '', 'disconnected')

    return cleared
  })

  ipcMain.handle('integration:repositories', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'integration repositories')

    const { ensureBuiltins, getAdapter } = require('../services/integrations/registry.cjs')

    ensureBuiltins()

    const adapter = getAdapter(assertNonEmptyString(payload.id, 'id', 60))

    if (typeof adapter.repositories !== 'function') {
      throw new Error(`Integration "${adapter.id}" does not list repositories.`)
    }

    return adapter.repositories()
  })

  ipcMain.handle('integration:history', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'integration history')

    const { ensureBuiltins, getAdapter } = require('../services/integrations/registry.cjs')

    ensureBuiltins()

    const adapter = getAdapter(assertNonEmptyString(payload.id, 'id', 60))

    if (typeof adapter.history !== 'function') {
      throw new Error(`Integration "${adapter.id}" does not provide history.`)
    }

    const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit)
      ? Math.min(Math.max(1, Math.floor(payload.limit)), 50)
      : 20

    return adapter.history({ limit })
  })

  // Templates (4A.5). Preview-then-confirm generation; setup
  // commands return as instructions, never execute.
  ipcMain.handle('template:list', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const { listTemplates } = require('../services/templates/template-engine.cjs')

    return listTemplates({})
  })

  ipcMain.handle('template:get', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'template')

    const { getTemplate } = require('../services/templates/template-engine.cjs')
    const template = await getTemplate(assertNonEmptyString(payload.id, 'id', 80), {})

    const { dir, ...rest } = template

    return rest
  })

  ipcMain.handle('template:pick-destination', async (event) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Choose Project Location',
      properties: ['openDirectory', 'createDirectory'],
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    return { path: result.filePaths[0] }
  })

  ipcMain.handle('template:preview', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'template preview')

    const { previewGeneration } = require('../services/templates/template-engine.cjs')

    if (payload.variables !== undefined && payload.variables !== null && typeof payload.variables !== 'object') {
      throw new Error('Invalid variables: an object is required.')
    }

    return previewGeneration({
      templateId: assertNonEmptyString(payload.templateId, 'template id', 80),
      destination: assertNonEmptyString(payload.destination, 'destination', 2000),
      variables: payload.variables || {},
    })
  })

  ipcMain.handle('template:generate', async (event, payload) => {
    if (!isTrustedSender(event)) {
      unauthorized()
    }

    assertPlainObject(payload, 'template generate')

    const { generateTemplate } = require('../services/templates/template-engine.cjs')

    if (payload.variables !== undefined && payload.variables !== null && typeof payload.variables !== 'object') {
      throw new Error('Invalid variables: an object is required.')
    }

    return generateTemplate({
      templateId: assertNonEmptyString(payload.templateId, 'template id', 80),
      destination: assertNonEmptyString(payload.destination, 'destination', 2000),
      variables: payload.variables || {},
      confirmed: payload.confirmed === true,
    })
  })
}
