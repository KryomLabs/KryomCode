// Parent side of extension process isolation. Spawns ONE child per
// active extension (Electron utilityProcess in production,
// child_process.fork under plain Node/tests) and enforces:
//
// - per-request timeouts (activate + command invoke),
// - a sampled RSS cap from child heartbeats (soft limit: the OS is
//   not asked for a hard cgroup/job-object cap, so this is honest
//   mitigation, not a guarantee),
// - crash/exit recovery with clear errors,
// - validated, size-bounded messages in both directions.
//
// Nothing here changes the extension contract: lifecycle.cjs keeps
// its inputs/outputs, permissions still enforce at the membrane
// boundary (inside the child, against the same stores), and the vm
// sandbox inside the child is unchanged. A stronger boundary than
// in-process vm alone; NOT a claim that arbitrary hostile code is
// safe to install. Extension installs stay disabled-by-default with
// explicit user trust.
const path = require('node:path')

const {
  ACTIVATION_TIMEOUT_MS,
  HANDLER_TIMEOUT_MS,
} = require('../runtime.cjs')
const { createLogger } = require('../../../utils/logger.cjs')

const log = createLogger('extension-host')

const WORKER_ENTRY = path.join(__dirname, 'extension-worker.cjs')
const DEFAULT_MEMORY_CAP_BYTES = 256 * 1024 * 1024
const TIMEOUT_MARGIN_MS = 5000
const SHUTDOWN_GRACE_MS = 2000
const MAX_RESULT_BYTES = 1024 * 1024

function resultSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function validateChildMessage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Malformed worker message: an object is required.')
  }

  if (raw.kind === 'heartbeat') {
    if (typeof raw.rss !== 'number' || typeof raw.heapUsed !== 'number') {
      throw new Error('Malformed worker heartbeat.')
    }

    return raw
  }

  if (raw.kind !== 'result') {
    throw new Error(`Unknown worker message kind "${String(raw.kind).slice(0, 40)}".`)
  }

  if (!Number.isInteger(raw.seq) || raw.seq < 0) {
    throw new Error('Malformed worker result: bad seq.')
  }

  if (typeof raw.ok !== 'boolean') {
    throw new Error('Malformed worker result: ok must be boolean.')
  }

  if (resultSize(raw) > MAX_RESULT_BYTES) {
    throw new Error('Worker result exceeds the 1 MB cap.')
  }

  return raw
}

// Launcher selection. utilityProcess exists only in Electron's main
// process; plain Node (tests, scripts) uses child_process.fork.
// Callers may inject { launcher: 'fork' | 'utility', ... }.
function selectLauncher(overrides = {}) {
  if (overrides.launcher === 'fork' || overrides.launcher === 'utility') {
    return overrides.launcher
  }

  try {
    const electron = require('electron')

    if (electron && electron.utilityProcess) {
      return 'utility'
    }
  } catch {
    // Plain Node: fall through to fork.
  }

  return 'fork'
}

function spawnChild(extensionId, overrides = {}) {
  const launcher = selectLauncher(overrides)

  if (launcher === 'utility') {
    const { utilityProcess } = require('electron')

    const child = utilityProcess.fork(WORKER_ENTRY, [], {
      serviceName: `kryom-extension-${extensionId}`.slice(0, 80),
      stdio: 'pipe',
      execArgv: [],
    })

    return {
      launcher,
      child,
      send: (message) => child.postMessage(message),
      onMessage: (fn) => child.on('message', (event) => fn(event && event.data)),
      onExit: (fn) => child.on('exit', (code) => fn(code)),
      kill: () => {
        try {
          return child.kill()
        } catch {
          return false
        }
      },
    }
  }

  const { fork } = require('node:child_process')
  const child = fork(WORKER_ENTRY, [], {
    silent: true,
    execArgv: [],
  })

  // Keep child stdio visible for diagnosis without ever treating it
  // as protocol: the protocol travels on the IPC channel only.
  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      process.stdout.write(`[ext:${extensionId}] ${chunk}`)
    })
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      process.stderr.write(`[ext:${extensionId}] ${chunk}`)
    })
  }

  return {
    launcher,
    child,
    send: (message) => child.send(message),
    onMessage: (fn) => child.on('message', fn),
    onExit: (fn) => child.on('exit', (code) => fn(code)),
    kill: () => {
      try {
        return child.kill('SIGTERM')
      } catch {
        return false
      }
    },
  }
}

