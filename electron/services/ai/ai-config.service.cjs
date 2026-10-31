// Validated AI configuration. Supported models are an explicit allowlist:
// neither environment values nor renderer input can select anything else.
// The allowlist derives from the registered Meta provider descriptor,
// the single source of truth for model ids — never a second copy.
const { getSecret } = require('../settings/secrets.service.cjs')
const { metaDescriptor } = require('./providers/meta-muse.provider.cjs')

const SUPPORTED_MODELS = metaDescriptor.models.map((model) => model.id)
const DEFAULT_MODEL = (
  metaDescriptor.models.find((model) => model.isDefault) ||
  metaDescriptor.models[0]
).id

const MISSING_KEY_MESSAGE =
  'Meta API key is not configured. Add your key in Settings → Providers, or set MODEL_API_KEY in the project-root .env file and restart KryomCode.'

function isSupportedModel(model) {
  return typeof model === 'string' && SUPPORTED_MODELS.includes(model)
}

function resolveModel(requested, fallback = DEFAULT_MODEL) {
  if (requested === undefined || requested === null) {
    return fallback
  }

  if (!isSupportedModel(requested)) {
    throw new Error(
      `Unsupported model "${String(requested).slice(0, 100)}". Supported models: ${SUPPORTED_MODELS.join(', ')}.`
    )
  }

  return requested
}

function getAIConfig() {
  const apiKey = getSecret('MODEL_API_KEY')

  if (!apiKey) {
    throw new Error(MISSING_KEY_MESSAGE)
  }

  const configured = process.env.META_MODEL?.trim() || ''

  if (configured && !isSupportedModel(configured)) {
    throw new Error(
      `Invalid META_MODEL "${configured.slice(0, 100)}". Supported models: ${SUPPORTED_MODELS.join(', ')}.`
    )
  }

  return {
    apiKey,
    model: configured || DEFAULT_MODEL,
  }
}

module.exports = {
  SUPPORTED_MODELS,
  DEFAULT_MODEL,
  isSupportedModel,
  resolveModel,
  getAIConfig,
}
