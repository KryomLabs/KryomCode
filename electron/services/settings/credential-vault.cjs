// User-owned credential vault (Level 3C, Phase 6). Provider API keys
// entered in Settings are encrypted with the operating system's
// credential mechanism (Electron safeStorage: DPAPI on Windows,
// Keychain on macOS, libsecret/kwallet on Linux) and stored in the
// Electron userData folder. Main process only: decrypted values live
// in memory here and NEVER cross the IPC boundary — the renderer
// only learns configured/not-configured plus the credential source.
//
// Precedence: an environment secret always wins over a vault secret,
// so `.env`-based development keeps working untouched and a
// development key is never copied into the vault automatically.
// When safeStorage encryption is unavailable the vault refuses to
// write and reports the limitation; plaintext fallback is forbidden.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  isSecretKey,
  SECRET_KEYS,
} = require('./secrets.service.cjs')
const {
  setCachedSecret,
  clearCachedSecret,
} = require('./secrets.service.cjs')

const VAULT_FILE = 'kryomcode-credentials.json'
const VAULT_VERSION = 1
const MAX_KEY_CHARS = 500

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('Credential storage is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

function vaultPath(baseDir) {
  return path.join(baseDir || defaultBaseDir(), VAULT_FILE)
}

// Resolves the OS encryption backend. `options.safeStorage` is the
// test seam; production uses Electron's safeStorage. Anything else
// (plain-Node `require('electron')` returns a path string) means no
// backend, which the vault reports instead of working around.
function resolveSafeStorage(options = {}) {
  if (options && options.safeStorage) {
    return options.safeStorage
  }

  try {
    const electron = require('electron')
    const storage = electron && electron.safeStorage

    if (
      storage &&
      typeof storage.encryptString === 'function' &&
      typeof storage.decryptString === 'function' &&
      typeof storage.isEncryptionAvailable === 'function'
    ) {
      return storage
    }
  } catch {
    // No Electron runtime: no backend.
  }

  return null
}

function isVaultAvailable(options = {}) {
  const storage = resolveSafeStorage(options)

  if (!storage) {
    return false
  }

  try {
    return storage.isEncryptionAvailable() === true
  } catch {
    return false
  }
}

function assertSecretName(name) {
  if (!isSecretKey(name)) {
    throw new Error(`Unknown credential "${String(name).slice(0, 100)}".`)
  }

  return name
}

function assertKeyValue(value) {
  if (typeof value !== 'string') {
    throw new Error('Invalid API key: a string is required.')
  }

  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error('Invalid API key: the value is empty.')
  }

  if (trimmed.length > MAX_KEY_CHARS) {
    throw new Error(
      `Invalid API key: the value exceeds ${MAX_KEY_CHARS} characters.`
    )
  }

  return trimmed
}

// Reads the raw vault document without decrypting: shape-checked,
// never throws secret content. Returns null when no vault file exists.
async function readVaultDocument(baseDir) {
  let raw = null

  try {
    raw = await fs.readFile(vaultPath(baseDir), 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null
    }

    throw new Error('Stored credentials could not be read.')
  }

  let parsed = null

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      'Stored credentials are corrupt. Remove and re-enter the API key in Settings → Providers.'
    )
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    parsed.version !== VAULT_VERSION ||
    !parsed.secrets ||
    typeof parsed.secrets !== 'object' ||
    Array.isArray(parsed.secrets)
  ) {
    throw new Error(
      'Stored credentials are corrupt. Remove and re-enter the API key in Settings → Providers.'
    )
  }

  return parsed
}

