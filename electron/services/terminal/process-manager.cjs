// Registry of running child processes. Every spawned command registers
// here so the app can report status, cancel runs, and terminate stragglers
// on shutdown. Registration stores metadata only, never output.
const { spawnSync } = require('node:child_process')

let nextId = 1
const active = new Map()

// Children killed through a cancel path (as opposed to timeouts or
// natural exits). Runners consume the mark when their child closes
// so results report `cancelled` honestly. Weak refs: entries vanish
// with their child objects even if a close event never arrives.
const killMarked = new WeakSet()

function markKilled(child) {
  if (child) {
    killMarked.add(child)
  }
}

function consumeKillMark(child) {
  if (child && killMarked.has(child)) {
    killMarked.delete(child)

    return true
  }

  return false
}

// Children spawned detached on POSIX (their own process group; see
// platform.shouldDetach). Group signals are sent ONLY to marked
// children: signaling an unmarked pid's group could hit the app's
// own process group.
const detachedChildren = new WeakSet()

function markDetachedProcess(child) {
  if (child) {
    detachedChildren.add(child)
  }
}

// Terminates a child and its descendants. On Windows, child.kill()
// stops only the console shell and orphans grandchildren (npm scripts,
// dev servers), so the whole tree is force-killed via taskkill. On
// POSIX, detached children die by process-group signal so grandchildren
// cannot outlive a cancel/timeout either. The platform/spawn/kill
// overrides exist so every branch stays testable.
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

  if (platform !== 'win32' && child.pid && detachedChildren.has(child)) {
    try {
      const signaler = overrides.killSignal || ((pgid, signal) => process.kill(pgid, signal))

      signaler(-child.pid, 'SIGTERM')

      return true
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

  // Only successful kills leave the registry: a failed kill keeps
  // its entry so the process stays visible (and a later cancel can
  // retry it) until its close handler unregisters it.
  for (const [id, meta] of active) {
    markKilled(meta.child)

    if (killProcessTree(meta.child)) {
      killed += 1
      active.delete(id)
    }
  }

  return { killed }
}

module.exports = {
  registerProcess,
  unregisterProcess,
  listProcesses,
  killAllProcesses,
  killProcessTree,
  markKilled,
  consumeKillMark,
  markDetachedProcess,
}
