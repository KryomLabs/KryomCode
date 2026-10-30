// Central allowlist for process secrets. Only these names may be read
// through getSecret, and only these names are scrubbed from child
// process environments. Nothing here ever leaves the main process.
//
// Two sources feed getSecret: the process environment (development
// `.env`, always wins) and the main-process memory cache populated by
// the OS-encrypted credential vault (user-owned keys from Settings).
// getSecretSource reports which source is active for honest UI.
const SECRET_KEYS = ['MODEL_API_KEY', 'TAVILY_API_KEY']

// Decrypted vault values. Written only by the credential vault after
// safeStorage decryption; read only through getSecret. Never logged,
// never serialized, never sent over IPC.
const vaultCache = new Map()

function isSecretKey(key) {
  return typeof key === 'string' && SECRET_KEYS.includes(key)
}

function getSecret(name) {
  if (!isSecretKey(name)) {
    throw new Error(`Unknown secret "${String(name).slice(0, 100)}".`)
  }

  return process.env[name]?.trim() || vaultCache.get(name) || ''
}

function getSecretSource(name) {
  if (!isSecretKey(name)) {
    throw new Error(`Unknown secret "${String(name).slice(0, 100)}".`)
  }

  if (process.env[name]?.trim()) {
    return 'environment'
  }

  if (vaultCache.get(name)) {
    return 'vault'
  }

  return 'missing'
}

function setCachedSecret(name, value) {
  if (!isSecretKey(name)) {
    throw new Error(`Unknown secret "${String(name).slice(0, 100)}".`)
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Invalid cached secret: a non-empty string is required.')
  }

  vaultCache.set(name, value)
}

function clearCachedSecret(name) {
  if (!isSecretKey(name)) {
    throw new Error(`Unknown secret "${String(name).slice(0, 100)}".`)
  }

  vaultCache.delete(name)
}

function clearCachedSecrets() {
  vaultCache.clear()
}

module.exports = {
  SECRET_KEYS,
  isSecretKey,
  getSecret,
  getSecretSource,
  setCachedSecret,
  clearCachedSecret,
  clearCachedSecrets,
}
