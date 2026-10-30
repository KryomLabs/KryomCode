// Hello Command — the KryomCode sample extension.
//
// Runs inside the extension sandbox: no require/process/fs, only
// the versioned `kryom` membrane (see sdk/kryom.d.ts). Types for
// editors via JSDoc:
//
// @param {import('../../sdk/kryom').KryomExtensionAPI} kryom

function activate(kryom) {
  kryom.log(`hello-command ${kryom.version} activated for ${kryom.extensionId}`)

  kryom.commands.registerCommand('kryom.hello-command.say-hello', async (args) => {
    const name = args && typeof args.name === 'string' && args.name ? args.name : 'world'
    const metadata = await kryom.workspace.getMetadata()
    const seen = (await kryom.storage.get('count')) || 0

    await kryom.storage.set('count', seen + 1)

    return {
      greeting: `Hello, ${name}!`,
      project: metadata.open ? metadata.name : null,
      invocations: seen + 1,
    }
  })
}

function deactivate() {
  // Nothing to clean up.
}

module.exports = { activate, deactivate }
