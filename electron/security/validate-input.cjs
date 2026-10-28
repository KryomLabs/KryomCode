// Small runtime guards for IPC payloads and service arguments.
// Renderer input is untrusted: every handler validates before acting.

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${name}: an object is required.`)
  }

  return value
}

function assertNonEmptyString(value, name, maxLength = 2000) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maxLength
  ) {
    throw new Error(
      `Invalid ${name}: provide text up to ${maxLength} characters.`
    )
  }

  return value
}

function assertOptionalString(value, name, maxLength = 2000) {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(
      `Invalid ${name}: provide text up to ${maxLength} characters.`
    )
  }

  return value
}

function assertStringArray(value, name, { maxItems = 100, maxLength = 2000 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(
      `Invalid ${name}: provide up to ${maxItems} entries.`
    )
  }

  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > maxLength) {
      throw new Error(
        `Invalid ${name}: every entry must be text up to ${maxLength} characters.`
      )
    }
  }

  return value
}

function assertEnum(value, name, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(
      `Invalid ${name}: expected one of ${allowed.join(', ')}.`
    )
  }

  return value
}

function assertBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${name}: expected true or false.`)
  }

  return value
}

// Single choke point for URLs the app may open in an external
// browser. Only http(s) with a real host pass; javascript:, file:,
// custom protocols, malformed input, and credential-carrying URLs
// are rejected. Plain http is allowed deliberately: some cited
// research venues still serve http, and the browser itself warns
// about insecure pages. Returns the canonical URL string.
function assertExternalUrl(value, name) {
  assertNonEmptyString(value, name, 2000)

  const raw = value.trim()
  let parsed = null

  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid ${name}: malformed URL rejected.`)
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Invalid ${name}: only http(s) URLs may be opened.`)
  }

  if (!parsed.hostname) {
    throw new Error(`Invalid ${name}: URL host is missing.`)
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      `Invalid ${name}: URLs carrying credentials are rejected.`
    )
  }

  return parsed.toString()
}

module.exports = {
  assertPlainObject,
  assertNonEmptyString,
  assertOptionalString,
  assertStringArray,
  assertEnum,
  assertBoolean,
  assertExternalUrl,
}
