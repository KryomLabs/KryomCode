// User-controlled diagnostics bundle (Level 4B.11). Collects ONLY
// non-secret support facts: versions, platform, feature status
// (booleans/counts), and redacted error one-liners. Never collects
// source code, file contents, environment variables, keys, tokens,
// or raw paths (the home directory is replaced with ~).
//
// Collection is explicit (IPC preview/export channels), export
// writes a local file chosen by the user, and nothing uploads.
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { redactText } = require('../../utils/logger.cjs')

const MAX_ERRORS = 20
const MAX_SUMMARY_CHARS = 500

const recentErrors = []

function boundText(value, max = MAX_SUMMARY_CHARS) {
  return String(value || '').slice(0, max)
}

// In-memory ring of redacted error one-liners fed by the main
// process crash handlers. Never persisted automatically; it only
// leaves the machine inside an explicit user export.
function recordSupportError(summary) {
  recentErrors.push({
    at: new Date().toISOString(),
    summary: redactText(boundText(summary)),
  })

  while (recentErrors.length > MAX_ERRORS) {
    recentErrors.shift()
  }

  return recentErrors.length
}

function readRecentErrors() {
  return recentErrors.map((entry) => ({ ...entry }))
}

function redactHome(value, home = os.homedir()) {
  const text = String(value || '')

  if (!home || !text) {
    return text
  }

  return text.split(home).join('~')
}

function safeBoolean(value) {
  return value === true
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function collectSupportBundle({
  getVersion = () => '0.0.0-unknown',
  versions = process.versions || {},
  platform = process.platform,
  arch = process.arch,
  environment = null,
  providerStatus = null,
  featureStatus = null,
  includeErrors = true,
} = {}) {
  let version = '0.0.0-unknown'

  try {
    version = String(getVersion() || version)
  } catch {
    // Keep the fallback.
  }

  const bundle = {
    kind: 'kryom-support-bundle',
    bundleVersion: 1,
    collectedAt: new Date().toISOString(),
    app: {
      version,
      channel: environment && environment.channel === 'preview' ? 'preview' : 'stable',
      environment: environment ? String(environment.environment || 'unknown') : 'unknown',
      packaged: environment ? environment.packaged === true : false,
    },
    runtime: {
      electron: boundText(versions.electron, 40),
      chrome: boundText(versions.chrome, 40),
      node: boundText(versions.node, 40),
      platform: boundText(platform, 20),
      arch: boundText(arch, 20),
    },
    providers: {
      selectedProvider: providerStatus ? boundText(providerStatus.selectedProvider, 60) : 'unknown',
      selectedModel: providerStatus ? boundText(providerStatus.selectedModel, 100) : 'unknown',
      // Booleans only: configured/available, never key material.
      metaConfigured: providerStatus ? safeBoolean(providerStatus.metaConfigured) : false,
      metaAvailable: providerStatus ? safeBoolean(providerStatus.metaAvailable) : false,
    },
    features: {
      workspaceOpen: featureStatus ? safeBoolean(featureStatus.workspaceOpen) : false,
      workspaceRoot: featureStatus && featureStatus.workspaceRoot
        ? redactHome(boundText(featureStatus.workspaceRoot))
        : null,
      indexIndexed: featureStatus ? safeBoolean(featureStatus.indexIndexed) : false,
      filesIndexed: featureStatus ? safeCount(featureStatus.filesIndexed) : 0,
      extensionsInstalled: featureStatus ? safeCount(featureStatus.extensionsInstalled) : 0,
      extensionsActive: featureStatus ? safeCount(featureStatus.extensionsActive) : 0,
      skillsTotal: featureStatus ? safeCount(featureStatus.skillsTotal) : 0,
      workflowsTotal: featureStatus ? safeCount(featureStatus.workflowsTotal) : 0,
    },
    recentErrors: includeErrors ? readRecentErrors() : [],
  }

  // Defense in depth: the whole serialized bundle must survive the
  // redactor unchanged in shape (no secret patterns present).
  return JSON.parse(redactText(JSON.stringify(bundle)))
}

async function writeSupportBundle(filePath, bundle) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('A destination file path is required.')
  }

  if (!bundle || bundle.kind !== 'kryom-support-bundle') {
    throw new Error('Only support bundles can be written by this writer.')
  }

  const payload = `${JSON.stringify(bundle, null, 2)}\n`
  const staging = `${filePath}.staging-${Date.now().toString(36)}`

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(staging, payload, 'utf8')
  await fs.rename(staging, filePath)

  return { path: filePath, bytes: Buffer.byteLength(payload, 'utf8') }
}

module.exports = {
  recordSupportError,
  readRecentErrors,
  collectSupportBundle,
  writeSupportBundle,
  redactHome,
}
