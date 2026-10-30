// Extension manifest schema (Level 4A.2). Strict validation for
// `kryom-extension.json`: identity, versioning, API compatibility,
// permissions, contributions, and dependencies. Anything malformed,
// incompatible, or over-privileged is rejected with a precise
// reason — never installed partially.
const {
  PERMISSIONS,
} = require('../permissions/permission.service.cjs')

// Public extension API version. Bumped only with breaking membrane
// changes; manifests pin the version they were built against.
const PLATFORM_API_VERSION = 1
const MANIFEST_FILE = 'kryom-extension.json'

const EXTENSION_ID_PATTERN = /^[a-z0-9-]{2,40}\.[a-z0-9-]{2,40}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]{1,40})?$/
const COMMAND_ID_PATTERN = /^[a-z0-9-]{2,40}\.[a-z0-9-.]{1,80}$/
const MAX_TEXT = 500
const MAX_COMMANDS = 50
const MAX_DEPENDENCIES = 20

function assertNonEmpty(value, name, max = MAX_TEXT) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`Invalid extension manifest: "${name}" must be 1-${max} characters.`)
  }

  return value.trim()
}

function validatePermissionList(value, name) {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid extension manifest: "${name}" must be an array.`)
  }

  const seen = new Set()

  for (const entry of value) {
    if (typeof entry !== 'string' || !PERMISSIONS[entry]) {
      throw new Error(`Invalid extension manifest: unknown permission "${String(entry).slice(0, 80)}".`)
    }

    if (seen.has(entry)) {
      throw new Error(`Invalid extension manifest: duplicate permission "${entry}".`)
    }

    seen.add(entry)
  }

  return [...seen]
}

function validateCommands(value) {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value) || value.length > MAX_COMMANDS) {
    throw new Error(`Invalid extension manifest: at most ${MAX_COMMANDS} commands are allowed.`)
  }

  const seen = new Set()

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid extension manifest: command ${index} must be an object.`)
    }

    if (typeof entry.id !== 'string' || !COMMAND_ID_PATTERN.test(entry.id)) {
      throw new Error(`Invalid extension manifest: command ${index} has a bad id (use "publisher.name").`)
    }

    if (seen.has(entry.id)) {
      throw new Error(`Invalid extension manifest: duplicate command "${entry.id}".`)
    }

    seen.add(entry.id)

    return {
      id: entry.id,
      title: assertNonEmpty(entry.title, `commands[${index}].title`, 200),
      description: typeof entry.description === 'string' ? entry.description.slice(0, MAX_TEXT) : '',
    }
  })
}

function validateDependencies(value) {
  if (value === undefined || value === null) {
    return {}
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid extension manifest: "dependencies" must be an object.')
  }

  const entries = Object.entries(value)

  if (entries.length > MAX_DEPENDENCIES) {
    throw new Error(`Invalid extension manifest: at most ${MAX_DEPENDENCIES} dependencies.`)
  }

  const normalized = {}

  for (const [id, range] of entries) {
    if (!EXTENSION_ID_PATTERN.test(id)) {
      throw new Error(`Invalid extension manifest: bad dependency id "${id.slice(0, 80)}".`)
    }

    if (typeof range !== 'string' || !range.trim() || range.length > 40) {
      throw new Error(`Invalid extension manifest: bad version range for "${id}".`)
    }

    normalized[id] = range.trim()
  }

  return normalized
}

function validateMain(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) {
    throw new Error('Invalid extension manifest: "main" must name the entry file.')
  }

  const trimmed = value.trim().replace(/\\/g, '/')

  if (
    trimmed.startsWith('/') ||
    trimmed.includes('..') ||
    !trimmed.endsWith('.js') ||
    /[<>:"|?*]/.test(trimmed)
  ) {
    throw new Error('Invalid extension manifest: "main" must be a relative .js path without traversal.')
  }

  return trimmed
}

