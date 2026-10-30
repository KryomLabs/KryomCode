// Extension worker entry. Runs extension code inside a dedicated child
// process (Electron utilityProcess in production, child_process.fork in
// tests/plain Node) instead of the main process.
//
// The child executes the SAME vm sandbox as runtime.cjs — the vm is
// unchanged. What changes is the blast radius: a vm escape, a wedged
// event loop, a memory bomb, or process.exit() in extension code can
// only kill this throwaway child. The parent (extension-host.cjs)
// enforces per-request timeouts, a sampled RSS cap, and crash
// recovery, and it tears the child down on deactivate/uninstall.
//
// Protocol (JSON-serializable objects only, both directions):
//   parent -> child:
//     { seq, kind: 'activate', entryPath, manifest, workspaceRoot, baseDir }
//     { seq, kind: 'invoke', commandId, args }
//     { seq, kind: 'shutdown' }
//   child -> parent:
//     { seq, kind: 'result', ok, value?, error? }
//     { kind: 'heartbeat', rss, heapUsed }
//
// The child never requires 'electron': baseDir and workspaceRoot are
// always explicit, so every host lookup stays on given paths. Secrets
// stay in the inherited environment because ai.complete legitimately
// needs them; the child runs trusted host code plus vm-jailed
// extension code — extension code itself only ever sees the membrane.
const path = require('node:path')

const HEARTBEAT_MS = 2000
const MAX_INBOUND_BYTES = 1024 * 1024

function createChannel() {
  // utilityProcess children speak over process.parentPort; forked
  // children use the IPC channel. Exactly one exists per runtime.
  if (typeof process !== 'undefined' && process.parentPort) {
    const port = process.parentPort

    return {
      onMessage: (fn) => port.on('message', (event) => fn(event && event.data)),
      send: (message) => port.postMessage(message),
    }
  }

  return {
    onMessage: (fn) => process.on('message', fn),
    send: (message) => {
      if (typeof process.send === 'function') {
        process.send(message)
      }
    },
  }
}

function inboundSize(message) {
  try {
    return Buffer.byteLength(JSON.stringify(message), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function validateInbound(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Malformed worker request: an object is required.')
  }

  if (!Number.isInteger(raw.seq) || raw.seq < 0) {
    throw new Error('Malformed worker request: seq must be a non-negative integer.')
  }

  if (raw.kind !== 'activate' && raw.kind !== 'invoke' && raw.kind !== 'shutdown') {
    throw new Error(`Malformed worker request: unknown kind "${String(raw.kind).slice(0, 40)}".`)
  }

  if (inboundSize(raw) > MAX_INBOUND_BYTES) {
    throw new Error('Worker request exceeds the 1 MB cap.')
  }

  if (raw.kind === 'activate') {
    if (typeof raw.entryPath !== 'string' || !raw.entryPath) {
      throw new Error('Worker activate needs an entryPath.')
    }

    if (!raw.manifest || typeof raw.manifest !== 'object' || typeof raw.manifest.id !== 'string') {
      throw new Error('Worker activate needs a manifest with an id.')
    }

    if (typeof raw.baseDir !== 'string' || !raw.baseDir) {
      throw new Error('Worker activate needs an explicit baseDir.')
    }
  }

  if (raw.kind === 'invoke') {
    if (typeof raw.commandId !== 'string' || !raw.commandId) {
      throw new Error('Worker invoke needs a commandId.')
    }

    if (raw.args !== undefined && (typeof raw.args !== 'object' || raw.args === null || Array.isArray(raw.args))) {
      throw new Error('Worker invoke args must be an object.')
    }
  }

  return raw
}

async function main() {
  const channel = createChannel()
  const {
    activateExtension,
    deactivateExtension,
    executeCommand,
    HANDLER_TIMEOUT_MS,
  } = require('../runtime.cjs')

  let activeId = null

  const heartbeat = setInterval(() => {
    try {
      const usage = process.memoryUsage()

      channel.send({ kind: 'heartbeat', rss: usage.rss, heapUsed: usage.heapUsed })
    } catch {
      // A failed heartbeat must never kill the child; the parent
      // treats silence as unhealthiness on its own timeouts.
    }
  }, HEARTBEAT_MS)

  if (typeof heartbeat.unref === 'function') {
    heartbeat.unref()
  }

  channel.onMessage(async (raw) => {
    let request = null

    try {
      request = validateInbound(raw)
    } catch (error) {
      channel.send({ seq: -1, kind: 'result', ok: false, error: error.message })

      return
    }

    const reply = (ok, extra) => {
      channel.send({ seq: request.seq, kind: 'result', ok, ...extra })
    }

    try {
      if (request.kind === 'shutdown') {
        if (activeId) {
          await deactivateExtension(activeId).catch(() => undefined)
          activeId = null
        }

        clearInterval(heartbeat)
        reply(true, { value: { shutdown: true } })

        setImmediate(() => process.exit(0))

        return
      }

      if (request.kind === 'activate') {
        // Belt and braces: the worker activates exactly one extension.
        if (activeId) {
          await deactivateExtension(activeId).catch(() => undefined)
          activeId = null
        }

        const entry = { path: path.dirname(request.entryPath) }
        const outcome = await activateExtension(entry, request.manifest, {
          baseDir: request.baseDir,
          workspaceRoot: request.workspaceRoot || null,
          timeoutMs: HANDLER_TIMEOUT_MS,
        })

        if (outcome.ok) {
          activeId = request.manifest.id
        }

        reply(true, { value: outcome })

        return
      }

      const value = await executeCommand(activeId, request.commandId, request.args || {})

      reply(true, { value })
    } catch (error) {
      reply(false, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}

main().catch((error) => {
  process.stderr.write(`extension worker failed to start: ${error.message}\n`)
  process.exit(1)
})
