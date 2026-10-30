// Central AI provider registry (Level 4A.1). All model providers —
// Meta first-class, plus future providers and test doubles —
// register here behind one descriptor contract. Features resolve
// providers through this registry plus the router; nothing outside
// this directory may hardcode provider-specific behavior.
//
// The registry is deterministic and testable: pure in-memory state,
// strict descriptor validation, duplicate rejection, and explicit
// lifecycle (register/unregister). Enablement and selection live in
// provider-config.cjs; availability here means registered with
// satisfied authentication.
const {
  assertImplementsProvider,
} = require('./provider.interface.cjs')
const {
  isSecretKey,
  getSecret,
} = require('../../settings/secrets.service.cjs')

const PROVIDER_ID_PATTERN = /^[a-z0-9-]{2,40}$/
const MAX_DISPLAY_CHARS = 100
const MAX_MODELS = 50

const providers = new Map()
let builtinsRegistered = false

function assertModelCapability(value, name, modelId) {
  if (typeof value !== 'boolean') {
    throw new Error(
      `Invalid provider descriptor: model "${modelId}" capability "${name}" must be a boolean.`
    )
  }

  return value
}

function normalizeModel(raw, providerId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid provider descriptor for "${providerId}": each model must be an object.`)
  }

  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > MAX_DISPLAY_CHARS) {
    throw new Error(`Invalid provider descriptor for "${providerId}": model id is invalid.`)
  }

  const capabilities = raw.capabilities && typeof raw.capabilities === 'object'
    ? raw.capabilities
    : {}

  // Unknown means unsupported: capability validation fails closed,
  // so a missing flag can never route a vision/tools request to a
  // model that never claimed it.
  const normalized = {
    id: raw.id.trim(),
    displayName:
      typeof raw.displayName === 'string' && raw.displayName.trim()
        ? raw.displayName.trim().slice(0, MAX_DISPLAY_CHARS)
        : raw.id.trim(),
    capabilities: {
      text: capabilities.text === true,
      streaming: capabilities.streaming === true,
      vision: capabilities.vision === true,
      tools: capabilities.tools === true,
    },
    contextWindow:
      typeof raw.contextWindow === 'number' &&
      Number.isInteger(raw.contextWindow) &&
      raw.contextWindow > 0
        ? raw.contextWindow
        : null,
    tokenUsage: raw.tokenUsage === true,
    isDefault: raw.isDefault === true,
  }

  assertModelCapability(normalized.capabilities.text, 'text', normalized.id)

  return normalized
}

function normalizeDescriptor(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid provider descriptor: an object is required.')
  }

  if (typeof raw.id !== 'string' || !PROVIDER_ID_PATTERN.test(raw.id)) {
    throw new Error(
      'Invalid provider descriptor: id must be 2-40 lowercase letters, digits, or dashes.'
    )
  }

  if (
    typeof raw.displayName !== 'string' ||
    !raw.displayName.trim() ||
    raw.displayName.length > MAX_DISPLAY_CHARS
  ) {
    throw new Error(`Invalid provider descriptor for "${raw.id}": displayName is invalid.`)
  }

  if (!Array.isArray(raw.models) || raw.models.length === 0 || raw.models.length > MAX_MODELS) {
    throw new Error(`Invalid provider descriptor for "${raw.id}": provide 1 to ${MAX_MODELS} models.`)
  }

  const models = raw.models.map((entry) => normalizeModel(entry, raw.id))
  const ids = new Set(models.map((entry) => entry.id))

  if (ids.size !== models.length) {
    throw new Error(`Invalid provider descriptor for "${raw.id}": duplicate model ids.`)
  }

  const auth = raw.auth && typeof raw.auth === 'object' ? raw.auth : { kind: 'none' }

  if (auth.kind !== 'none' && auth.kind !== 'api-key') {
    throw new Error(`Invalid provider descriptor for "${raw.id}": auth.kind must be none or api-key.`)
  }

  if (auth.kind === 'api-key') {
    if (typeof auth.secretEnv !== 'string' || !isSecretKey(auth.secretEnv)) {
      throw new Error(
        `Invalid provider descriptor for "${raw.id}": api-key auth needs an allowlisted secret name.`
      )
    }
  }

  if (typeof raw.createInstance !== 'function') {
    throw new Error(`Invalid provider descriptor for "${raw.id}": createInstance must be a function.`)
  }

  return {
    id: raw.id,
    displayName: raw.displayName.trim().slice(0, MAX_DISPLAY_CHARS),
    description:
      typeof raw.description === 'string' ? raw.description.slice(0, 500) : '',
    version:
      typeof raw.version === 'string' ? raw.version.slice(0, 40) : '1.0.0',
    models,
    auth: auth.kind === 'api-key'
      ? { kind: 'api-key', secretEnv: auth.secretEnv }
      : { kind: 'none' },
    createInstance: raw.createInstance,
  }
}

function registerProvider(descriptor) {
  const normalized = normalizeDescriptor(descriptor)

  if (providers.has(normalized.id)) {
    throw new Error(`Provider "${normalized.id}" is already registered.`)
  }

  providers.set(normalized.id, normalized)

  return describeProvider(normalized.id)
}

function unregisterProvider(providerId) {
  return providers.delete(providerId)
}

function getProvider(providerId) {
  const descriptor = providers.get(providerId)

  if (!descriptor) {
    throw new Error(`Unknown provider "${String(providerId).slice(0, 60)}".`)
  }

  return descriptor
}

// Public metadata only: instances and secrets never leak through
// the registry surface.
function describeProvider(providerId) {
  const descriptor = getProvider(providerId)

  return {
    id: descriptor.id,
    displayName: descriptor.displayName,
    description: descriptor.description,
    version: descriptor.version,
    models: descriptor.models.map((model) => ({ ...model, capabilities: { ...model.capabilities } })),
    auth:
      descriptor.auth.kind === 'api-key'
        ? { kind: 'api-key', configured: getSecret(descriptor.auth.secretEnv).length > 0 }
        : { kind: 'none', configured: true },
    available: isProviderAvailable(providerId),
  }
}

function listProviders() {
  return [...providers.keys()].sort().map((id) => describeProvider(id))
}

function isProviderAvailable(providerId) {
  const descriptor = getProvider(providerId)

  if (descriptor.auth.kind === 'none') {
    return true
  }

  return getSecret(descriptor.auth.secretEnv).length > 0
}

function createInstance(providerId, options = {}) {
  const descriptor = getProvider(providerId)
  const instance = descriptor.createInstance(options)

  assertImplementsProvider(instance, `provider "${providerId}" instance`)

  return instance
}

function registerBuiltins() {
  if (builtinsRegistered) {
    return listProviders()
  }

  const { metaDescriptor } = require('./meta-muse.provider.cjs')

  registerProvider(metaDescriptor)
  builtinsRegistered = true

  return listProviders()
}

function ensureBuiltins() {
  if (!builtinsRegistered) {
    registerBuiltins()
  }
}

module.exports = {
  PROVIDER_ID_PATTERN,
  registerProvider,
  unregisterProvider,
  getProvider,
  describeProvider,
  listProviders,
  isProviderAvailable,
  createInstance,
  registerBuiltins,
  ensureBuiltins,
}
