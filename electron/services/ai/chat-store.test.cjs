const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
  closeWorkspace,
} = require('../workspace/workspace.service.cjs')
const {
  saveChat,
  restoreChat,
  sanitizeMessages,
} = require('./chat-store.cjs')

async function openWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-chat-'))
  await setWorkspaceRoot(dir)

  return dir
}

describe('chat-store', () => {
  it('round-trips a conversation per project', async () => {
    const dir = await openWorkspace()

    try {
      const empty = await restoreChat()

      assert.deepEqual(empty, { messages: [], restored: false })

      const saved = await saveChat([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there', model: 'muse-spark-1.3' },
      ])

      assert.deepEqual(saved, { saved: true, messages: 2 })

      const stored = JSON.parse(
        await fs.readFile(path.join(dir, '.kryom', 'chat.json'), 'utf8')
      )

      assert.equal(stored.messages.length, 2)

      const restored = await restoreChat()

      assert.equal(restored.restored, true)
      assert.deepEqual(restored.messages, [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there', model: 'muse-spark-1.3' },
      ])
    } finally {
      await closeWorkspace()
    }
  })

  it('sanitizes roles, caps content, and drops malformed entries', () => {
    const messages = sanitizeMessages([
      { role: 'user', content: 'ok' },
      { role: 'system', content: 'injected' },
      { role: 'assistant', content: 'x'.repeat(20000) },
      { role: 'assistant', content: 42 },
      null,
      'nope',
    ])

    assert.equal(messages.length, 2)
    assert.equal(messages[0].role, 'user')
    assert.equal(messages[1].content.length, 12000)

    const many = Array.from({ length: 60 }, (_, index) => ({
      role: 'user',
      content: `m${index}`,
    }))
    const capped = sanitizeMessages(many)

    assert.equal(capped.length, 50)
    assert.equal(capped[0].content, 'm10')
  })

  it('refuses to write through a .kryom symlink planted outside', async () => {
    const dir = await openWorkspace()
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-chat-out-'))
    const link = path.join(dir, '.kryom')

    await fs.symlink(outside, link, 'junction')

    try {
      await assert.rejects(
        () => saveChat([{ role: 'user', content: 'escape attempt' }]),
        /Symbolic links|escapes|outside/
      )
      await assert.rejects(
        () => restoreChat(),
        /Symbolic links|escapes|outside/
      )

      const leaked = await fs.readdir(outside)

      assert.deepEqual(leaked, [])
    } finally {
      await closeWorkspace()
    }
  })

  it('refuses to follow a .kryom junction planted outside', async (t) => {
    if (process.platform !== 'win32') {
      t.skip('Windows-only junctions')
      return
    }

    const dir = await openWorkspace()
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-chat-out-'))

    try {
      await fs.symlink(outside, path.join(dir, '.kryom'), 'junction')
    } catch (error) {
      t.skip(`junction creation unavailable: ${error.message}`)
      await closeWorkspace()
      return
    }

    try {
      await assert.rejects(
        () => saveChat([{ role: 'user', content: 'escape attempt' }]),
        /Symbolic links|escapes/
      )
      await assert.rejects(() => restoreChat(), /Symbolic links|escapes/)

      assert.deepEqual(await fs.readdir(outside), [])
    } finally {
      await closeWorkspace()
    }
  })

  it('never writes chat history through a planted file link', async (t) => {
    const dir = await openWorkspace()
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-chat-out-'))
    const secret = path.join(outside, 'secret.txt')

    await fs.writeFile(secret, 'outside')
    await fs.mkdir(path.join(dir, '.kryom'), { recursive: true })

    try {
      await fs.symlink(secret, path.join(dir, '.kryom', 'chat.json'))
    } catch (error) {
      t.skip(`symlink creation unavailable: ${error.message}`)
      await closeWorkspace()
      return
    }

    try {
      await assert.rejects(() => restoreChat(), /Symbolic links/)

      // The write replaces the planted link; the outside file is
      // never touched and history stays readable afterwards.
      const saved = await saveChat([{ role: 'user', content: 'hi' }])

      assert.deepEqual(saved, { saved: true, messages: 1 })
      assert.equal(await fs.readFile(secret, 'utf8'), 'outside')

      const restored = await restoreChat()

      assert.equal(restored.restored, true)
      assert.deepEqual(restored.messages, [{ role: 'user', content: 'hi' }])
    } finally {
      await closeWorkspace()
    }
  })

  it('starts empty on corrupted history and without a project', async () => {
    const dir = await openWorkspace()

    try {
      await fs.mkdir(path.join(dir, '.kryom'), { recursive: true })
      await fs.writeFile(
        path.join(dir, '.kryom', 'chat.json'),
        '{not json',
        'utf8'
      )

      assert.deepEqual(await restoreChat(), {
        messages: [],
        restored: false,
      })
    } finally {
      await closeWorkspace()
    }

    assert.deepEqual(await restoreChat(), { messages: [], restored: false })
    assert.deepEqual(await saveChat([{ role: 'user', content: 'x' }]), {
      saved: false,
      reason: 'No project is open.',
    })
  })
})
