// Minimal main-process logger. Everything written here may end up in
// user-visible logs, so secrets are redacted and callers must never pass
// full prompts, file contents, or authorization headers.

const REDACTED = '[redacted]'

const SECRET_PATTERNS = [
  // Authorization: Bearer <token> / Bearer <token>
  /(Bearer\s+)[A-Za-z0-9\-._~+/=]+/gi,
  // MODEL_API_KEY=<value> / "MODEL_API_KEY": "<value>"
  /((?:MODEL_API_KEY|META_MODEL_API_KEY|API_KEY|SECRET|TOKEN)\s*["=:]\s*["']?)[^"'\s,}]+/gi,
]

function redactText(text) {
  let output = String(text)

  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    output = output.replace(pattern, `$1${REDACTED}`)
  }

  return output
}

function redact(value, seen = new Set()) {
  if (typeof value === 'string') {
    return redactText(value)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return REDACTED
  }

  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, seen))
  }

  const output = {}

  for (const [key, entry] of Object.entries(value)) {
    if (/API[_-]?KEY|SECRET|TOKEN|AUTHORIZATION/i.test(key)) {
      output[key] = REDACTED
    } else {
      output[key] = redact(entry, seen)
    }
  }

  return output
}

function format(scope, level, args) {
  const timestamp = new Date().toISOString()
  const message = args
    .map((entry) =>
      typeof entry === 'string' ? entry : JSON.stringify(redact(entry))
    )
    .join(' ')

  return `[${timestamp}] [${scope}] [${level}] ${redactText(message)}`
}

const LOG_LEVELS = ['error', 'warn', 'info']

function normalizeLevel(value) {
  const text = String(value || '').trim().toLowerCase()

  return LOG_LEVELS.includes(text) ? text : 'info'
}

// Reads KRYOM_LOG_LEVEL once per call so tests and late env changes
// behave deterministically; explicit setLogLevel wins when set.
let explicitLevel = null

function setLogLevel(level) {
  explicitLevel = normalizeLevel(level)

  return explicitLevel
}

function currentLevel() {
  if (explicitLevel) {
    return explicitLevel
  }

  return normalizeLevel(process.env.KRYOM_LOG_LEVEL || 'info')
}

function enabled(level) {
  return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(currentLevel())
}

function createLogger(scope) {
  return {
    info: (...args) => {
      if (enabled('info')) {
        console.log(format(scope, 'info', args))
      }
    },
    warn: (...args) => {
      if (enabled('warn')) {
        console.warn(format(scope, 'warn', args))
      }
    },
    error: (...args) => {
      // Errors always emit: suppressing them hides crashes.
      console.error(format(scope, 'error', args))
    },
  }
}

module.exports = {
  createLogger,
  redact,
  redactText,
  setLogLevel,
  currentLevel,
}
