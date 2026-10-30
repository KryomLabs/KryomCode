const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  grantPermission,
} = require('../permissions/permission.service.cjs')
const {
  activateExtension,
  deactivateExtension,
  executeCommand,
  isExtensionActive,
  listActiveCommands,
} = require('./runtime.cjs')
const {
  validateManifest,
} = require('./manifest.cjs')

function manifestFor(id) {
  return validateManifest({
    manifestVersion: 1,
    id,
    name: 'Test',
    description: 'test',
    version: '1.0.0',
    publisher: 'acme',
    main: 'main.js',
    apiVersion: 1,
    permissions: [],
    contributes: { commands: [{ id: `${id}.run`, title: 'Run' }] },
  })
}

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-extrt-'))
}

async function makeExtension(base, id, code) {
  const dir = path.join(base, id.replace('.', '-'))

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'main.js'), code)

  return { path: dir }
}

const ACTIVE = []

afterEach(async () => {
  while (ACTIVE.length > 0) {
    await deactivateExtension(ACTIVE.pop()).catch(() => undefined)
  }
})

describe('extension-runtime', () => {
  it('activates an extension and executes its command', async () => {
    const base = await tempBase()
    const id = 'acme.hello'
    const entry = await makeExtension(
      base,
      id,
      `module.exports.activate = (kryom) => {
        kryom.commands.registerCommand('${id}.run', (args) => ({ greeting: 'hello ' + (args.name || 'world') }))
      }`
    )

    const activated = await activateExtension(entry, manifestFor(id), { baseDir: base })

    assert.equal(activated.ok, true)
    assert.deepEqual(activated.commands, [{ id: `${id}.run`, title: 'Run' }])
    ACTIVE.push(id)

    assert.equal(isExtensionActive(id), true)
    assert.deepEqual(await executeCommand(id, `${id}.run`, { name: 'kryom' }), {
      greeting: 'hello kryom',
    })

    const commands = listActiveCommands()

    assert.ok(commands.some((entry) => entry.id === `${id}.run`))
  })

  it('denies ungranted membrane capabilities without crashing', async () => {
    const base = await tempBase()
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-extws-'))
    await fs.writeFile(path.join(workspace, 'a.txt'), 'secret\n')
    await setWorkspaceRoot(workspace)

    const id = 'acme.reader'
    const entry = await makeExtension(
      base,
      id,
      `module.exports.activate = (kryom) => {
        kryom.commands.registerCommand('${id}.run', async () => kryom.workspace.readFile('a.txt'))
      }`
    )

    const activated = await activateExtension(entry, manifestFor(id), { baseDir: base })

    assert.equal(activated.ok, true)
    ACTIVE.push(id)

    await assert.rejects(
      () => executeCommand(id, `${id}.run`),
      /Permission denied.*workspace\.read/
    )

    await grantPermission(`extension:${id}`, 'workspace.read', base)

    const result = await executeCommand(id, `${id}.run`)

    assert.equal(result.content, 'secret\n')
  })

  it('rejects Node.js access inside the sandbox', async () => {
    const base = await tempBase()
    const id = 'acme.evil'
    const entry = await makeExtension(
      base,
      id,
      `module.exports.activate = (kryom) => {
        kryom.commands.registerCommand('${id}.run', () => process.exit(1))
      }`
    )

    const activated = await activateExtension(entry, manifestFor(id), { baseDir: base })

    assert.equal(activated.ok, true)
    ACTIVE.push(id)

    await assert.rejects(() => executeCommand(id, `${id}.run`), /process/)
    assert.equal(isExtensionActive(id), true)
  })

  it('blocks constructor-chain escapes from the membrane', async () => {
    const base = await tempBase()
    const id = 'acme.escape'
    const entry = await makeExtension(
      base,
      id,
      `module.exports.activate = (kryom) => {
        kryom.commands.registerCommand('${id}.run', () => {
          const fn = kryom.constructor.constructor
          return fn('return 1')()
        })
      }`
    )

    const activated = await activateExtension(entry, manifestFor(id), { baseDir: base })

    assert.equal(activated.ok, true)
    ACTIVE.push(id)

    await assert.rejects(() => executeCommand(id, `${id}.run`), /failed/)
  })

  it('times out runaway handlers', async () => {
    const base = await tempBase()
    const id = 'acme.loopy'
    const entry = await makeExtension(
      base,
      id,
      `module.exports.activate = (kryom) => {
        kryom.commands.registerCommand('${id}.run', () => { while (true) {} })
      }`
    )

    const activated = await activateExtension(entry, manifestFor(id), { baseDir: base })

    assert.equal(activated.ok, true)
    ACTIVE.push(id)

    await assert.rejects(
      () => executeCommand(id, `${id}.run`, {}, { timeoutMs: 100 }),
      /timed out/
    )
  })

  it('reports activation failures structurally and deactivates cleanly', async () => {
    const base = await tempBase()
    const id = 'acme.broken'
    const entry = await makeExtension(base, id, `throw new Error('boom at load')`)

    const activated = await activateExtension(entry, manifestFor(id), { baseDir: base })

    assert.equal(activated.ok, false)
    assert.ok(activated.error.includes('boom'))
    assert.equal(isExtensionActive(id), false)

    const idle = await deactivateExtension(id)

    assert.equal(idle.deactivated, false)
  })

  it('validates commands, arguments, and activity', async () => {
    const base = await tempBase()

    await assert.rejects(() => executeCommand('acme.ghost', 'x'), /not active/)

    const id = 'acme.strict'
    const entry = await makeExtension(
      base,
      id,
      `module.exports.activate = (kryom) => {
        kryom.commands.registerCommand('${id}.run', (args) => args)
      }`
    )

    await activateExtension(entry, manifestFor(id), { baseDir: base })
    ACTIVE.push(id)

    await assert.rejects(() => executeCommand(id, 'acme.nope'), /Unknown command/)
    await assert.rejects(
      () => executeCommand(id, `${id}.run`, { blob: 'x'.repeat(70000) }),
      /exceeds/
    )

    const done = await deactivateExtension(id)

    assert.equal(done.deactivated, true)
    assert.equal(isExtensionActive(id), false)
  })

  it('scopes storage per extension with validation', async () => {
    const base = await tempBase()
    const id = 'acme.stored'
    const entry = await makeExtension(
      base,
      id,
      `module.exports.activate = (kryom) => {
        kryom.commands.registerCommand('${id}.run', async () => {
          await kryom.storage.set('k', { v: 1 })
          return kryom.storage.get('k')
        })
      }`
    )

    await activateExtension(entry, manifestFor(id), { baseDir: base })
    ACTIVE.push(id)

    assert.deepEqual(await executeCommand(id, `${id}.run`), { v: 1 })

    const stored = JSON.parse(
      await fs.readFile(
        path.join(base, 'kryomcode-extensions', 'storage', id, 'store.json'),
        'utf8'
      )
    )

    assert.deepEqual(stored, { k: { v: 1 } })
  })
})
