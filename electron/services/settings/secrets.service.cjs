// Central allowlist for process secrets. Only these names may be read
// through getSecret, and only these names are scrubbed from child
// process environments. Nothing here ever leaves the main process.

const SECRET_KEYS = ['MODEL_API_KEY']

function isSecretKey(key) {
  return typeof key === 'string' && SECRET_KEYS.includes(key)
}

function getSecret(name) {
  if (!isSecretKey(name)) {
    throw new Error(`Unknown secret "${String(name).slice(0, 100)}".`)
  }

  return process.env[name]?.trim() || ''
}

module.exports = {
  SECRET_KEYS,
  isSecretKey,
  getSecret,
}