class ExtensionHost {
  constructor(extensionId, transport, options = {}) {
    this.id = extensionId
    this.transport = transport
    this.memoryCapBytes = options.memoryCapBytes || DEFAULT_MEMORY_CAP_BYTES
    this.activateTimeoutMs = options.activateTimeoutMs || ACTIVATION_TIMEOUT_MS + TIMEOUT_MARGIN_MS
    this.invokeTimeoutMs = options.invokeTimeoutMs || HANDLER_TIMEOUT_MS + TIMEOUT_MARGIN_MS
    this.shutdownTimeoutMs = options.shutdownTimeoutMs || SHUTDOWN_GRACE_MS
    this.seq = 0
    this.pending = new Map()
    this.dead = false
    this.deathReason = null
    this.lastRss = null
    this.lastHeapUsed = null
    this.commands = []

    transport.onMessage((raw) => this.handleMessage(raw))
    transport.onExit((code) => this.handleExit(code))
  }

  handleMessage(raw) {
    let message = null

    try {
      message = validateChildMessage(raw)
    } catch (error) {
      this.failHost(`Protocol violation: ${error.message}`)

      return
    }

    if (message.kind === 'heartbeat') {
      this.lastRss = message.rss
      this.lastHeapUsed = message.heapUsed

      if (message.rss > this.memoryCapBytes) {
        this.failHost(
          `Extension exceeded the ${Math.round(this.memoryCapBytes / 1024 / 1024)} MB memory cap ` +
            `(${Math.round(message.rss / 1024 / 1024)} MB resident).`
        )
      }

      return
    }

    const waiter = this.pending.get(message.seq)

    if (!waiter) {
      return
    }

    this.pending.delete(message.seq)
    clearTimeout(waiter.timer)
    waiter.settle(message)
  }

  handleExit(code) {
    if (!this.dead) {
      this.failHost(`Extension host exited unexpectedly (code ${code ?? 'unknown'}).`)
    }
  }

  failHost(reason) {
    if (this.dead) {
      return
    }

    this.dead = true
    this.deathReason = reason
    log.error(`Extension ${this.id} host failed: ${reason}`)

    try {
      this.transport.kill()
    } catch {
      // Already gone.
    }

    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.settle({ kind: 'result', ok: false, error: reason })
    }

    this.pending.clear()
  }

  request(message, timeoutMs) {
    if (this.dead) {
      return Promise.resolve({ kind: 'result', ok: false, error: this.deathReason })
    }

    this.seq += 1
    const seq = this.seq

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq)
        this.failHost(`Extension request timed out after ${timeoutMs} ms (host terminated).`)
        resolve({ kind: 'result', ok: false, error: this.deathReason })
      }, timeoutMs)

      // Node timers keep the loop alive; a pure timeout handle must
      // never hold the main process open by itself.
      if (typeof timer.unref === 'function') {
        timer.unref()
      }

      this.pending.set(seq, { timer, settle: resolve })

      try {
        this.transport.send({ ...message, seq })
      } catch (error) {
        this.pending.delete(seq)
        clearTimeout(timer)
        this.failHost(`Extension host send failed: ${error.message}`)
        resolve({ kind: 'result', ok: false, error: this.deathReason })
      }
    })
  }

  async activate({ entryPath, manifest, workspaceRoot, baseDir }) {
    const response = await this.request(
      { kind: 'activate', entryPath, manifest, workspaceRoot, baseDir },
      this.activateTimeoutMs
    )

    if (!response.ok) {
      return { ok: false, error: response.error }
    }

    const outcome = response.value

    if (outcome && outcome.ok) {
      this.commands = Array.isArray(outcome.commands) ? outcome.commands : []
    }

    return outcome
  }

  async invoke(commandId, args = {}) {
    const response = await this.request(
      { kind: 'invoke', commandId, args },
      this.invokeTimeoutMs
    )

    if (!response.ok) {
      throw new Error(response.error)
    }

    return response.value
  }

  async shutdown() {
    if (this.dead) {
      return { shutdown: true, dead: true }
    }

    const response = await this.request({ kind: 'shutdown' }, this.shutdownTimeoutMs).catch(() => null)

    this.dead = true

    try {
      this.transport.kill()
    } catch {
      // Already gone.
    }

    return (response && response.value) || { shutdown: true }
  }

  status() {
    return {
      id: this.id,
      launcher: this.transport.launcher,
      alive: !this.dead,
      deathReason: this.deathReason,
      commands: [...this.commands],
      rss: this.lastRss,
      heapUsed: this.lastHeapUsed,
      memoryCapBytes: this.memoryCapBytes,
    }
  }
}

function spawnHost(extensionId, options = {}) {
  const transport = spawnChild(extensionId, options)

  return new ExtensionHost(extensionId, transport, options)
}

module.exports = {
  ExtensionHost,
  spawnHost,
  selectLauncher,
  WORKER_ENTRY,
  DEFAULT_MEMORY_CAP_BYTES,
}
