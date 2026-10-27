// Validated AI configuration. Supported models are an explicit allowlist:
// neither environment values nor renderer input can select anything else.
const { getSecret } = require('../settings/secrets.service.cjs')

const SUPPORTED_MODELS = ['muse-spark-1.3', 'muse-wonder-1.0']
const DEFAULT_MODEL = 'muse-spark-1.3'

const MISSING_KEY_MESSAGE =
  'Meta API key is not configured. Add MODEL_API_KEY to the project-root .env file, then restart KryomCode.'

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
