// Credential vault tests (Level 3C, Phase 6). safeStorage is a test
// double here — plain Node has no Electron runtime — so the suite
// proves vault logic (precedence, persistence, validation, safe
// errors, no plaintext) rather than OS encryption itself.
const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  isVaultAvailable,
  loadVault,
  setVaultSecret,
  removeVaultSecret,
  vaultStatus,
  VAULT_FILE,
} = require('./credential-vault.cjs')
const {
  getSecret,
  getSecretSource,
  clearCachedSecrets,
} = require('./secrets.service.cjs')

// Clearly-labeled test cipher: reversible, NOT secure. It exists so
// persistence and no-plaintext assertions run without Electron.
function testSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) =>
      Buffer.from(`test-cipher:${plain}`, 'utf8'),
    decryptString: (cipher) => {
      const text = Buffer.isBuffer(cipher)
        ? cipher.toString('utf8')
        : Buffer.from(cipher, 'base64').toString('utf8')

      if (!text.startsWith('test-cipher:')) {
        throw new Error('decrypt failed')
      }

      return text.slice('test-cipher:'.length)
    },
  }
}

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-vault-'))
}

function clearEnv() {
  const saved = {
    MODEL_API_KEY: process.env.MODEL_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  }

  delete process.env.MODEL_API_KEY
  delete process.env.TAVILY_API_KEY

  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

describe('credential vault', () => {
  afterEach(() => {
    clearCachedSecrets()
  })

  it('reports unavailable without a safeStorage backend', () => {
    assert.equal(isVaultAvailable({}), false)
    assert.equal(isVaultAvailable(), false)
  })

  it('reports available with an encryption backend', () => {
    assert.equal(isVaultAvailable({ safeStorage: testSafeStorage() }), true)
  })

  it('stores a key and serves it through getSecret', async () => {
    const restore = clearEnv()
    const baseDir = await makeTempDir()

    try {
      const options = { baseDir, safeStorage: testSafeStorage() }
      const result = await setVaultSecret('MODEL_API_KEY', '  vault-key-1  ', options)

      assert.equal(result.saved, true)
      assert.equal(result.source, 'vault')
      assert.equal(getSecret('MODEL_API_KEY'), 'vault-key-1')
      assert.equal(getSecretSource('MODEL_API_KEY'), 'vault')
    } finally {
      restore()
    }
  })

  it('prefers the environment over the vault and never copies env into the vault', async () => {
    const restore = clearEnv()
    const baseDir = await makeTempDir()

    try {
      const options = { baseDir, safeStorage: testSafeStorage() }

      await setVaultSecret('MODEL_API_KEY', 'vault-key', options)

      process.env.MODEL_API_KEY = 'env-key'

      assert.equal(getSecret('MODEL_API_KEY'), 'env-key')
      assert.equal(getSecretSource('MODEL_API_KEY'), 'environment')

      const raw = await fs.readFile(path.join(baseDir, VAULT_FILE), 'utf8')

      assert.ok(!raw.includes('env-key'))
    } finally {
      restore()
    }
  })

  it('persists across loads without exposing plaintext on disk', async () => {
    const restore = clearEnv()
    const baseDir = await makeTempDir()

    try {
      const options = { baseDir, safeStorage: testSafeStorage() }

      await setVaultSecret('MODEL_API_KEY', 'persist-me-42', options)
      clearCachedSecrets()
      assert.equal(getSecret('MODEL_API_KEY'), '')

      await loadVault(options)

      assert.equal(getSecret('MODEL_API_KEY'), 'persist-me-42')

      const raw = await fs.readFile(path.join(baseDir, VAULT_FILE), 'utf8')

      assert.ok(!raw.includes('persist-me-42'))
    } finally {
      restore()
    }
  })

  it('removes a key from disk and cache while env secrets still count', async () => {
    const restore = clearEnv()
    const baseDir = await makeTempDir()

    try {
      const options = { baseDir, safeStorage: testSafeStorage() }

      await setVaultSecret('MODEL_API_KEY', 'vault-key', options)

      const removed = await removeVaultSecret('MODEL_API_KEY', options)

      assert.equal(removed.removed, true)
      assert.equal(removed.configured, false)
      assert.equal(removed.source, 'missing')
      assert.equal(getSecret('MODEL_API_KEY'), '')

      const second = await removeVaultSecret('MODEL_API_KEY', options)

      assert.equal(second.removed, false)

      await setVaultSecret('MODEL_API_KEY', 'vault-key', options)

      process.env.MODEL_API_KEY = 'env-key'

      const withEnv = await removeVaultSecret('MODEL_API_KEY', options)

      assert.equal(withEnv.removed, true)
      assert.equal(withEnv.configured, true)
      assert.equal(withEnv.source, 'environment')
    } finally {
      restore()
    }
  })

  it('rejects empty, oversized, non-string, and unknown credentials', async () => {
    const baseDir = await makeTempDir()
    const options = { baseDir, safeStorage: testSafeStorage() }

    await assert.rejects(
      () => setVaultSecret('MODEL_API_KEY', '   ', options),
      /empty/
    )
    await assert.rejects(
      () => setVaultSecret('MODEL_API_KEY', 'x'.repeat(501), options),
      /exceeds 500/
    )
    await assert.rejects(
      () => setVaultSecret('MODEL_API_KEY', 42, options),
      /string is required/
    )
    await assert.rejects(
      () => setVaultSecret('NOPE', 'value', options),
      /Unknown credential/
    )
    await assert.rejects(
      () => removeVaultSecret('NOPE', options),
      /Unknown credential/
    )
  })

  it('refuses to write when encryption is unavailable', async () => {
    const baseDir = await makeTempDir()

    await assert.rejects(
      () => setVaultSecret('MODEL_API_KEY', 'key', { baseDir }),
      /unavailable/
    )

    let exists = true

    try {
      await fs.stat(path.join(baseDir, VAULT_FILE))
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        exists = false
      }
    }

    assert.equal(exists, false)
  })

  it('fails safe on corrupt vault files without leaking content', async () => {
    const restore = clearEnv()
    const baseDir = await makeTempDir()

    try {
      await fs.writeFile(
        path.join(baseDir, VAULT_FILE),
        '{not json',
        'utf8'
      )

      await assert.rejects(
        () => loadVault({ baseDir, safeStorage: testSafeStorage() }),
        /corrupt/
      )
      assert.equal(getSecret('MODEL_API_KEY'), '')
    } finally {
      restore()
    }
  })

  it('reports presence-only status without secret values', async () => {
    const restore = clearEnv()
    const baseDir = await makeTempDir()

    try {
      const options = { baseDir, safeStorage: testSafeStorage() }

      await setVaultSecret('MODEL_API_KEY', 'status-key-9', options)

      const status = vaultStatus(options)

      assert.equal(status.available, true)
      assert.equal(status.keys.MODEL_API_KEY.configured, true)
      assert.equal(status.keys.MODEL_API_KEY.source, 'vault')
      assert.equal(status.keys.TAVILY_API_KEY.configured, false)
      assert.equal(status.keys.TAVILY_API_KEY.source, 'missing')
      assert.ok(!JSON.stringify(status).includes('status-key-9'))
    } finally {
      restore()
    }
  })

  it('treats a missing vault file as an empty vault', async () => {
    const restore = clearEnv()
    const baseDir = await makeTempDir()

    try {
      const status = await loadVault({ baseDir, safeStorage: testSafeStorage() })

      assert.equal(status.available, true)
      assert.equal(status.keys.MODEL_API_KEY.configured, false)
    } finally {
      restore()
    }
  })
})
