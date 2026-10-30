// Isolated extension runtime (Level 4A.2). Extension JavaScript
// executes inside `node:vm` contexts with no Node.js globals, no
// require/process/console, disabled code generation, and a
// per-call timeout. The only bridge out is the frozen `kryom`
// membrane, whose every method validates arguments, enforces the
// extension's granted permissions, and returns bounded JSON.
//
// Every vm invocation is wrapped: a crashing extension produces a
// structured error and an activation failure — never a core crash.
// Residual (documented): the sandbox is in-process, so it bounds
// time and API reach but not memory the way a separate process
// would; full process isolation is planned hardening.
const vm = require('node:vm')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  PLATFORM_API_VERSION,
} = require('./manifest.cjs')
const {
  requirePermission,
} = require('../permissions/permission.service.cjs')
const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  resolveWorkspacePath,
} = require('../../security/validate-path.cjs')
const {
  redactText,
  createLogger,
} = require('../../utils/logger.cjs')

const log = createLogger('extension-runtime')

const ACTIVATION_TIMEOUT_MS = 5000
const HANDLER_TIMEOUT_MS = 30000
const MAX_ENTRY_BYTES = 1024 * 1024
const MAX_ARGS_BYTES = 64 * 1024
const MAX_RESULT_BYTES = 256 * 1024
const MAX_READ_BYTES = 256 * 1024
const MAX_LIST_FILES = 200
const MAX_STORAGE_BYTES = 1024 * 1024
const MAX_STORAGE_KEY = 120
const MAX_LOG_CHARS = 2000

// Live sandboxes: extension id -> { context, commands, manifest }.
const activeSandboxes = new Map()

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('Extension runtime is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

function storageFile(baseDir, extensionId) {
  return path.join(
    baseDir || defaultBaseDir(),
    'kryomcode-extensions',
    'storage',
    extensionId,
    'store.json'
  )
}

async function readStorageMap(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // Missing or corrupt storage starts empty.
  }

  return {}
}

function jsonSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

function assertJsonable(value, name, max) {
  const size = jsonSize(value)

  if (size > max) {
    throw new Error(`${name} exceeds the ${max}-byte cap.`)
  }

  return value
}

// Deep-hardens a JSON-shaped value for the sandbox: null
// prototypes (no .constructor chain back to host intrinsics),
// frozen, realm-neutral. Anything non-JSON throws.
function hardenForSandbox(value) {
  let normalized = null

  try {
    normalized = JSON.parse(JSON.stringify(value) ?? 'null')
  } catch {
    throw new Error('Membrane value is not JSON-serializable.')
  }

  const convert = (entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry
    }

    if (Array.isArray(entry)) {
      const out = []

      for (const item of entry) {
        out.push(convert(item))
      }

      Object.setPrototypeOf(out, null)

      return Object.freeze(out)
    }

    const out = Object.create(null)

    for (const [key, item] of Object.entries(entry)) {
      out[key] = convert(item)
    }

    return Object.freeze(out)
  }

  return convert(normalized)
}

// Normalizes a sandbox-produced value for HOST consumption: a JSON
// round-trip in this realm strips the vm realm identity and yields
// plain host objects. Command results cross OUT to the host (and, in
// the isolated path, over IPC structured-clone which also yields
// plain objects), so both paths must agree here. Membrane values
// crossing INTO the sandbox stay null-prototype via hardenForSandbox.
function plainForHost(value) {
  try {
    return JSON.parse(JSON.stringify(value) ?? 'null')
  } catch {
    throw new Error('Membrane value is not JSON-serializable.')
  }
}

// Wraps a host function so the sandbox sees a null-prototype
// function whose resolved values are hardened. Async results come
// back as realm promises (see invokeSandboxed); the wrapper only
// shapes the value.
function sandboxFunction(implementation) {
  const wrapped = function (...args) {
    return implementation(...args)
  }

  Object.setPrototypeOf(wrapped, null)

  return Object.freeze(wrapped)
}

