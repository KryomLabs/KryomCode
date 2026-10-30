// Model catalog (Level 4A.1). Read-only discovery over registered
// providers: every model entry states its capabilities, and
// anything unknown is explicit (null/false), never invented.
// Capability validation fails closed.
const {
  ensureBuiltins,
  getProvider,
  listProviders,
} = require('./provider-registry.cjs')

const KNOWN_CAPABILITIES = ['text', 'streaming', 'vision', 'tools']

function listModels(providerId = null) {
  ensureBuiltins()

  const providers = providerId === null
    ? listProviders()
    : [getProvider(providerId)].map((descriptor) => ({
        id: descriptor.id,
        displayName: descriptor.displayName,
        models: descriptor.models,
      }))
  const models = []

  for (const provider of providers) {
    for (const model of provider.models) {
      models.push({
        providerId: provider.id,
        providerName: provider.displayName,
        modelId: model.id,
        displayName: model.displayName,
        capabilities: { ...model.capabilities },
        contextWindow: model.contextWindow,
        tokenUsage: model.tokenUsage,
        isDefault: model.isDefault,
      })
    }
  }

  return models
}

function getModel(providerId, modelId) {
  ensureBuiltins()

  const descriptor = getProvider(providerId)
  const model = descriptor.models.find((entry) => entry.id === modelId)

  if (!model) {
    throw new Error(`Unknown model "${String(modelId).slice(0, 100)}" for provider "${providerId}".`)
  }

  return {
    providerId: descriptor.id,
    providerName: descriptor.displayName,
    modelId: model.id,
    displayName: model.displayName,
    capabilities: { ...model.capabilities },
    contextWindow: model.contextWindow,
    tokenUsage: model.tokenUsage,
    isDefault: model.isDefault,
  }
}

function defaultModel(providerId) {
  ensureBuiltins()

  const descriptor = getProvider(providerId)
  const preferred = descriptor.models.find((model) => model.isDefault) || descriptor.models[0]

  return getModel(providerId, preferred.id)
}

// Validates that a model supports every required capability.
// Unknown capabilities reject; unsupported-but-known capabilities
// reject with the model named. Never guesses.
function validateModelCapabilities(providerId, modelId, requires = []) {
  if (!Array.isArray(requires)) {
    throw new Error('Invalid capability requirements: an array is required.')
  }

  for (const capability of requires) {
    if (!KNOWN_CAPABILITIES.includes(capability)) {
      throw new Error(`Unknown capability "${String(capability).slice(0, 60)}".`)
    }
  }

  const model = getModel(providerId, modelId)
  const missing = requires.filter((capability) => model.capabilities[capability] !== true)

  if (missing.length > 0) {
    throw new Error(
      `Model "${modelId}" (${providerId}) does not support: ${missing.join(', ')}.`
    )
  }

  return model
}

module.exports = {
  KNOWN_CAPABILITIES,
  listModels,
  getModel,
  defaultModel,
  validateModelCapabilities,
}
