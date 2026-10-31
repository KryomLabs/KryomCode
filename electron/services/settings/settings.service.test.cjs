const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  DEFAULTS,
  SUPPORTED_DEFAULT_MODELS,
  readSettings,
  updateSettings,
} = require('./settings.service.cjs')

async function makeBaseDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-settings-'))
}

describe('settings.service', () => {
  it('returns defaults when nothing is stored', async () => {
    const baseDir = await makeBaseDir()

    assert.deepEqual(await readSettings(baseDir), DEFAULTS)
    assert.equal(DEFAULTS.confirmAllCommands, false)
  })

  it('derives supported models from the registered Meta descriptor', () => {
    const {
      metaDescriptor,
    } = require('../ai/providers/meta-muse.provider.cjs')

    assert.deepEqual(
      SUPPORTED_DEFAULT_MODELS,
      metaDescriptor.models.map((model) => model.id)
    )
    assert.equal(
      DEFAULTS.defaultModel,
      metaDescriptor.models.find((model) => model.isDefault).id
    )
  })

  it('persists the confirm-all-commands preference', async () => {
    const baseDir = await makeBaseDir()

    const updated = await updateSettings({ confirmAllCommands: true }, baseDir)

    assert.equal(updated.confirmAllCommands, true)
    assert.deepEqual(await readSettings(baseDir), updated)

    await assert.rejects(
      () => updateSettings({ confirmAllCommands: 'yes' }, baseDir),
      /confirmAllCommands/
    )

    await fs.writeFile(
      path.join(baseDir, 'kryomcode-settings.json'),
      JSON.stringify({ confirmAllCommands: 'yes' })
    )

    assert.equal(
      (await readSettings(baseDir)).confirmAllCommands,
      DEFAULTS.confirmAllCommands
    )
  })

  it('persists validated updates', async () => {
    const baseDir = await makeBaseDir()

    const updated = await updateSettings(
      { defaultModel: 'muse-wonder-1.0', aiContextEnabled: false },
      baseDir
    )

    assert.equal(updated.defaultModel, 'muse-wonder-1.0')
    assert.equal(updated.aiContextEnabled, false)
    assert.deepEqual(await readSettings(baseDir), updated)
  })

  it('rejects invalid values and recovers from corrupt files', async () => {
    const baseDir = await makeBaseDir()

    await assert.rejects(
      () => updateSettings({ defaultModel: 'gpt-4' }, baseDir),
      /defaultModel/
    )
    await assert.rejects(
      () => updateSettings({ aiContextEnabled: 'yes' }, baseDir),
      /aiContextEnabled/
    )

    await fs.writeFile(
      path.join(baseDir, 'kryomcode-settings.json'),
      'not json'
    )

    assert.deepEqual(await readSettings(baseDir), DEFAULTS)
  })

  it('persists panel dimensions', async () => {
    const baseDir = await makeBaseDir()

    const updated = await updateSettings(
      {
        panelLeftWidth: 300,
        panelRightWidth: 400,
        panelBottomHeight: 200,
      },
      baseDir
    )

    assert.equal(updated.panelLeftWidth, 300)
    assert.equal(updated.panelRightWidth, 400)
    assert.equal(updated.panelBottomHeight, 200)
    assert.deepEqual(await readSettings(baseDir), updated)
  })

  it('rejects invalid panel dimensions', async () => {
    const baseDir = await makeBaseDir()

    await assert.rejects(
      () => updateSettings({ panelLeftWidth: 'wide' }, baseDir),
      /panelLeftWidth/
    )
    await assert.rejects(
      () => updateSettings({ panelRightWidth: Number.NaN }, baseDir),
      /panelRightWidth/
    )
    await assert.rejects(
      () => updateSettings({ panelBottomHeight: -5 }, baseDir),
      /panelBottomHeight/
    )
    await assert.rejects(
      () => updateSettings({ panelLeftWidth: 99999 }, baseDir),
      /panelLeftWidth/
    )
  })

  it('fills and clamps panel dimensions from older files', async () => {
    const baseDir = await makeBaseDir()

    await fs.writeFile(
      path.join(baseDir, 'kryomcode-settings.json'),
      JSON.stringify({
        defaultModel: 'muse-wonder-1.0',
        aiContextEnabled: false,
        panelLeftWidth: 99999,
        panelBottomHeight: -10,
      })
    )

    const settings = await readSettings(baseDir)

    assert.equal(settings.defaultModel, 'muse-wonder-1.0')
    assert.equal(settings.aiContextEnabled, false)
    assert.equal(settings.panelLeftWidth, 2000)
    assert.equal(settings.panelRightWidth, DEFAULTS.panelRightWidth)
    assert.equal(settings.panelBottomHeight, 80)
  })
})
