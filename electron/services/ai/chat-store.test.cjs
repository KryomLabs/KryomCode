const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
  getWorkspaceRoot,
  closeWorkspace,
} = require('../workspace/workspace.service.cjs')
const {
  saveChat,
  restoreChat,
  sanitizeMessages,
  listChatSessions,
  createChatSession,
  switchChatSession,
  renameChatSession,
  deleteChatSession,
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

  it('lands an in-flight save in the project it was written for', async () => {
    const dirA = await openWorkspace()
    const rootA = getWorkspaceRoot()

    try {
      await saveChat([{ role: 'user', content: 'from A' }], { root: rootA })

      // Switch projects, then deliver the late save bound to A: it
      // must not land in B.
      const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-chat-'))
      await setWorkspaceRoot(dirB)

      const late = await saveChat(
        [
          { role: 'user', content: 'from A' },
          { role: 'assistant', content: 'late answer' },
        ],
        { root: rootA }
      )

      assert.deepEqual(late, { saved: true, messages: 2 })

      const storedA = JSON.parse(
        await fs.readFile(path.join(dirA, '.kryom', 'chat.json'), 'utf8')
      )

      assert.equal(storedA.messages.length, 2)
      await assert.rejects(
        fs.readFile(path.join(dirB, '.kryom', 'chat.json'), 'utf8'),
        /ENOENT/
      )
    } finally {
      await closeWorkspace()
    }
  })

  it('rejects saves bound to a twice-replaced project', async () => {
    const dirA = await openWorkspace()
    const rootA = getWorkspaceRoot()

    try {
      const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-chat-'))
      await setWorkspaceRoot(dirB)
      const dirC = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-chat-'))
      await setWorkspaceRoot(dirC)

      const stale = await saveChat([{ role: 'user', content: 'stale' }], {
        root: rootA,
      })

      assert.deepEqual(stale, {
        saved: false,
        reason: 'Project changed during save.',
      })
      await assert.rejects(
        fs.readFile(path.join(dirA, '.kryom', 'chat.json'), 'utf8'),
        /ENOENT/
      )
    } finally {
      await closeWorkspace()
    }
  })

  it('keeps the closed root for close-then-open switches', async () => {
    const dirA = await openWorkspace()
    const rootA = getWorkspaceRoot()

    await saveChat([{ role: 'user', content: 'before close' }], {
      root: rootA,
    })
    await closeWorkspace()

    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-chat-'))
    await setWorkspaceRoot(dirB)

    try {
      const late = await saveChat(
        [
          { role: 'user', content: 'before close' },
          { role: 'assistant', content: 'late answer' },
        ],
        { root: rootA }
      )

      assert.deepEqual(late, { saved: true, messages: 2 })

      const storedA = JSON.parse(
        await fs.readFile(path.join(dirA, '.kryom', 'chat.json'), 'utf8')
      )

      assert.equal(storedA.messages.length, 2)
      await assert.rejects(
        fs.readFile(path.join(dirB, '.kryom', 'chat.json'), 'utf8'),
        /ENOENT/
      )
    } finally {
      await closeWorkspace()
    }
  })
  it('manages named sessions with isolated histories', async () => {
    await openWorkspace()

    try {
      const first = await createChatSession('First chat')

      assert.ok(/^ch-[a-z0-9]+-[0-9a-f]{6}$/.test(first.id))
      assert.equal(first.title, 'First chat')

      await saveChat([{ role: 'user', content: 'in first' }])

      const second = await createChatSession('Second chat')
      await saveChat([{ role: 'user', content: 'in second' }])

      const listed = await listChatSessions()

      assert.equal(listed.activeId, second.id)
      assert.equal(listed.sessions.length, 3)
      assert.equal(listed.sessions[0].id, 'general')
      assert.deepEqual(
        listed.sessions.slice(1).map((entry) => entry.id).sort(),
        [first.id, second.id].sort()
      )

      const switched = await switchChatSession(first.id)

      assert.equal(switched.title, 'First chat')
      assert.deepEqual(switched.messages, [{ role: 'user', content: 'in first' }])

      const restored = await restoreChat()

      assert.deepEqual(restored.messages, [{ role: 'user', content: 'in first' }])

      const renamed = await renameChatSession(first.id, '  Renamed   chat  ')

      assert.equal(renamed.title, 'Renamed chat')

      const deleted = await deleteChatSession(second.id)

      assert.deepEqual(deleted, { id: second.id, deleted: true })

      const relisted = await listChatSessions()

      assert.deepEqual(
        relisted.sessions.map((entry) => entry.id),
        ['general', first.id]
      )
      assert.equal(relisted.activeId, first.id)
    } finally {
      await closeWorkspace()
    }
  })

  it('protects the general conversation and validates ids', async () => {
    await openWorkspace()

    try {
      await assert.rejects(() => switchChatSession('nope-missing'), /not found/)
      await assert.rejects(() => switchChatSession('Bad id!'), /Invalid chat session id/)
      await assert.rejects(() => renameChatSession('general', 'x'), /cannot be renamed/)
      await assert.rejects(() => deleteChatSession('general'), /cannot be deleted/)
      await assert.rejects(() => renameChatSession('nope-missing', 'x'), /not found/)
      await assert.rejects(() => deleteChatSession('nope-missing'), /not found/)
    } finally {
      await closeWorkspace()
    }
  })

  it('surfaces legacy history as the general session', async () => {
    const dir = await openWorkspace()

    try {
      await fs.mkdir(path.join(dir, '.kryom'), { recursive: true })
      await fs.writeFile(
        path.join(dir, '.kryom', 'chat.json'),
        JSON.stringify({
          version: 1,
          savedAt: '2026-01-01T00:00:00.000Z',
          messages: [{ role: 'user', content: 'legacy hello' }],
        }),
        'utf8'
      )

      const listed = await listChatSessions()

      assert.equal(listed.sessions.length, 1)
      assert.equal(listed.sessions[0].id, 'general')
      assert.equal(listed.sessions[0].messageCount, 1)

      const restored = await restoreChat()

      assert.equal(restored.restored, true)
      assert.deepEqual(restored.messages, [{ role: 'user', content: 'legacy hello' }])
    } finally {
      await closeWorkspace()
    }
  })
})