// Builds the frozen capability membrane for one extension. Every
// method enforces grants at this boundary; the sandbox receives no
// other bridge. The membrane tree is null-prototype throughout so
// no .constructor chain reaches host intrinsics.
function buildMembrane(extensionId, { baseDir, onCommand, workspaceRoot, realm }) {
  const permissionBase = baseDir

  const membrane = {
    version: PLATFORM_API_VERSION,
    extensionId,

    log(message) {
      log.info(`[${extensionId}] ${redactText(String(message)).slice(0, MAX_LOG_CHARS)}`)
    },

    commands: {
      registerCommand(id, handler) {
        if (typeof id !== 'string' || !id || id.length > 120) {
          throw new Error('registerCommand: id must be 1-120 characters.')
        }

        if (typeof handler !== 'function') {
          throw new Error(`registerCommand "${id}": handler must be a function.`)
        }

        onCommand(id, handler)
      },
    },

    workspace: {
      async getMetadata() {
        await requirePermission(`extension:${extensionId}`, 'workspace.metadata', permissionBase)

        const root = workspaceRoot || getWorkspaceRoot()

        if (!root) {
          return { open: false, name: null }
        }

        return { open: true, name: path.basename(root) }
      },

      async listFiles(prefix = '') {
        await requirePermission(`extension:${extensionId}`, 'workspace.metadata', permissionBase)

        if (typeof prefix !== 'string' || prefix.length > 500) {
          throw new Error('listFiles: invalid prefix.')
        }

        const root = workspaceRoot || getWorkspaceRoot()

        if (!root) {
          throw new Error('No project is open.')
        }

        const { buildTree } = require('../workspace/workspace.service.cjs')
        const tree = await buildTree(root, { maxDepth: 3 })
        const out = []

        const walk = (nodes, base) => {
          for (const node of nodes || []) {
            if (out.length >= MAX_LIST_FILES) {
              return
            }

            const rel = base ? `${base}/${node.name}` : node.name

            if (!rel.startsWith(prefix)) {
              if (node.children) {
                walk(node.children, rel)
              }

              continue
            }

            out.push(rel)

            if (node.children) {
              walk(node.children, rel)
            }
          }
        }

        walk(tree.children || [], '')

        return assertJsonable(
          { files: out.slice(0, MAX_LIST_FILES), truncated: out.length >= MAX_LIST_FILES },
          'listFiles result',
          MAX_RESULT_BYTES
        )
      },

      async readFile(relativePath) {
        await requirePermission(`extension:${extensionId}`, 'workspace.read', permissionBase)

        if (typeof relativePath !== 'string' || !relativePath || relativePath.length > 1000) {
          throw new Error('readFile: a workspace-relative path is required.')
        }

        const { path: resolved, stat } = await resolveWorkspacePath(relativePath, {
          allowMissing: false,
        })

        if (!stat.isFile() || stat.size > MAX_READ_BYTES) {
          throw new Error('readFile: file is not readable within the 256 KB cap.')
        }

        const content = await fs.readFile(resolved, 'utf8')

        return assertJsonable(
          { path: relativePath, content: content.slice(0, MAX_READ_BYTES), truncated: stat.size > MAX_READ_BYTES },
          'readFile result',
          MAX_RESULT_BYTES
        )
      },
    },

    storage: {
      async get(key) {
        if (typeof key !== 'string' || !key || key.length > MAX_STORAGE_KEY) {
          throw new Error('storage.get: invalid key.')
        }

        const map = await readStorageMap(storageFile(permissionBase, extensionId))

        return map[key] === undefined ? null : map[key]
      },

      async set(key, value) {
        if (typeof key !== 'string' || !key || key.length > MAX_STORAGE_KEY) {
          throw new Error('storage.set: invalid key.')
        }

        assertJsonable(value, 'storage value', MAX_RESULT_BYTES)

        const filePath = storageFile(permissionBase, extensionId)
        const map = await readStorageMap(filePath)

        map[key] = value

        const serialized = JSON.stringify(map)

        if (Buffer.byteLength(serialized, 'utf8') > MAX_STORAGE_BYTES) {
          throw new Error('Extension storage quota (1 MB) exceeded.')
        }

        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, serialized, 'utf8')

        return true
      },
    },

    ai: {
      async complete({ prompt, model } = {}) {
        await requirePermission(`extension:${extensionId}`, 'ai.provider', permissionBase)

        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) {
          throw new Error('ai.complete: prompt must be 1-8000 characters.')
        }

        const { routeChat } = require('../ai/router.cjs')
        const result = await routeChat({
          model: typeof model === 'string' && model ? model : undefined,
          messages: [{ role: 'user', content: prompt }],
          requires: ['text'],
          baseDir: permissionBase,
        })

        return assertJsonable(
          { answer: result.answer.slice(0, 8000), model: result.model, provider: result.route.providerId },
          'ai.complete result',
          MAX_RESULT_BYTES
        )
      },
    },
  }

  // Finalize: every function becomes null-prototype, async
  // results resolve as realm promises with hardened values, and
  // the whole tree is null-prototype + frozen.
  const finalize = (node) => {
    if (typeof node === 'function') {
      return sandboxFunction((...args) => {
        const result = node(...args)

        if (result && typeof result.then === 'function' && realm && realm.context) {
          const CtxPromise = vm.runInContext('Promise', realm.context)
          const CtxError = vm.runInContext('Error', realm.context)

          return new CtxPromise((resolve, reject) => {
            result.then(
              (value) => {
                try {
                  resolve(hardenForSandbox(value))
                } catch (error) {
                  reject(new CtxError(error.message))
                }
              },
              (error) => {
                reject(new CtxError(error instanceof Error ? error.message : String(error)))
              }
            )
          })
        }

        if (result && typeof result === 'object') {
          return hardenForSandbox(result)
        }

        return result
      })
    }

    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const out = Object.create(null)

      for (const [key, entry] of Object.entries(node)) {
        out[key] = finalize(entry)
      }

      return Object.freeze(out)
    }

    return node
  }

  return finalize(membrane)
}