// Compares dot-separated versions. Returns negative/zero/positive.
function compareVersions(left, right) {
  const parts = (value) =>
    String(value).split('.').map((entry) => {
      const parsed = Number.parseInt(entry, 10)

      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    })
  const a = parts(left)
  const b = parts(right)
  const length = Math.max(a.length, b.length, 3)

  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0)

    if (diff !== 0) {
      return diff
    }
  }

  return 0
}

function validateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid extension manifest: an object is required.')
  }

  if (raw.manifestVersion !== 1) {
    throw new Error('Invalid extension manifest: "manifestVersion" must be 1.')
  }

  if (typeof raw.id !== 'string' || !EXTENSION_ID_PATTERN.test(raw.id)) {
    throw new Error('Invalid extension manifest: "id" must look like "publisher.name".')
  }

  if (typeof raw.version !== 'string' || !VERSION_PATTERN.test(raw.version)) {
    throw new Error('Invalid extension manifest: "version" must be semver (x.y.z).')
  }

  if (raw.apiVersion !== PLATFORM_API_VERSION) {
    throw new Error(
      `Unsupported extension API version ${String(raw.apiVersion).slice(0, 20)}; this KryomCode supports ${PLATFORM_API_VERSION}.`
    )
  }

  const permissions = validatePermissionList(raw.permissions, 'permissions')
  const optionalPermissions = validatePermissionList(raw.optionalPermissions, 'optionalPermissions')

  for (const entry of optionalPermissions) {
    if (permissions.includes(entry)) {
      throw new Error(`Invalid extension manifest: "${entry}" is both required and optional.`)
    }
  }

  const contributes = raw.contributes === undefined || raw.contributes === null ? {} : raw.contributes

  if (!contributes || typeof contributes !== 'object' || Array.isArray(contributes)) {
    throw new Error('Invalid extension manifest: "contributes" must be an object.')
  }

  let engines = null

  if (raw.engines !== undefined && raw.engines !== null) {
    if (!raw.engines || typeof raw.engines !== 'object' || Array.isArray(raw.engines)) {
      throw new Error('Invalid extension manifest: "engines" must be an object.')
    }

    if (raw.engines.kryomcode !== undefined && raw.engines.kryomcode !== null) {
      if (
        typeof raw.engines.kryomcode !== 'string' ||
        !/^\d+\.\d+\.\d+$/.test(raw.engines.kryomcode.trim())
      ) {
        throw new Error('Invalid extension manifest: "engines.kryomcode" must be semver (x.y.z).')
      }

      engines = { kryomcode: raw.engines.kryomcode.trim() }
    }
  }

  return {
    manifestVersion: 1,
    id: raw.id,
    name: assertNonEmpty(raw.name, 'name', 200),
    description: typeof raw.description === 'string' ? raw.description.slice(0, MAX_TEXT) : '',
    version: raw.version,
    publisher: assertNonEmpty(raw.publisher, 'publisher', 200),
    main: validateMain(raw.main),
    apiVersion: PLATFORM_API_VERSION,
    engines,
    permissions,
    optionalPermissions,
    contributes: {
      commands: validateCommands(contributes.commands),
    },
    dependencies: validateDependencies(raw.dependencies),
  }
}

// Host compatibility: the extension's minimum KryomCode version
// must not exceed the running host.
function checkHostCompatibility(manifest, hostVersion) {
  if (!manifest.engines || !manifest.engines.kryomcode) {
    return { compatible: true, reason: 'No minimum host version declared.' }
  }

  if (typeof hostVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(hostVersion)) {
    return { compatible: false, reason: 'Host version is unknown.' }
  }

  if (compareVersions(hostVersion, manifest.engines.kryomcode) < 0) {
    return {
      compatible: false,
      reason: `Requires KryomCode ${manifest.engines.kryomcode}; host is ${hostVersion}.`,
    }
  }

  return { compatible: true, reason: `Host ${hostVersion} satisfies ${manifest.engines.kryomcode}.` }
}

module.exports = {
  PLATFORM_API_VERSION,
  MANIFEST_FILE,
  EXTENSION_ID_PATTERN,
  VERSION_PATTERN,
  validateManifest,
  compareVersions,
  checkHostCompatibility,
}
