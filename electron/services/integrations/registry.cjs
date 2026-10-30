// Integration registry (Level 4A.4). One contract for external
// developer services: adapters declare identity, auth, and
// capabilities; the registry validates shape, tracks connection
// state, and normalizes errors. GitHub ships as a local-git
// adapter; anything without a real API stays a documented
// contract, never a fake connection.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  isSecretKey,
} = require('../settings/secrets.service.cjs')

const INTEGRATIONS_FILE = 'kryomcode-integrations.json'
const INTEGRATIONS_VERSION = 1
const ADAPTER_ID_PATTERN = /^[a-z0-9-]{2,40}$/

const adapters = new Map()
let builtinsRegistered = false

function validateAdapter(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid integration adapter: an object is required.')
  }

  if (typeof raw.id !== 'string' || !ADAPTER_ID_PATTERN.test(raw.id)) {
    throw new Error('Invalid integration adapter: id must be 2-40 lowercase letters, digits, or dashes.')
  }

  if (typeof raw.displayName !== 'string' || !raw.displayName.trim() || raw.displayName.length > 100) {
    throw new Error(`Invalid integration adapter "${raw.id}": displayName is invalid.`)
  }

  const auth = raw.auth && typeof raw.auth === 'object' ? raw.auth : null

  if (!auth || !['none', 'token-env', 'oauth'].includes(auth.kind)) {
    throw new Error(`Invalid integration adapter "${raw.id}": auth.kind must be none, token-env, or oauth.`)
  }

  if (auth.kind === 'token-env' && (typeof auth.secretEnv !== 'string' || !isSecretKey(auth.secretEnv))) {
    throw new Error(`Invalid integration adapter "${raw.id}": token-env needs an allowlisted secret name.`)
  }

  if (!Array.isArray(raw.capabilities) || raw.capabilities.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Invalid integration adapter "${raw.id}": capabilities must be a string array.`)
  }

  for (const method of ['status', 'disconnect']) {
    if (typeof raw[method] !== 'function') {
      throw new Error(`Invalid integration adapter "${raw.id}": ${method} must be a function.`)
    }
  }

  for (const method of ['connect', 'repositories', 'history']) {
    if (raw[method] !== undefined && typeof raw[method] !== 'function') {
      throw new Error(`Invalid integration adapter "${raw.id}": ${method} must be a function.`)
    }
  }

  return raw
}

function registerAdapter(adapter) {
  const validated = validateAdapter(adapter)

  if (adapters.has(validated.id)) {
    throw new Error(`Integration "${validated.id}" is already registered.`)
  }

  adapters.set(validated.id, validated)

  return describeAdapter(validated.id)
}

function unregisterAdapter(id) {
  return adapters.delete(id)
}

function getAdapter(id) {
  const adapter = adapters.get(id)

  if (!adapter) {
    throw new Error(`Unknown integration "${String(id).slice(0, 60)}".`)
  }

  return adapter
}

function describeAdapter(id) {
  const adapter = getAdapter(id)

  return {
    id: adapter.id,
    displayName: adapter.displayName,
    description: typeof adapter.description === 'string' ? adapter.description : '',
    auth: adapter.auth.kind === 'none' ? { kind: 'none' } : { kind: adapter.auth.kind },
    capabilities: [...adapter.capabilities],
    methods: ['status', 'disconnect', 'connect', 'repositories', 'history'].filter(
      (method) => typeof adapter[method] === 'function'
    ),
  }
}

function listAdapters() {
  return [...adapters.keys()].sort().map((id) => describeAdapter(id))
}

function normalizeIntegrationError(error, adapterId) {
  const message = error instanceof Error ? error.message : 'Integration request failed.'

  return {
    adapterId,
    message: message.slice(0, 500),
    authFailure: /auth|token|credential|permission denied|unauthorized/i.test(message),
  }
}

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('Integration storage is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

async function readState(baseDir) {
  try {
    const raw = await fs.readFile(
      path.join(baseDir || defaultBaseDir(), INTEGRATIONS_FILE),
      'utf8'
    )
    const parsed = JSON.parse(raw)

    if (parsed && typeof parsed === 'object' && parsed.connections && typeof parsed.connections === 'object') {
      return { version: INTEGRATIONS_VERSION, connections: parsed.connections }
    }
  } catch {
    // Missing or corrupt state starts empty.
  }

  return { version: INTEGRATIONS_VERSION, connections: {} }
}

async function writeState(state, baseDir) {
  const filePath = path.join(baseDir || defaultBaseDir(), INTEGRATIONS_FILE)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8')

  return state
}

async function recordConnection(id, entry, baseDir) {
  const state = await readState(baseDir)

  state.connections[id] = {
    state: entry.state,
    updatedAt: new Date().toISOString(),
    account: typeof entry.account === 'string' ? entry.account.slice(0, 200) : null,
    detail: typeof entry.detail === 'string' ? entry.detail.slice(0, 500) : null,
  }

  await writeState(state, baseDir)

  return state.connections[id]
}

async function clearConnection(id, baseDir) {
  const state = await readState(baseDir)

  delete state.connections[id]
  await writeState(state, baseDir)

  return { id, cleared: true }
}

async function connectionState(id, baseDir) {
  const state = await readState(baseDir)

  return state.connections[id] || { state: 'disconnected', updatedAt: null, account: null, detail: null }
}

function registerBuiltins() {
  if (builtinsRegistered) {
    return listAdapters()
  }

  const { githubAdapter } = require('./github.adapter.cjs')

  registerAdapter(githubAdapter)
  builtinsRegistered = true

  return listAdapters()
}

function ensureBuiltins() {
  if (!builtinsRegistered) {
    registerBuiltins()
  }
}

module.exports = {
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  describeAdapter,
  listAdapters,
  normalizeIntegrationError,
  recordConnection,
  clearConnection,
  connectionState,
  registerBuiltins,
  ensureBuiltins,
}
