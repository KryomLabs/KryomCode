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

module.exports = {
  assertPlainObject,
  assertNonEmptyString,
  assertOptionalString,
  assertStringArray,
  assertEnum,
  assertBoolean,
}
