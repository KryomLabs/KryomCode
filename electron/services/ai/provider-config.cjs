// Provider configuration store (Level 4A.1). Versioned user-data
// JSON holding selection state only: selected provider/model,
// per-provider enablement, feature overrides, and an explicit
// fallback. Secrets are NEVER stored here — authentication resolves
// through the secret allowlist (environment first, then the
// OS-encrypted credential vault from Settings → Providers).
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  assertPlainObject,
} = require('../../security/validate-input.cjs')
const {
  ensureBuiltins,
  getProvider,
  isProviderAvailable,
  createInstance,
} = require('./providers/provider-registry.cjs')
const { boundDetail } = require('../../utils/errors.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('provider-config')

const CONFIG_FILE = 'kryomcode-providers.json'
const CONFIG_VERSION = 1
const LIVE_TEST_TIMEOUT_MS = 15000

const DEFAULTS = {
  version: CONFIG_VERSION,
  selectedProvider: 'meta',
  selectedModel: 'muse-spark-1.3',
  enabled: { meta: true },
  fallback: null,
  features: {},
}

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('Provider configuration is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

function configPath(baseDir) {
  return path.join(baseDir || defaultBaseDir(), CONFIG_FILE)
}

function sanitizeSelection(value, field, fallback) {
  return typeof value === 'string' && value.trim() && value.length <= 100
    ? value.trim()
    : fallback
}

function sanitizeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return structuredClone(DEFAULTS)
  }

  const enabled = {}

  if (value.enabled && typeof value.enabled === 'object' && !Array.isArray(value.enabled)) {
    for (const [key, entry] of Object.entries(value.enabled)) {
      if (/^[a-z0-9-]{2,40}$/.test(key) && typeof entry === 'boolean') {
        enabled[key] = entry
      }
    }
  }

  if (enabled.meta === undefined) {
    enabled.meta = true
  }

  let fallback = null

  if (value.fallback && typeof value.fallback === 'object' && !Array.isArray(value.fallback)) {
    const provider = sanitizeSelection(value.fallback.provider, 'fallback.provider', '')
    const model = sanitizeSelection(value.fallback.model, 'fallback.model', '')

    if (provider && model) {
      fallback = { provider, model }
    }
  }

  const features = {}

  if (value.features && typeof value.features === 'object' && !Array.isArray(value.features)) {
    for (const [feature, entry] of Object.entries(value.features).slice(0, 20)) {
      if (!/^[a-z0-9-]{2,40}$/.test(feature) || !entry || typeof entry !== 'object') {
        continue
      }

      const provider = sanitizeSelection(entry.provider, 'feature.provider', '')
      const model = sanitizeSelection(entry.model, 'feature.model', '')

      if (provider && model) {
        features[feature] = { provider, model }
      }
    }
  }

  return {
    version: CONFIG_VERSION,
    selectedProvider: sanitizeSelection(value.selectedProvider, 'selectedProvider', DEFAULTS.selectedProvider),
    selectedModel: sanitizeSelection(value.selectedModel, 'selectedModel', DEFAULTS.selectedModel),
    enabled,
    fallback,
    features,
  }
}

async function readProviderConfig(baseDir) {
  try {
    const raw = await fs.readFile(configPath(baseDir), 'utf8')

    return sanitizeConfig(JSON.parse(raw))
  } catch {
    return structuredClone(DEFAULTS)
  }
}

async function writeProviderConfig(config, baseDir) {
  const sanitized = sanitizeConfig(config)
  const filePath = configPath(baseDir)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(sanitized, null, 2), 'utf8')

  return sanitized
}

function validatePatch(patch) {
  assertPlainObject(patch, 'provider patch')

  const validated = {}

  if (patch.selectedProvider !== undefined) {
    validated.selectedProvider = sanitizeSelection(patch.selectedProvider, 'selectedProvider', '')

    if (!validated.selectedProvider) {
      throw new Error('Invalid selectedProvider.')
    }
  }

  if (patch.selectedModel !== undefined) {
    validated.selectedModel = sanitizeSelection(patch.selectedModel, 'selectedModel', '')

    if (!validated.selectedModel) {
      throw new Error('Invalid selectedModel.')
    }
  }

  if (patch.enabled !== undefined) {
    if (!patch.enabled || typeof patch.enabled !== 'object' || Array.isArray(patch.enabled)) {
      throw new Error('Invalid enabled map.')
    }

    validated.enabled = {}

    for (const [key, entry] of Object.entries(patch.enabled)) {
      if (!/^[a-z0-9-]{2,40}$/.test(key) || typeof entry !== 'boolean') {
        throw new Error(`Invalid enabled entry for "${key.slice(0, 40)}".`)
      }

      validated.enabled[key] = entry
    }
  }

  if (patch.fallback !== undefined) {
    if (patch.fallback !== null) {
      assertPlainObject(patch.fallback, 'fallback')

      const provider = sanitizeSelection(patch.fallback.provider, 'fallback.provider', '')
      const model = sanitizeSelection(patch.fallback.model, 'fallback.model', '')

      if (!provider || !model) {
        throw new Error('Invalid fallback: provider and model are required.')
      }

      validated.fallback = { provider, model }
    } else {
      validated.fallback = null
    }
  }

  if (patch.features !== undefined) {
    if (!patch.features || typeof patch.features !== 'object' || Array.isArray(patch.features)) {
      throw new Error('Invalid features map.')
    }

    validated.features = {}

    for (const [feature, entry] of Object.entries(patch.features).slice(0, 20)) {
      if (!/^[a-z0-9-]{2,40}$/.test(feature)) {
        throw new Error(`Invalid feature name "${feature.slice(0, 40)}".`)
      }

      assertPlainObject(entry, `features.${feature}`)

      const provider = sanitizeSelection(entry.provider, 'feature.provider', '')
      const model = sanitizeSelection(entry.model, 'feature.model', '')

      if (!provider || !model) {
        throw new Error(`Invalid features.${feature}: provider and model are required.`)
      }

      validated.features[feature] = { provider, model }
    }
  }

  return validated
}

