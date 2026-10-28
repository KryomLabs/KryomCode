const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  runCommand,
  buildChildEnv,
  listRunningProcesses,
  cancelRunningProcesses,
} = require('./terminal.service.cjs')
const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  killProcessTree,
} = require('./process-manager.cjs')

describe('terminal.service', () => {
  it('never exposes MODEL_API_KEY to child processes', () => {
    process.env.MODEL_API_KEY = 'test-secret-must-not-leak'
    process.env.KRYOM_SAFE_MARKER = 'keep-me'

    try {
      const env = buildChildEnv()

      assert.equal('MODEL_API_KEY' in env, false)
      assert.equal(env.KRYOM_SAFE_MARKER, 'keep-me')
    } finally {
      delete process.env.MODEL_API_KEY
      delete process.env.KRYOM_SAFE_MARKER
    }
  })

  // Runs before any workspace is opened in this file, so it exercises
  // the no-workspace gate. Keep it above the tests that open one.
  it('requires an open workspace', async () => {
    await assert.rejects(
      () => runCommand('echo hi'),
      /Open a project folder first/
    )
  })

  it('rejects empty and oversized commands', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-term-'))
    await setWorkspaceRoot(dir)

    await assert.rejects(() => runCommand(''), /valid command/)
    await assert.rejects(
      () => runCommand('x'.repeat(2001)),
      /valid command/
    )
  })

  it('runs a command inside the workspace and captures output', async () => {
    const result = await runCommand('echo kryom-ok')

    assert.equal(result.exitCode, 0)
    assert.match(result.output, /kryom-ok/)
    assert.equal(result.timedOut, false)
  })

  it('kills whole process trees without throwing', () => {
    assert.equal(killProcessTree(null), false)
    assert.equal(killProcessTree(undefined), false)

    let killed = false
    const plain = { kill: () => { killed = true; return true } }

    assert.equal(killProcessTree(plain, { platform: 'linux' }), true)
    assert.equal(killed, true)

    const calls = []
    const windowsChild = {
      pid: 4242,
      kill: () => { throw new Error('should not be called') },
    }

    assert.equal(
      killProcessTree(windowsChild, {
        platform: 'win32',
        spawnSync: (cmd, args) => {
          calls.push([cmd, args])
          return { status: 0 }
        },
      }),
      true
    )
    assert.deepEqual(calls, [
      ['taskkill', ['/pid', '4242', '/T', '/F']],
    ])

    // A failed taskkill falls back to plain kill instead of throwing.
    let fallback = false

    assert.equal(
      killProcessTree(
        { pid: 1, kill: () => { fallback = true; return true } },
        {
          platform: 'win32',
          spawnSync: () => { throw new Error('taskkill missing') },
        }
      ),
      true
    )
    assert.equal(fallback, true)
  })

  it('attaches advisory warnings without blocking commands', async () => {
    const ok = await runCommand('echo hello')

    assert.deepEqual(ok.warnings, [])

    const flagged = await runCommand('echo rm -rf /tmp/x')

    assert.ok(flagged.warnings.length > 0)
    assert.equal(flagged.exitCode, 0)
  })

  it('lists and cancels running processes', async () => {
    const pending = runCommand('node -e "setTimeout(() => {}, 30000)"')

    assert.ok(listRunningProcesses().length >= 1)

    const cancelled = cancelRunningProcesses()

    assert.ok(cancelled.killed >= 1)

    const result = await pending

    assert.equal(result.exitCode, 1)
    assert.equal(listRunningProcesses().length, 0)
  })
})