async function writeVaultDocument(document, baseDir) {
  const filePath = vaultPath(baseDir)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  // Atomic write (tmp + rename): a crash mid-write never leaves a
  // torn vault behind, mirroring the storage-path layer.
  const tmpPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`

  await fs.writeFile(tmpPath, JSON.stringify(document, null, 2), { encoding: 'utf8', mode: 0o600 })

  try {
    await fs.rename(tmpPath, filePath)
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined)
    throw error
  }

  // Owner-only permissions where the platform honors them. Windows
  // ACLs ignore the mode; the safeStorage encryption is the real
  // protection there.
  try {
    await fs.chmod(filePath, 0o600)
  } catch {
    // Best effort only.
  }
}

// Loads vault secrets into the main-process memory cache. Called once
// at startup; safe to re-run. Returns the status snapshot. A missing
// file is a normal empty vault, never an error.
async function loadVault(options = {}) {
  const storage = resolveSafeStorage(options)
  const baseDir = options.baseDir || undefined

  if (!storage) {
    return vaultStatus(options)
  }

  let available = false

  try {
    available = storage.isEncryptionAvailable() === true
  } catch {
    available = false
  }

  if (!available) {
    return vaultStatus(options)
  }

  const document = await readVaultDocument(baseDir)

  if (!document) {
    return vaultStatus(options)
  }

  for (const [name, cipher] of Object.entries(document.secrets)) {
    if (!isSecretKey(name) || typeof cipher !== 'string' || !cipher) {
      continue
    }

    let plain = ''

    try {
      plain = storage.decryptString(Buffer.from(cipher, 'base64'))
    } catch {
      throw new Error(
        'Stored credentials could not be decrypted. Remove and re-enter the API key in Settings → Providers.'
      )
    }

    if (typeof plain === 'string' && plain.trim()) {
      setCachedSecret(name, plain.trim())
    } else {
      clearCachedSecret(name)
    }
  }

  return vaultStatus(options)
}

// Stores one key: encrypts with safeStorage, persists the vault file,
// and refreshes the memory cache. Returns presence info only.
async function setVaultSecret(name, value, options = {}) {
  assertSecretName(name)

  const trimmed = assertKeyValue(value)
  const storage = resolveSafeStorage(options)

  if (!storage || storage.isEncryptionAvailable() !== true) {
    throw new Error(
      'Secure credential storage is unavailable on this system. ' +
        'The API key was not saved. Use the MODEL_API_KEY environment variable instead.'
    )
  }

  const baseDir = options.baseDir || undefined
  const existing = await readVaultDocument(baseDir)
  const secrets = existing ? { ...existing.secrets } : {}

  let cipher = null

  try {
    cipher = storage.encryptString(trimmed).toString('base64')
  } catch {
    throw new Error('Secure credential storage failed to encrypt the API key.')
  }

  secrets[name] = cipher

  await writeVaultDocument({ version: VAULT_VERSION, secrets }, baseDir)
  setCachedSecret(name, trimmed)

  const { getSecretSource } = require('./secrets.service.cjs')

  return { saved: true, name, source: getSecretSource(name) }
}

// Removes one key from the vault file and the memory cache. An
// environment secret still counts as configured afterwards: removal
// only clears what the vault owns.
async function removeVaultSecret(name, options = {}) {
  assertSecretName(name)

  const baseDir = options.baseDir || undefined
  const existing = await readVaultDocument(baseDir)
  let removed = false

  if (existing && existing.secrets[name] !== undefined) {
    const secrets = { ...existing.secrets }

    delete secrets[name]
    removed = true

    if (Object.keys(secrets).length === 0) {
      try {
        await fs.unlink(vaultPath(baseDir))
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw new Error('Stored credentials could not be removed.')
        }
      }
    } else {
      await writeVaultDocument({ version: VAULT_VERSION, secrets }, baseDir)
    }
  }

  clearCachedSecret(name)

  const {
    getSecret,
    getSecretSource,
  } = require('./secrets.service.cjs')

  return {
    removed,
    name,
    configured: getSecret(name).length > 0,
    source: getSecretSource(name),
  }
}

// Presence-only snapshot for IPC and startup logging. Secret values
// never appear here.
function vaultStatus(options = {}) {
  const {
    getSecret,
    getSecretSource,
  } = require('./secrets.service.cjs')

  const keys = {}

  for (const name of SECRET_KEYS) {
    keys[name] = {
      configured: getSecret(name).length > 0,
      source: getSecretSource(name),
    }
  }

  return { available: isVaultAvailable(options), keys }
}

module.exports = {
  VAULT_FILE,
  VAULT_VERSION,
  MAX_KEY_CHARS,
  isVaultAvailable,
  loadVault,
  setVaultSecret,
  removeVaultSecret,
  vaultStatus,
}
