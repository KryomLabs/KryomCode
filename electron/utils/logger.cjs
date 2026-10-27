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

function createLogger(scope) {
  return {
    info: (...args) => console.log(format(scope, 'info', args)),
    warn: (...args) => console.warn(format(scope, 'warn', args)),
    error: (...args) => console.error(format(scope, 'error', args)),
  }
}

module.exports = {
  createLogger,
  redact,
  redactText,
}
