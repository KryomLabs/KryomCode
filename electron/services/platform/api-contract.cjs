// Public extension API contract (Level 4A.6). The versioned,
// machine-readable surface extensions may rely on: membrane
// method specs with their permissions and caps, compatibility
// rules, and the error taxonomy. Anything not listed here is
// private implementation detail, even if reachable.
//
// Compatibility: manifest apiVersion must equal API_VERSION
// exactly (major-equals). New additive methods bump the minor
// surface without breaking v1 manifests; breaking changes ship a
// new major with the old one supported for one release.
const {
  PLATFORM_API_VERSION,
} = require('../extensions/manifest.cjs')

const API_VERSION = PLATFORM_API_VERSION

const SUPPORTED_API_VERSIONS = [1]
const DEPRECATED_APIS = []

// Every membrane path an extension may call: expected type,
// required permission (null = none), and size caps in bytes.
const MEMBRANE_SPEC = {
  version: { type: 'number', permission: null },
  extensionId: { type: 'string', permission: null },
  log: { type: 'function', permission: null, maxChars: 2000 },
  'commands.registerCommand': { type: 'function', permission: null, maxCommands: 50 },
  'workspace.getMetadata': { type: 'function', permission: 'workspace.metadata' },
  'workspace.listFiles': { type: 'function', permission: 'workspace.metadata', maxFiles: 200 },
  'workspace.readFile': { type: 'function', permission: 'workspace.read', maxBytes: 262144 },
  'storage.get': { type: 'function', permission: null, maxKey: 120 },
  'storage.set': { type: 'function', permission: null, maxKey: 120, maxBytes: 262144, quotaBytes: 1048576 },
  'ai.complete': { type: 'function', permission: 'ai.provider', maxPrompt: 8000, maxAnswer: 8000 },
}

const ERROR_CODES = [
  'PERMISSION_DENIED',
  'TIMEOUT',
  'INVALID_ARGS',
  'NOT_ACTIVE',
  'UNKNOWN_COMMAND',
  'QUOTA_EXCEEDED',
  'EXTENSION_FAULT',
]

// Classifies a membrane/runtime error message into the public
// taxonomy. Used by contract tests and SDK guidance.
function classifyMembraneError(message) {
  const text = String(message || '')

  if (/Permission denied/i.test(text)) {
    return 'PERMISSION_DENIED'
  }

  if (/timed out/i.test(text)) {
    return 'TIMEOUT'
  }

  if (/not active/i.test(text)) {
    return 'NOT_ACTIVE'
  }

  if (/Unknown command/i.test(text)) {
    return 'UNKNOWN_COMMAND'
  }

  if (/quota|exceeds.*cap|cap.*exceeded/i.test(text)) {
    return 'QUOTA_EXCEEDED'
  }

  if (/invalid|required|must be/i.test(text)) {
    return 'INVALID_ARGS'
  }

  return 'EXTENSION_FAULT'
}

function checkApiCompatibility(manifestApiVersion) {
  if (manifestApiVersion !== API_VERSION) {
    throw new Error(
      `Unsupported extension API version ${String(manifestApiVersion).slice(0, 20)}; ` +
        `supported: ${SUPPORTED_API_VERSIONS.join(', ')}.`
    )
  }

  return { apiVersion: API_VERSION, compatible: true }
}

function membranePaths() {
  return Object.keys(MEMBRANE_SPEC)
}

module.exports = {
  API_VERSION,
  SUPPORTED_API_VERSIONS,
  DEPRECATED_APIS,
  MEMBRANE_SPEC,
  ERROR_CODES,
  classifyMembraneError,
  checkApiCompatibility,
  membranePaths,
}
