const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  API_VERSION,
  MEMBRANE_SPEC,
  ERROR_CODES,
  classifyMembraneError,
  checkApiCompatibility,
  membranePaths,
} = require('./api-contract.cjs')
const {
  install,
  enable,
  activate,
  deactivate,
  uninstall,
  runCommand,
  shutdownAll,
} = require('../extensions/lifecycle.cjs')
const {
  grantPermission,
} = require('../permissions/permission.service.cjs')
const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')

const EXAMPLE_DIR = path.join(__dirname, '..', '..', '..', 'examples', 'hello-command')

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-apicontract-'))
}

describe('api-contract', () => {
  it('versions the API and classifies errors into the taxonomy', () => {
    assert.equal(API_VERSION, 1)
    assert.ok(membranePaths().includes('workspace.readFile'))
    assert.ok(membranePaths().includes('ai.complete'))
    assert.equal(MEMBRANE_SPEC['workspace.readFile'].permission, 'workspace.read')
    assert.equal(MEMBRANE_SPEC['storage.set'].permission, null)

    assert.deepEqual(checkApiCompatibility(1), { apiVersion: 1, compatible: true })
    assert.throws(() => checkApiCompatibility(99), /Unsupported extension API/)

    assert.equal(classifyMembraneError('Permission denied: x'), 'PERMISSION_DENIED')
    assert.equal(classifyMembraneError('Step timed out after 5 ms.'), 'TIMEOUT')
    assert.equal(classifyMembraneError('Extension "a" is not active.'), 'NOT_ACTIVE')
    assert.equal(classifyMembraneError('Unknown command "x".'), 'UNKNOWN_COMMAND')
    assert.equal(classifyMembraneError('quota exceeded'), 'QUOTA_EXCEEDED')
    assert.equal(classifyMembraneError('Invalid args: x must be set'), 'INVALID_ARGS')
    assert.equal(classifyMembraneError('weird'), 'EXTENSION_FAULT')
    assert.ok(ERROR_CODES.includes('PERMISSION_DENIED'))
  })

  it('runs the packaged example extension end to end', async () => {
    const base = await tempBase()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-apiex-'))

    // Guaranteed worker teardown: without this, any assertion failure
    // above leaks the forked extension worker, whose live IPC channel
    // keeps the test process (and the whole suite) alive forever.
    try {
      await setWorkspaceRoot(root)

      const installed = await install(EXAMPLE_DIR, { baseDir: base })

      assert.equal(installed.id, 'kryom.hello-command')

      await enable('kryom.hello-command', { baseDir: base })
      await grantPermission('extension:kryom.hello-command', 'workspace.metadata', base)

      const activated = await activate('kryom.hello-command', { baseDir: base, hostVersion: '9.9.9' })

      assert.equal(activated.active, true)

      const first = await runCommand('kryom.hello-command', 'kryom.hello-command.say-hello', { name: 'Ada' })

      assert.equal(first.greeting, 'Hello, Ada!')
      assert.equal(first.invocations, 1)
      assert.ok(typeof first.project === 'string')

      const second = await runCommand('kryom.hello-command', 'kryom.hello-command.say-hello', {})

      assert.equal(second.invocations, 2)

      await deactivate('kryom.hello-command', { baseDir: base })
      await uninstall('kryom.hello-command', { baseDir: base })
    } finally {
      await shutdownAll().catch(() => undefined)
    }
  })
})
