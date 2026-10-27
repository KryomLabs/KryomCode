// Registry of running child processes. Every spawned command registers
// here so the app can report status, cancel runs, and terminate stragglers
// on shutdown. Registration stores metadata only, never output.

let nextId = 1
const active = new Map()

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
    try {
      if (meta.child.kill()) {
        killed += 1
      }
    } catch {
      // Already exited; the close handler settles the run.
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
}