async function updateProviderConfig(patch, baseDir) {
  const validated = validatePatch(patch)
  const current = await readProviderConfig(baseDir)
  const next = {
    ...current,
    ...validated,
    enabled: { ...current.enabled, ...(validated.enabled || {}) },
    features: validated.features !== undefined
      ? { ...current.features, ...validated.features }
      : current.features,
  }

  // A fallback that names an unregistered provider is a configuration
  // error now, not a surprise at request time.
  if (next.fallback) {
    ensureBuiltins()

    try {
      getProvider(next.fallback.provider)
    } catch {
      throw new Error(`Invalid fallback: unknown provider "${next.fallback.provider}".`)
    }
  }

  return writeProviderConfig(next, baseDir)
}

// Connection testing: local checks always run (registration,
// enablement, key presence, known models). A live ping runs only
// when asked, with a short timeout and fully redacted errors —
// key material never appears in results.
async function testConnection(providerId, { live = false, baseDir, provider } = {}) {
  ensureBuiltins()

  const checks = []
  const config = await readProviderConfig(baseDir)

  let descriptor = null

  try {
    descriptor = getProvider(providerId)
    checks.push({ name: 'registered', ok: true, detail: descriptor.displayName })
  } catch {
    return { ok: false, checks: [{ name: 'registered', ok: false, detail: 'Unknown provider.' }] }
  }

  const enabled = config.enabled[providerId] !== false

  checks.push({
    name: 'enabled',
    ok: enabled,
    detail: enabled ? 'Provider is enabled.' : 'Provider is disabled in configuration.',
  })

  const available = isProviderAvailable(providerId)

  checks.push({
    name: 'authentication',
    ok: descriptor.auth.kind === 'none' ? true : available,
    detail: descriptor.auth.kind === 'none'
      ? 'No authentication required.'
      : available
        ? 'API key is configured (presence only; the value is never read here).'
        : 'API key is not configured.',
  })

  checks.push({
    name: 'models',
    ok: descriptor.models.length > 0,
    detail: `${descriptor.models.length} known model(s).`,
  })

  if (!live) {
    return { ok: checks.every((entry) => entry.ok), checks, live: false }
  }

  if (!checks.every((entry) => entry.ok)) {
    return { ok: false, checks, live: false, error: 'Local checks failed; live test skipped.' }
  }

  const instance = provider || createInstance(providerId, { timeoutMs: LIVE_TEST_TIMEOUT_MS })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LIVE_TEST_TIMEOUT_MS)

  if (timer.unref) {
    timer.unref()
  }

  try {
    const result = await instance.chat({
      model: descriptor.models.find((model) => model.isDefault)?.id || descriptor.models[0].id,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      signal: controller.signal,
    })

    clearTimeout(timer)

    const ok = Boolean(result && typeof result.answer === 'string' && result.answer.trim())

    checks.push({
      name: 'live',
      ok,
      detail: ok ? 'Provider answered a minimal request.' : 'Provider returned an empty response.',
    })

    return { ok: checks.every((entry) => entry.ok), checks, live: true }
  } catch (error) {
    clearTimeout(timer)

    const message = error instanceof Error ? error.message : 'Connection test failed.'

    log.warn(`Connection test for ${providerId} failed.`)

    checks.push({ name: 'live', ok: false, detail: boundDetail(message, 300) })

    return { ok: false, checks, live: true, error: boundDetail(message, 300) }
  }
}

module.exports = {
  DEFAULTS,
  LIVE_TEST_TIMEOUT_MS,
  readProviderConfig,
  writeProviderConfig,
  updateProviderConfig,
  testConnection,
}
