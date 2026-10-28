// Registry of running child processes. Every spawned command registers
// here so the app can report status, cancel runs, and terminate stragglers
// on shutdown. Registration stores metadata only, never output.
const { spawnSync } = require('node:child_process')

let nextId = 1
const active = new Map()

// Terminates a child and its descendants. On Windows, child.kill()
// stops only the console shell and orphans grandchildren (npm scripts,
// dev servers), so the whole tree is force-killed via taskkill. The
// platform/spawn overrides exist so both branches stay testable.
function killProcessTree(child, overrides = {}) {
  if (!child) {
    return false
  }

  const platform = overrides.platform || process.platform

  if (platform === 'win32' && child.pid) {
    try {
      const runner = overrides.spawnSync || spawnSync
      const result = runner('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })

      if (result && result.status === 0) {
        return true
      }
    } catch {
      // Fall through to plain kill below.
    }
  }

  try {
    return child.kill() === true
  } catch {
    return false
  }
}

function registerProcess(child, { command } = {}) {
  const id = `proc-${nextId++}`

  active.set(id, {
    child,
    command: typeof command === 'string' ? command.slice(0, 200) : '',
    startedAt: Date.now(),
  })

  return id
}

function unregisterProcess(id) {
  active.delete(id)
}

function listProcesses() {
  return [...active.entries()].map(([id, meta]) => ({
    id,
    command: meta.command,
    startedAt: meta.startedAt,
  }))
}

function killAllProcesses() {
  let killed = 0

  for (const [, meta] of active) {
    if (killProcessTree(meta.child)) {
      killed += 1
    }
  }

  active.clear()

  return { killed }
}

module.exports = {
  registerProcess,
  unregisterProcess,
  listProcesses,
  killAllProcesses,
  killProcessTree,
}