// The sandbox global is null-prototype: no .constructor or
// .__proto__ chain reaches host intrinsics. Only the membrane,
// a module container, and a safe console are exposed — the realm
// provides its own JSON/Math/Promise/Error. If vm ever rejects
// this shape, activation fails loudly (caught) rather than
// degrading silently.
function createContext(membrane, realm) {
  const moduleObject = Object.create(null)

  moduleObject.exports = Object.create(null)

  const consoleObject = Object.create(null)

  consoleObject.log = sandboxFunction((...args) =>
    membrane.log(args.map((entry) => String(entry)).join(' '))
  )
  Object.freeze(consoleObject)

  const sandbox = Object.create(null)

  sandbox.kryom = membrane
  sandbox.module = moduleObject
  sandbox.console = consoleObject

  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  })

  if (realm) {
    realm.context = context
  }

  return context
}

async function loadEntry(entryPath) {
  const stat = await fs.stat(entryPath).catch(() => null)

  if (!stat || !stat.isFile() || stat.size > MAX_ENTRY_BYTES) {
    throw new Error('Extension entry is missing or exceeds the 1 MB cap.')
  }

  return fs.readFile(entryPath, 'utf8')
}

// Runs extension code inside the vm with a timeout. Returns the
// completion value; async results race a host-side timeout since vm
// timeouts only bound synchronous execution.
async function invokeSandboxed(context, source, { timeoutMs, expression }) {
  let script = null

  try {
    script = new vm.Script(source, { filename: 'extension.js' })
  } catch (error) {
    throw new Error(`Extension code failed to parse: ${error.message}`)
  }

  let produced = null

  try {
    produced = script.runInContext(context, { timeout: timeoutMs })
  } catch (error) {
    throw new Error(`Extension ${expression} failed: ${error.message}`.slice(0, 500))
  }

  if (produced && typeof produced.then === 'function') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Extension ${expression} timed out after ${timeoutMs} ms.`))
      }, timeoutMs)

      if (timer.unref) {
        timer.unref()
      }

      produced.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(new Error(`Extension ${expression} failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500)))
        }
      )
    })
  }

  return produced
}

