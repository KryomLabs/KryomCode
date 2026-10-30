// Process tree termination: Windows taskkill, POSIX process-group
// signals for detached children only, plain-kill fallbacks. Group
// signals never touch unmarked children (that could hit the app's
// own process group).
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  killAllProcesses,
  killProcessTree,
  listProcesses,
  markDetachedProcess,
  registerProcess,
  unregisterProcess,
} = require('./process-manager.cjs')

describe('process-manager-tree-kill', () => {
  it('returns false for missing children', () => {
    assert.equal(killProcessTree(null), false)
    assert.equal(killProcessTree(undefined), false)
  })

  it('retains failed kills in the registry for a later retry', () => {
    const stubborn = { pid: 424242, kill: () => false }
    const id = registerProcess(stubborn, { command: 'stubborn' })

    try {
      const first = killAllProcesses()

      assert.equal(first.killed, 0)
      assert.ok(listProcesses().some((entry) => entry.id === id))

      // Still tracked, so a later cancel retries instead of losing it.
      const second = killAllProcesses()

      assert.equal(second.killed, 0)
      assert.ok(listProcesses().some((entry) => entry.id === id))
    } finally {
      unregisterProcess(id)
    }

    assert.ok(!listProcesses().some((entry) => entry.id === id))
  })

  it('signals the process group of marked POSIX children', () => {
    const signals = []
    const child = { pid: 4242, kill: () => { throw new Error('must not plain-kill') } }

    markDetachedProcess(child)

    const killed = killProcessTree(child, {
      platform: 'linux',
      killSignal: (pgid, signal) => {
        signals.push([pgid, signal])
      },
    })

    assert.equal(killed, true)
    assert.deepEqual(signals, [[-4242, 'SIGTERM']])
  })

  it('never group-signals unmarked children', () => {
    let plainKilled = false
    const child = {
      pid: 4243,
      kill: () => {
        plainKilled = true

        return true
      },
    }

    const killed = killProcessTree(child, {
      platform: 'linux',
      killSignal: () => {
        throw new Error('must not group-signal unmarked child')
      },
    })

    assert.equal(killed, true)
    assert.equal(plainKilled, true)
  })

  it('falls back to plain kill when the group signal fails', () => {
    let plainKilled = false
    const child = {
      pid: 4244,
      kill: () => {
        plainKilled = true

        return true
      },
    }

    markDetachedProcess(child)

    const killed = killProcessTree(child, {
      platform: 'darwin',
      killSignal: () => {
        throw new Error('ESRCH')
      },
    })

    assert.equal(killed, true)
    assert.equal(plainKilled, true)
  })

  it('keeps the Windows taskkill branch intact', () => {
    const calls = []
    const child = { pid: 4245, kill: () => { throw new Error('must not plain-kill') } }

    const killed = killProcessTree(child, {
      platform: 'win32',
      spawnSync: (cmd, args) => {
        calls.push([cmd, args])

        return { status: 0 }
      },
    })

    assert.equal(killed, true)
    assert.deepEqual(calls, [[
      'taskkill',
      ['/pid', '4245', '/T', '/F'],
    ]])
  })
})
