// Extension process isolation: real fork round-trips plus deterministic
// host-behavior tests over a stub transport. No Electron needed — the
// worker takes explicit baseDir/workspaceRoot on every path.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  ExtensionHost,
  spawnHost,
  selectLauncher,
} = require('./extension-host.cjs')

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-exthost-'))
}

async function fixtureSource(code) {
  const dir = await tempBase()

  await fs.writeFile(
    path.join(dir, 'main.js'),
    code ||
      `module.exports.activate = (kryom) => {
        kryom.commands.registerCommand('acme.echo.run', (args) => ({ echoed: args || {} }))
      }`
  )

  return dir
}

function manifestFor(id = 'acme.echo') {
  return {
    manifestVersion: 1,
    id,
    name: 'Echo',
    description: 'host probe',
    version: '1.0.0',
    publisher: 'acme',
    main: 'main.js',
    apiVersion: 1,
    engines: null,
    permissions: [],
    optionalPermissions: [],
    contributes: { commands: [{ id: `${id}.run`, title: 'Run' }] },
    dependencies: {},
  }
}

function stubTransport() {
  const stub = {
    launcher: 'stub',
    sent: [],
    kills: 0,
    onMessageFn: null,
    onExitFn: null,
    send: (message) => {
      stub.sent.push(message)
    },
    onMessage: (fn) => {
      stub.onMessageFn = fn
    },
    onExit: (fn) => {
      stub.onExitFn = fn
    },
    kill: () => {
      stub.kills += 1

      return true
    },
    emit: (message) => stub.onMessageFn(message),
    exit: (code) => stub.onExitFn(code),
  }

  return stub
}

describe('extension-host', () => {
  it('selects fork outside Electron and honors overrides', () => {
    assert.equal(selectLauncher({ launcher: 'fork' }), 'fork')
    assert.equal(selectLauncher({ launcher: 'utility' }), 'utility')
    // Plain Node has no electron module: default is fork.
    assert.equal(selectLauncher({}), 'fork')
  })

  it('activates, invokes, and shuts down a real forked worker', async () => {
    const base = await tempBase()
    const source = await fixtureSource()
    const host = spawnHost('acme.echo', { launcher: 'fork' })

    try {
      const outcome = await host.activate({
        entryPath: path.join(source, 'main.js'),
        manifest: manifestFor(),
        workspaceRoot: null,
        baseDir: base,
      })

      assert.equal(outcome.ok, true)
      assert.deepEqual(outcome.commands, [{ id: 'acme.echo.run', title: 'Run' }])
      assert.equal(host.status().alive, true)
      assert.equal(host.status().launcher, 'fork')

      const value = await host.invoke('acme.echo.run', { hello: 'world' })

      assert.deepEqual(value, { echoed: { hello: 'world' } })

      await assert.rejects(
        () => host.invoke('acme.echo.nope', {}),
        /Unknown command/
      )

      // A failed command does not kill the host.
      assert.equal(host.status().alive, true)
      assert.deepEqual(await host.invoke('acme.echo.run', {}), { echoed: {} })
    } finally {
      await host.shutdown()
    }

    assert.equal(host.status().alive, false)
  })

  it('survives a worker that exits mid-command', async () => {
    const base = await tempBase()
    const source = await fixtureSource(
      `module.exports.activate = (kryom) => {
        kryom.commands.registerCommand('acme.bomb.run', () => { process.exit(3) })
      }`
    )
    const host = spawnHost('acme.bomb', { launcher: 'fork' })

    try {
      const outcome = await host.activate({
        entryPath: path.join(source, 'main.js'),
        manifest: manifestFor('acme.bomb'),
        workspaceRoot: null,
        baseDir: base,
      })

      assert.equal(outcome.ok, true)

      // process is not defined in the vm: the command fails cleanly
      // inside the sandbox instead of killing anything.
      await assert.rejects(() => host.invoke('acme.bomb.run', {}), /process/)
      assert.equal(host.status().alive, true)
    } finally {
      await host.shutdown()
    }
  })

  it('kills the host on request timeout', async () => {
    const stub = stubTransport()
    const host = new ExtensionHost('acme.hang', stub, { invokeTimeoutMs: 30 })

    await assert.rejects(() => host.invoke('acme.hang.run', {}), /timed out/)
    assert.equal(stub.kills, 1)
    assert.equal(host.status().alive, false)

    // Later calls fail fast with the recorded reason.
    await assert.rejects(() => host.invoke('acme.hang.run', {}), /timed out/)
  })

  it('kills the host when RSS exceeds the cap', async () => {
    const stub = stubTransport()
    const host = new ExtensionHost('acme.hog', stub, { memoryCapBytes: 1024 })

    stub.emit({ kind: 'heartbeat', rss: 512, heapUsed: 100 })
    assert.equal(host.status().alive, true)
    assert.equal(host.status().rss, 512)

    stub.emit({ kind: 'heartbeat', rss: 2048, heapUsed: 100 })
    assert.equal(host.status().alive, false)
    assert.match(host.status().deathReason, /memory cap/)
    assert.equal(stub.kills, 1)
  })

  it('kills the host on protocol violations and oversized results', async () => {
    const stub = stubTransport()
    const host = new ExtensionHost('acme.wild', stub, {})

    stub.emit({ kind: 'bogus' })
    assert.equal(host.status().alive, false)
    assert.match(host.status().deathReason, /Protocol violation/)

    const stub2 = stubTransport()
    const host2 = new ExtensionHost('acme.big', stub2, {})
    const pending = host2.invoke('acme.big.run', {})

    stub2.emit({ kind: 'result', seq: 1, ok: true, value: { blob: 'x'.repeat(2 * 1024 * 1024) } })

    await assert.rejects(() => pending, /Protocol violation|exceeds/)
    assert.equal(host2.status().alive, false)
  })

  it('reports unexpected exits and ignores late results', async () => {
    const stub = stubTransport()
    const host = new ExtensionHost('acme.gone', stub, {})
    const pending = host.invoke('acme.gone.run', {})

    stub.exit(1)

    await assert.rejects(() => pending, /exited unexpectedly/)
    assert.equal(host.status().alive, false)

    // A late result for an unknown seq is dropped, not thrown.
    stub.emit({ kind: 'result', seq: 99, ok: true, value: 1 })
  })
})
