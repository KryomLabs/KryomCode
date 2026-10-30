// Extension lifecycle (Level 4A.2). The controlled path through
// discover → validate → install → verify → register → enable →
// activate → deactivate → disable → uninstall. Every transition
// persists, records errors on the registry entry, and audits.
// Lifecycle failures are contained: a corrupt or crashing
// extension disables itself with a recorded reason and never
// takes down the core application.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  MANIFEST_FILE,
  validateManifest,
  compareVersions,
  checkHostCompatibility,
} = require('./manifest.cjs')
const {
  installExtension,
  removeExtension,
  getExtension,
  listExtensions,
  setExtensionEnabled,
  setExtensionError,
} = require('./registry.cjs')
const {
  activateExtension,
  deactivateExtension,
  executeCommand,
  isExtensionActive,
  listActiveCommands,
} = require('./runtime.cjs')
const {
  revokePermission,
  setTrustLevel,
} = require('../permissions/permission.service.cjs')
const {
  appendAudit,
} = require('../audit/audit.service.cjs')
const { createLogger } = require('../../utils/logger.cjs')
const { spawnHost } = require('./worker/extension-host.cjs')

const log = createLogger('extension-lifecycle')

// Isolated hosts by extension id. Activation runs extension code in
// a dedicated child process by default (Level 4B.4); the in-process
// vm path remains available via { isolated: false } for embedders
// and tests that cannot fork.
const hosts = new Map()

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('Extension lifecycle is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

function getHostVersion(explicit) {
  if (typeof explicit === 'string' && explicit) {
    return explicit
  }

  try {
    const electron = require('electron')

    if (electron && electron.app && typeof electron.app.getVersion === 'function') {
      return electron.app.getVersion()
    }
  } catch {
    // Fall through to package.json.
  }

  try {
     
    const pkg = require('../../../package.json')

    if (pkg && typeof pkg.version === 'string') {
      return pkg.version
    }
  } catch {
    // Unknown host below.
  }

  return '0.0.0'
}

// Minimal range support: exact versions and caret majors.
// Anything else fails closed with a clear message.
function satisfiesRange(version, range) {
  const trimmed = String(range).trim()

  if (/^\d+\.\d+\.\d+/.test(trimmed) && !trimmed.startsWith('^') && !trimmed.startsWith('~')) {
    return compareVersions(version, trimmed) === 0
  }

  if (trimmed.startsWith('^')) {
    const minimum = trimmed.slice(1)

    if (!/^\d+\.\d+\.\d+$/.test(minimum)) {
      throw new Error(`Unsupported version range "${trimmed.slice(0, 40)}".`)
    }

    const [wantMajor] = minimum.split('.').map(Number)
    const [haveMajor] = String(version).split('.').map(Number)

    return haveMajor === wantMajor && compareVersions(version, minimum) >= 0
  }

  throw new Error(`Unsupported version range "${trimmed.slice(0, 40)}".`)
}

async function audit(type, subject, detail, baseDir, outcome = null) {
  try {
    await appendAudit(type, { subject, detail, outcome }, baseDir)
  } catch {
    // Audit failure never fails the lifecycle transition.
  }
}

async function install(sourceDir, { dev = false, baseDir, trust = null } = {}) {
  const base = baseDir || defaultBaseDir()
  const entry = await installExtension(sourceDir, { dev, baseDir: base })

  await setTrustLevel(
    `extension:${entry.id}`,
    trust || (dev ? 'user' : 'third-party'),
    base
  ).catch(() => undefined)
  await audit('extension.installed', `extension:${entry.id}`, `${entry.version} (${entry.source})`, base, 'installed')

  log.info(`Extension ${entry.id} installed from ${dev ? 'dev link' : 'local package'}.`)

  return entry
}

async function verifyInstalled(id, { baseDir, hostVersion } = {}) {
  const base = baseDir || defaultBaseDir()
  const entry = await getExtension(id, { baseDir: base })

  let manifest = null

  try {
    const raw = await fs.readFile(path.join(entry.path, MANIFEST_FILE), 'utf8')

    manifest = validateManifest(JSON.parse(raw))
  } catch (error) {
    await setExtensionEnabled(id, false, { baseDir: base })
    await setExtensionError(id, `Corrupt installation: ${error.message}`, { baseDir: base })

    throw new Error(`Extension "${id}" is corrupt and was disabled: ${error.message}`)
  }

  if (manifest.id !== entry.id || manifest.version !== entry.version) {
    await setExtensionEnabled(id, false, { baseDir: base })
    await setExtensionError(id, 'Manifest no longer matches the installed record.', { baseDir: base })

    throw new Error(`Extension "${id}" changed on disk and was disabled. Reinstall it.`)
  }

  const compat = checkHostCompatibility(manifest, getHostVersion(hostVersion))

  if (!compat.compatible) {
    throw new Error(`Extension "${id}" is incompatible: ${compat.reason}`)
  }

  // Dependency check: every dependency must be installed, enabled,
  // and version-satisfied.
  const registry = await listExtensions({ baseDir: base })
  const byId = new Map(registry.extensions.map((item) => [item.id, item]))

  for (const [depId, range] of Object.entries(manifest.dependencies)) {
    const dep = byId.get(depId)

    if (!dep) {
      throw new Error(`Extension "${id}" is missing dependency "${depId}".`)
    }

    if (!dep.enabled) {
      throw new Error(`Extension "${id}" needs "${depId}", which is disabled.`)
    }

    if (!satisfiesRange(dep.version, range)) {
      throw new Error(`Extension "${id}" needs "${depId}" ${range}; ${dep.version} is installed.`)
    }
  }

  return { entry, manifest }
}

async function enable(id, { baseDir } = {}) {
  const base = baseDir || defaultBaseDir()

  await verifyInstalled(id, { baseDir: base })

  return setExtensionEnabled(id, true, { baseDir: base })
}

async function disable(id, { baseDir } = {}) {
  const base = baseDir || defaultBaseDir()

  await tearDown(id)
  await setExtensionError(id, null, { baseDir: base }).catch(() => undefined)

  return setExtensionEnabled(id, false, { baseDir: base })
}

function resolveWorkspaceRoot(explicit) {
  if (typeof explicit === 'string' && explicit) {
    return explicit
  }

  try {
    const { getWorkspaceRoot } = require('../workspace/workspace.service.cjs')

    return getWorkspaceRoot() || null
  } catch {
    return null
  }
}

async function activate(id, { baseDir, hostVersion, workspaceRoot, isolated = true, launcher } = {}) {
  const base = baseDir || defaultBaseDir()
  const { entry, manifest } = await verifyInstalled(id, { baseDir: base, hostVersion })

  if (!entry.enabled) {
    throw new Error(`Extension "${id}" is disabled. Enable it before activating.`)
  }

  if (hosts.has(id)) {
    throw new Error(`Extension "${id}" is already active.`)
  }

  if (isolated === false) {
    const outcome = await activateExtension(entry, manifest, {
      baseDir: base,
      workspaceRoot: resolveWorkspaceRoot(workspaceRoot),
    })

    if (!outcome.ok) {
      await setExtensionError(id, outcome.error, { baseDir: base })
      await audit('extension.activation-failed', `extension:${id}`, outcome.error, base, 'failed')

      throw new Error(`Extension "${id}" failed to activate: ${outcome.error}`)
    }

    await setExtensionError(id, null, { baseDir: base })
    await audit('extension.activated', `extension:${id}`, `${outcome.commands.length} command(s)`, base, 'activated')

    return { id, active: true, commands: outcome.commands, isolated: false }
  }

  const host = spawnHost(id, { launcher })
  const outcome = await host.activate({
    entryPath: path.join(entry.path, manifest.main),
    manifest,
    workspaceRoot: resolveWorkspaceRoot(workspaceRoot),
    baseDir: base,
  })

  if (!outcome || !outcome.ok) {
    const reason = (outcome && outcome.error) || 'isolated activation failed'

    await host.shutdown().catch(() => undefined)
    await setExtensionError(id, reason, { baseDir: base })
    await audit('extension.activation-failed', `extension:${id}`, reason, base, 'failed')

    throw new Error(`Extension "${id}" failed to activate: ${reason}`)
  }

  hosts.set(id, host)

  await setExtensionError(id, null, { baseDir: base })
  await audit('extension.activated', `extension:${id}`, `${outcome.commands.length} command(s)`, base, 'activated')

  return { id, active: true, commands: outcome.commands, isolated: true }
}

// Tears down every execution of an extension: the isolated host
// first (terminating its child process), then any in-process
// sandbox. Returns true when something was actually stopped.
async function tearDown(id) {
  let stopped = false
  const host = hosts.get(id)

  if (host) {
    hosts.delete(id)

    await host.shutdown().catch(() => undefined)
    stopped = true
  }

  const outcome = await deactivateExtension(id).catch(() => ({ deactivated: false }))

  if (outcome && outcome.deactivated) {
    stopped = true
  }

  return stopped
}

async function deactivate(id, { baseDir } = {}) {
  const base = baseDir || defaultBaseDir()
  const deactivated = await tearDown(id)

  if (deactivated) {
    await audit('extension.deactivated', `extension:${id}`, '', base, 'deactivated')
  }

  return { id, deactivated }
}

async function runCommand(id, commandId, args = {}) {
  const host = hosts.get(id)

  if (host) {
    return host.invoke(commandId, args)
  }

  return executeCommand(id, commandId, args)
}

// Best-effort teardown of every active extension, isolated or not.
// Called on application shutdown so no worker child can outlive the
// app (utility children normally die with the parent; forked ones in
// dev/test harnesses might not).
async function shutdownAll() {
  const ids = new Set(hosts.keys())

  try {
    for (const command of listActiveCommands()) {
      if (command && command.extensionId) {
        ids.add(command.extensionId)
      }
    }
  } catch {
    // Fall through with the host set.
  }

  const stopped = []

  for (const id of ids) {
    try {
      if (await tearDown(id)) {
        stopped.push(id)
      }
    } catch {
      // One stuck extension must not block shutdown of the rest.
    }
  }

  return { stopped }
}

async function uninstall(id, { baseDir } = {}) {
  const base = baseDir || defaultBaseDir()

  // Dependents block removal: uninstall them first.
  const registry = await listExtensions({ baseDir: base })

  for (const item of registry.extensions) {
    if (item.id !== id && item.manifest && item.manifest.dependencies && item.manifest.dependencies[id]) {
      throw new Error(`Cannot uninstall "${id}": extension "${item.id}" depends on it.`)
    }
  }

  await tearDown(id)

  const removed = await removeExtension(id, { baseDir: base })

  await revokePermission(`extension:${id}`, null, base).catch(() => undefined)
  await audit('extension.uninstalled', `extension:${id}`, '', base, 'uninstalled')

  return removed
}

function isActive(id) {
  return hosts.has(id) || isExtensionActive(id)
}

function activeCommands(id) {
  const host = hosts.get(id)
  const fromHost = host
    ? host.commands.map((command) => ({ extensionId: id, id: command.id, title: command.title }))
    : []

  return [
    ...fromHost,
    ...listActiveCommands().filter((command) => command.extensionId === id),
  ]
}

async function status(id, { baseDir } = {}) {
  const base = baseDir || defaultBaseDir()
  const entry = await getExtension(id, { baseDir: base })

  return {
    ...entry,
    active: isActive(id),
    commands: activeCommands(id),
  }
}

async function list({ baseDir } = {}) {
  const base = baseDir || defaultBaseDir()
  const registry = await listExtensions({ baseDir: base })

  return {
    extensions: registry.extensions.map((entry) => ({
      ...entry,
      active: isActive(entry.id),
    })),
  }
}

// Startup recovery: re-verify every enabled extension; corrupt or
// unreadable ones are disabled with a recorded reason. Never throws
// — the core must boot regardless of extension state.
async function recoverAtStartup({ baseDir, hostVersion } = {}) {
  const base = baseDir || defaultBaseDir()
  const recovered = []
  const disabled = []

  let registry = null

  try {
    registry = await listExtensions({ baseDir: base })
  } catch (error) {
    log.warn(`Extension recovery skipped: ${error.message}`)

    return { recovered, disabled, skipped: true }
  }

  for (const entry of registry.extensions) {
    if (!entry.enabled) {
      continue
    }

    try {
      await verifyInstalled(entry.id, { baseDir: base, hostVersion })
      recovered.push(entry.id)
    } catch (error) {
      disabled.push({ id: entry.id, reason: error.message })
      log.warn(`Extension ${entry.id} disabled at recovery: ${error.message}`)
    }
  }

  return { recovered, disabled, skipped: false }
}

module.exports = {
  satisfiesRange,
  install,
  verifyInstalled,
  enable,
  disable,
  activate,
  deactivate,
  uninstall,
  status,
  list,
  runCommand,
  shutdownAll,
  recoverAtStartup,
}
