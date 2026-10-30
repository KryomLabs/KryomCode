// Centralized model routing (Level 4A.1). Resolves the provider
// and model for a request from explicit user selection, feature
// overrides, and capability requirements — never by silently
// switching providers. Fallback applies only when explicitly
// configured, and every resolution reports whether fallback was
// used so the UI can show it.
const {
  ensureBuiltins,
  getProvider,
  isProviderAvailable,
  createInstance,
} = require('./providers/provider-registry.cjs')
const {
  getModel,
  defaultModel,
  validateModelCapabilities,
} = require('./providers/model-catalog.cjs')
const {
  readProviderConfig,
} = require('./provider-config.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('router')

function normalizeProviderError(error, providerId) {
  const message = error instanceof Error ? error.message : 'Provider request failed.'

  // Retryable only for transport-level failures. Auth, validation,
  // and model errors must never retry — they would fail identically.
  const retryable = error instanceof TypeError || /network|ECONN|ETIMEDOUT|socket/i.test(message)
  const cancelled = /cancelled/i.test(message)

  return {
    providerId,
    message,
    code: cancelled ? 'cancelled' : retryable ? 'transport' : 'provider',
    retryable: retryable && !cancelled,
  }
}

function pickModel(descriptor, requestedModel) {
  if (requestedModel) {
    const found = descriptor.models.find((model) => model.id === requestedModel)

    if (!found) {
      throw new Error(
        `Unknown model "${String(requestedModel).slice(0, 100)}" for provider "${descriptor.id}".`
      )
    }

    return found
  }

  return descriptor.models.find((model) => model.isDefault) || descriptor.models[0]
}

// Resolves {providerId, modelId, instance} for a request. Precedence:
// explicit arguments > feature override > user selection > provider
// default. Throws on invalid combinations, disabled providers, and
// unmet capabilities; falls back only to an explicitly configured
// fallback, and reports it.
async function resolveRoute({ provider, model, requires = [], feature = null, baseDir } = {}) {
  ensureBuiltins()

  const config = await readProviderConfig(baseDir)
  const override = feature && config.features[feature] ? config.features[feature] : null

  const wantedProvider = provider ?? override?.provider ?? config.selectedProvider
  const wantedModel = model ?? override?.model ?? config.selectedModel

  const attempt = (providerId, modelId) => {
    const descriptor = getProvider(providerId)

    if (config.enabled[providerId] === false) {
      throw new Error(`Provider "${providerId}" is disabled.`)
    }

    if (!isProviderAvailable(providerId)) {
      throw new Error(`Provider "${providerId}" is not configured (missing credentials).`)
    }

    const resolved = pickModel(descriptor, modelId)
    const validated = validateModelCapabilities(providerId, resolved.id, requires)

    return {
      providerId: descriptor.id,
      providerName: descriptor.displayName,
      modelId: validated.modelId,
      model: validated,
      instance: createInstance(providerId),
    }
  }

  try {
    return { ...attempt(wantedProvider, wantedModel), usedFallback: null }
  } catch (primaryError) {
    if (!config.fallback) {
      throw primaryError
    }

    // Explicit fallback only: a configured standby for an unusable
    // primary. Capability requirements still apply, and the switch
    // is reported — never silent.
    try {
      const routed = attempt(config.fallback.provider, config.fallback.model)

      log.warn(
        `Route fell back from ${wantedProvider}/${wantedModel} to ` +
          `${routed.providerId}/${routed.modelId}: ${primaryError.message}`
      )

      return {
        ...routed,
        usedFallback: {
          from: { provider: wantedProvider, model: wantedModel },
          reason: primaryError.message,
        },
      }
    } catch {
      throw primaryError
    }
  }
}

// Executes one chat call through the router with safe retry: at most
// one retry, same provider/model, transport failures only.
// Cancellation propagates; nothing is retried after an abort.
async function routeChat({ provider, model, messages, requires, feature, signal, baseDir }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Route chat is missing messages.')
  }

  const routed = await resolveRoute({ provider, model, requires, feature, baseDir })

  const runOnce = () => routed.instance.chat({ model: routed.modelId, messages, signal })

  try {
    const result = await runOnce()

    if (!result || typeof result.answer !== 'string' || !result.answer.trim()) {
      throw new Error('The provider returned an empty response.')
    }

    return { ...result, route: { ...routed, instance: undefined }, usedFallback: routed.usedFallback }
  } catch (error) {
    const normalized = normalizeProviderError(error, routed.providerId)

    if (!normalized.retryable || (signal && signal.aborted)) {
      throw error instanceof Error ? error : new Error(normalized.message)
    }

    log.warn(`Retrying ${routed.providerId} once after a transport failure.`)

    const result = await runOnce()

    if (!result || typeof result.answer !== 'string' || !result.answer.trim()) {
      throw new Error('The provider returned an empty response.')
    }

    return { ...result, route: { ...routed, instance: undefined }, usedFallback: routed.usedFallback }
  }
}

async function defaultRoute({ baseDir } = {}) {
  ensureBuiltins()

  const config = await readProviderConfig(baseDir)

  try {
    const descriptor = getProvider(config.selectedProvider)
    const model = pickModel(descriptor, config.selectedModel)

    return {
      providerId: descriptor.id,
      providerName: descriptor.displayName,
      modelId: model.id,
      displayName: model.displayName,
    }
  } catch {
    const fallback = defaultModel('meta')

    return {
      providerId: fallback.providerId,
      providerName: fallback.providerName,
      modelId: fallback.modelId,
      displayName: fallback.displayName,
    }
  }
}

module.exports = {
  normalizeProviderError,
  resolveRoute,
  routeChat,
  defaultRoute,
}