// Activates an installed extension: loads the entry, runs
// exports.activate inside the sandbox, and collects contributed
// commands. Returns { commands } — never throws for extension bugs
// (they surface as { ok: false, error }).
async function activateExtension(entry, manifest, { baseDir, workspaceRoot, timeoutMs } = {}) {
  if (activeSandboxes.has(manifest.id)) {
    throw new Error(`Extension "${manifest.id}" is already active.`)
  }

  const finishFailure = (error) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  })

  try {
    const entryPath = path.join(entry.path, manifest.main)
    const code = await loadEntry(entryPath)
    const commands = new Map()
    const realm = { context: null }

    const membrane = buildMembrane(manifest.id, {
      baseDir: baseDir || defaultBaseDir(),
      workspaceRoot,
      realm,
      onCommand: (id, handler) => {
        if (commands.size >= 50) {
          throw new Error('Command registration cap (50) exceeded.')
        }

        commands.set(id, handler)
      },
    })

    const context = createContext(membrane, realm)
    const wrapped = `${code}\n;__activationResult = (typeof module.exports.activate === 'function') ? module.exports.activate(kryom) : null;`

    await invokeSandboxed(context, wrapped, {
      timeoutMs: timeoutMs !== undefined ? timeoutMs : ACTIVATION_TIMEOUT_MS,
      expression: 'activation',
    })

    activeSandboxes.set(manifest.id, { context, commands, manifest })

    log.info(`Extension ${manifest.id} activated with ${commands.size} command(s).`)

    return {
      ok: true,
      commands: [...commands.keys()].map((id) => {
        const declared = manifest.contributes.commands.find((entry) => entry.id === id)

        return { id, title: declared ? declared.title : id }
      }),
    }
  } catch (error) {
    activeSandboxes.delete(manifest.id)

    return finishFailure(error)
  }
}

async function deactivateExtension(extensionId) {
  const sandbox = activeSandboxes.get(extensionId)

  if (!sandbox) {
    return { deactivated: false }
  }

  // Best-effort deactivate hook; failures never block deactivation.
  try {
    await invokeSandboxed(
      sandbox.context,
      ';__deactivationResult = (typeof module.exports.deactivate === "function") ? module.exports.deactivate(kryom) : null;',
      { timeoutMs: ACTIVATION_TIMEOUT_MS, expression: 'deactivation' }
    )
  } catch (error) {
    log.warn(`Extension ${extensionId} deactivation hook failed: ${error.message}`)
  }

  activeSandboxes.delete(extensionId)

  return { deactivated: true }
}

// Executes a registered extension command with validated,
// size-bounded arguments. Extension failures become structured
// errors; the host never crashes.
async function executeCommand(extensionId, commandId, args = {}, { timeoutMs } = {}) {
  const sandbox = activeSandboxes.get(extensionId)

  if (!sandbox) {
    throw new Error(`Extension "${extensionId}" is not active.`)
  }

  if (!sandbox.commands.has(commandId)) {
    throw new Error(`Unknown command "${commandId}" for extension "${extensionId}".`)
  }

  assertJsonable(args, 'Command arguments', MAX_ARGS_BYTES)

  // Arguments cross as a JSON string (a primitive — nothing host
  // shaped) and parse inside the realm; handlers live in a
  // null-prototype map so no host collection leaks in.
  const handlers = Object.create(null)

  for (const [id, handler] of sandbox.commands) {
    handlers[id] = handler
  }

  const source = `;__commandResult = __handlers[${JSON.stringify(commandId)}](JSON.parse(__argsJson));`

  sandbox.context.__handlers = handlers
  sandbox.context.__argsJson = JSON.stringify(args)

  try {
    const produced = await invokeSandboxed(sandbox.context, source, {
      timeoutMs: timeoutMs !== undefined ? timeoutMs : HANDLER_TIMEOUT_MS,
      expression: `command "${commandId}"`,
    })

    return assertJsonable(
      produced === undefined ? null : plainForHost(produced),
      'Command result',
      MAX_RESULT_BYTES
    )
  } finally {
    try {
      delete sandbox.context.__handlers
      delete sandbox.context.__argsJson
      delete sandbox.context.__commandResult
    } catch {
      // Cleanup is best-effort.
    }
  }
}

function isExtensionActive(extensionId) {
  return activeSandboxes.has(extensionId)
}

function listActiveCommands() {
  const out = []

  for (const [extensionId, sandbox] of activeSandboxes) {
    for (const id of sandbox.commands.keys()) {
      const declared = sandbox.manifest.contributes.commands.find((entry) => entry.id === id)

      out.push({ extensionId, id, title: declared ? declared.title : id })
    }
  }

  return out
}

module.exports = {
  ACTIVATION_TIMEOUT_MS,
  HANDLER_TIMEOUT_MS,
  activateExtension,
  deactivateExtension,
  executeCommand,
  isExtensionActive,
  listActiveCommands,
}
