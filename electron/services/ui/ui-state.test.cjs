const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  MAX_RECENT,
  sanitizeState,
  readUIState,
  writeUIState,
  addRecent,
  clearRecent,
  removeRecent,
  setAutoSave,
} = require('./ui-state.service.cjs')

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

describe('ui-state service', () => {
  it('returns defaults when no state file exists', async () => {
    const state = await readUIState(await tempDir('kryom-ui-'))

    assert.equal(state.autoSave, false)
    assert.deepEqual(state.recent, [])
  })

  it('sanitizes malformed state without throwing', () => {
    assert.deepEqual(sanitizeState(null), { autoSave: false, recent: [] })
    assert.deepEqual(sanitizeState([]), { autoSave: false, recent: [] })
    assert.deepEqual(sanitizeState({ autoSave: 'yes', recent: 'x' }), {
      autoSave: false,
      recent: [],
    })
  })

  it('dedupes, trims, and caps the recent list', () => {
    const state = sanitizeState({
      autoSave: true,
      recent: ['  B  ', 'a', 'A', 42, null, 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    })

    assert.equal(state.autoSave, true)
    assert.ok(state.recent.length <= MAX_RECENT)
    assert.deepEqual(state.recent.slice(0, 3), ['B', 'a', 'c'])
  })

  it('persists auto-save across reads', async () => {
    const dir = await tempDir('kryom-ui-')

    await setAutoSave(true, dir)
    assert.equal((await readUIState(dir)).autoSave, true)

    await setAutoSave(false, dir)
    assert.equal((await readUIState(dir)).autoSave, false)

    await assert.rejects(() => setAutoSave('yes', dir), /Invalid autoSave/)
  })

  it('adds recent entries most-recent-first without duplicates', async () => {
    const dir = await tempDir('kryom-ui-')

    await addRecent('C:\\proj\\a', dir)
    await addRecent('C:\\proj\\b', dir)
    await addRecent('C:\\proj\\a', dir)

    const state = await readUIState(dir)

    assert.deepEqual(state.recent, ['C:\\proj\\a', 'C:\\proj\\b'])

    await assert.rejects(() => addRecent('', dir), /Invalid recent/)
  })

  it('removes one recent entry case-insensitively', async () => {
    const dir = await tempDir('kryom-ui-')

    await writeUIState(
      { autoSave: false, recent: ['C:\\proj\\a', 'C:\\proj\\b'] },
      dir
    )

    const pruned = await removeRecent('c:\\PROJ\\a', dir)

    assert.deepEqual(pruned.recent, ['C:\\proj\\b'])
    assert.deepEqual((await readUIState(dir)).recent, ['C:\\proj\\b'])

    const unchanged = await removeRecent('C:\\proj\\missing', dir)

    assert.deepEqual(unchanged.recent, ['C:\\proj\\b'])

    await assert.rejects(() => removeRecent('', dir), /Invalid recent/)
  })

  it('clears the recent list but keeps auto-save', async () => {
    const dir = await tempDir('kryom-ui-')

    await writeUIState({ autoSave: true, recent: ['C:\\proj\\a'] }, dir)
    const cleared = await clearRecent(dir)

    assert.deepEqual(cleared.recent, [])
    assert.equal(cleared.autoSave, true)
  })
})
