// Memory store tests (Level 3A.1): validation, persistence,
// staleness, isolation, traversal resistance, malformed storage,
// deletion, and interrupted-write recovery. No network, no Meta
// calls; git-backed commit checks skip without a git binary.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  writeStorageFile,
  readStorageFile,
} = require('../../security/storage-path.cjs')
const {
  saveChat,
} = require('../ai/chat-store.cjs')
const {
  createSession,
  readSession,
  writeSession,
} = require('../research/session-store.cjs')
const {
  runGit,
} = require('../git/git.service.cjs')
const {
  MEMORY_SEGMENTS,
  TYPES,
  newMemoryId,
  assertMemoryId,
  sanitizeRecord,
  listMemories,
  getMemory,
  createMemory,
  updateMemory,
  deleteMemory,
  deleteAllMemories,
  buildExportDocument,
  exportMemoriesToFile,
} = require('./memory.store.cjs')

function hasGit() {
  try {
    return spawnSync('git', ['--version']).status === 0
  } catch {
    return false
  }
}

const GIT_AVAILABLE = hasGit()

async function openWorkspace(prefix = 'kryom-memory-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))

  // Return the canonical root the workspace actually runs under: the
  // raw temp path can carry symlinked ancestors (/var on macOS) that
  // never string-match the resolved root in identity checks.
  return setWorkspaceRoot(root)
}

async function writeSourceFile(root, name, content) {
  const file = path.join(root, name)

  await fs.writeFile(file, content)

  return file
}

function validInput(overrides = {}) {
  return { type: 'fact', content: 'The sky is blue.', ...overrides }
}

describe('memory.store', () => {
  it('exposes stable ids and validated record types', () => {
    assert.deepEqual([...TYPES], ['decision', 'convention', 'fact'])

    const id = newMemoryId()

    assert.match(id, /^mem-[a-z0-9-]{1,64}$/)
    assert.equal(assertMemoryId(id), id)
    assert.throws(() => assertMemoryId('../evil'), /Invalid memory id/)
    assert.throws(() => assertMemoryId('mem-ok/../x'), /Invalid memory id/)
  })

  it('rejects invalid record input', async () => {
    await openWorkspace()

    await assert.rejects(() => createMemory(null), /Invalid memory record/)
    await assert.rejects(
      () => createMemory(validInput({ type: 'opinion' })),
      /Invalid memory type/
    )
    await assert.rejects(
      () => createMemory(validInput({ content: '   ' })),
      /Invalid memory content/
    )
    await assert.rejects(
      () => createMemory(validInput({ content: 'x'.repeat(20001) })),
      /Invalid memory content/
    )
    await assert.rejects(
      () => createMemory(validInput({ title: 'x'.repeat(201) })),
      /Invalid memory title/
    )
    await assert.rejects(
      () => createMemory(validInput({ sources: 'chat' })),
      /Invalid memory sources/
    )
    await assert.rejects(
      () =>
        createMemory(
          validInput({ sources: new Array(21).fill({ kind: 'chat' }) })
        ),
      /at most 20/
    )
  })

  it('creates, reads, updates, and deletes records', async () => {
    const root = await openWorkspace()

    await writeSourceFile(root, 'notes.txt', 'v1\n')

    const created = await createMemory(
      validInput({
        type: 'decision',
        title: 'Use tabs',
        content: 'We use tabs for indentation.',
        sources: [{ kind: 'file', path: 'notes.txt' }],
      })
    )

    assert.equal(created.type, 'decision')
    assert.equal(created.title, 'Use tabs')
    assert.ok(created.createdAt)
    assert.equal(created.updatedAt, created.createdAt)
    assert.equal(created.stale, false)
    assert.deepEqual(created.staleReasons, [])
    assert.equal(created.sources.length, 1)
    assert.equal(created.sources[0].kind, 'file')
    assert.equal(created.sources[0].path, 'notes.txt')
    assert.match(created.sources[0].digest, /^[0-9a-f]{64}$/)
    assert.equal(created.sources[0].status, 'current')

    // Renderer-supplied digests are never trusted: capture recomputes.
    const fetched = await getMemory(created.id)

    assert.equal(fetched.content, 'We use tabs for indentation.')

    const updated = await updateMemory(created.id, {
      content: 'We use two spaces.',
      title: null,
      sources: [],
    })

    assert.equal(updated.content, 'We use two spaces.')
    assert.equal(updated.title, null)
    assert.deepEqual(updated.sources, [])
    assert.ok(updated.updatedAt >= updated.createdAt)

    await assert.rejects(
      () => updateMemory(created.id, { type: 'hunch' }),
      /Invalid memory type/
    )

    const { deleted } = await deleteMemory(created.id)

    assert.equal(deleted, true)
    await assert.rejects(() => getMemory(created.id), /Memory not found/)
    await assert.rejects(
      () => deleteMemory(created.id),
      /Memory not found/
    )
  })

  it('normalizes absolute source paths to workspace-relative', async () => {
    const root = await openWorkspace()

    const file = await writeSourceFile(root, 'deep.txt', 'deep\n')
    const created = await createMemory(
      validInput({ sources: [{ kind: 'file', path: file }] })
    )

    assert.equal(created.sources[0].path, 'deep.txt')
  })

  it('rejects file sources outside the project', async () => {
    const root = await openWorkspace()
    const outside = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-memory-out-')),
      'secret.txt'
    )

    await fs.writeFile(outside, 'nope\n')

    await assert.rejects(
      () => createMemory(validInput({ sources: [{ kind: 'file', path: outside }] })),
      /outside|escapes/i
    )
    await assert.rejects(
      () =>
        createMemory(validInput({ sources: [{ kind: 'file', path: '../escape.txt' }] })),
      /outside|does not exist/i
    )
    await assert.rejects(
      () =>
        createMemory(validInput({ sources: [{ kind: 'file', path: 'missing.txt' }] })),
      /does not exist/
    )
    assert.ok(root)
  })

  it('marks records stale when a source file changes or vanishes', async () => {
    const root = await openWorkspace()

    await writeSourceFile(root, 'spec.txt', 'v1\n')

    const created = await createMemory(
      validInput({ sources: [{ kind: 'file', path: 'spec.txt' }] })
    )

    assert.equal((await getMemory(created.id)).stale, false)

    await writeSourceFile(root, 'spec.txt', 'v2\n')

    const changed = await getMemory(created.id)

    assert.equal(changed.stale, true)
    assert.match(changed.staleReasons.join(' '), /changed since it was recorded/)
    assert.equal(changed.sources[0].status, 'stale')

    await fs.unlink(path.join(root, 'spec.txt'))

    const removed = await getMemory(created.id)

    assert.equal(removed.stale, true)
    assert.match(removed.staleReasons.join(' '), /was removed/)
  })

  it('tracks chat history sources without trusting caller digests', async () => {
    const root = await openWorkspace()

    await assert.rejects(
      () => createMemory(validInput({ sources: [{ kind: 'chat' }] })),
      /No chat history/
    )

    await saveChat([{ role: 'user', content: 'hi' }], { root })

    const created = await createMemory(
      validInput({ sources: [{ kind: 'chat', digest: '0'.repeat(64) }] })
    )

    assert.equal(created.sources[0].kind, 'chat')
    assert.notEqual(created.sources[0].digest, '0'.repeat(64))
    assert.equal((await getMemory(created.id)).stale, false)

    await saveChat(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      { root }
    )

    const changed = await getMemory(created.id)

    assert.equal(changed.stale, true)
    assert.match(changed.staleReasons.join(' '), /Chat history changed/)

    await fs.unlink(path.join(root, '.kryom', 'chat.json'))

    const cleared = await getMemory(created.id)

    assert.equal(cleared.stale, true)
    assert.match(cleared.staleReasons.join(' '), /cleared/)
  })

  it('tracks research brief versions as provenance', async () => {
    await openWorkspace()

    const session = await createSession('memory research objective')
    const created = await createMemory(
      validInput({ sources: [{ kind: 'research', sessionId: session.id }] })
    )

    assert.equal(created.sources[0].briefVersion, 0)
    assert.equal((await getMemory(created.id)).stale, false)

    const loaded = await readSession(session.id)

    loaded.brief.version = 1
    await writeSession(loaded)

    const bumped = await getMemory(created.id)

    assert.equal(bumped.stale, true)
    assert.match(bumped.staleReasons.join(' '), /superseded by v1/)

    await assert.rejects(
      () =>
        createMemory(
          validInput({ sources: [{ kind: 'research', sessionId: 'nope!!' }] })
        ),
      /Invalid research session id/
    )
    await assert.rejects(
      () =>
        createMemory(
          validInput({ sources: [{ kind: 'research', sessionId: 'missing-session' }] })
        ),
      /not found|Invalid research session/i
    )
  })

  it('verifies commit sources against the project repository', { skip: !GIT_AVAILABLE }, async () => {
    const root = await openWorkspace()

    await runGit(['init'])
    await runGit(['config', 'user.email', 'test@example.com'])
    await runGit(['config', 'user.name', 'Test'])
    await writeSourceFile(root, 'a.txt', 'one\n')
    await runGit(['add', 'a.txt'])
    await runGit(['commit', '-m', 'first'])

    const head = (await runGit(['rev-parse', 'HEAD'])).stdout.trim()
    const created = await createMemory(
      validInput({ sources: [{ kind: 'commit', sha: head }] })
    )

    assert.equal(created.sources[0].sha, head.toLowerCase())
    assert.equal((await getMemory(created.id)).stale, false)

    await assert.rejects(
      () =>
        createMemory(validInput({ sources: [{ kind: 'commit', sha: 'short' }] })),
      /40-character SHA/
    )
    await assert.rejects(
      () =>
        createMemory(
          validInput({ sources: [{ kind: 'commit', sha: '0'.repeat(40) }] })
        ),
      /was not found/
    )
  })

  it('reports commit sources as unverified without git', { skip: !GIT_AVAILABLE }, async () => {
    const root = await openWorkspace()

    await runGit(['init'])
    await runGit(['config', 'user.email', 'test@example.com'])
    await runGit(['config', 'user.name', 'Test'])
    await writeSourceFile(root, 'a.txt', 'one\n')
    await runGit(['add', 'a.txt'])
    await runGit(['commit', '-m', 'first'])

    const head = (await runGit(['rev-parse', 'HEAD'])).stdout.trim()
    const created = await createMemory(
      validInput({ sources: [{ kind: 'commit', sha: head }] })
    )

    const emptyBin = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-nogit-'))
    const savedPath = process.env.PATH

    process.env.PATH = emptyBin

    try {
      const checked = await getMemory(created.id)

      assert.equal(checked.stale, false)
      assert.equal(checked.sources[0].status, 'unverified')
      assert.match(checked.sources[0].reason, /Git is not installed/)

      await assert.rejects(
        () =>
          createMemory(validInput({ sources: [{ kind: 'commit', sha: head }] })),
        /without Git installed/
      )
    } finally {
      process.env.PATH = savedPath
    }

    assert.ok(root)
  })

  it('isolates records per project', async () => {
    const rootA = await openWorkspace('kryom-memory-a-')
    const created = await createMemory(validInput({ content: 'project A' }))

    const rootB = await openWorkspace('kryom-memory-b-')
    const listed = await listMemories()

    assert.deepEqual(listed.records, [])
    assert.deepEqual(listed.corrupt, [])
    await assert.rejects(() => getMemory(created.id), /Memory not found/)

    // The first project's record is untouched on disk.
    const { found } = await readStorageFile(rootA, [
      ...MEMORY_SEGMENTS,
      `${created.id}.json`,
    ])

    assert.equal(found, true)
    assert.ok(rootB)
  })

  it('requires an open project', async () => {
    const { closeWorkspace } = require('../workspace/workspace.service.cjs')

    await openWorkspace()
    await closeWorkspace()

    await assert.rejects(() => listMemories(), /Open a project/)
    await assert.rejects(() => getMemory(newMemoryId()), /Open a project/)
    await assert.rejects(() => createMemory(validInput()), /Open a project/)
    await assert.rejects(
      () => updateMemory(newMemoryId(), { content: 'x' }),
      /Open a project/
    )
    await assert.rejects(
      () => deleteMemory(newMemoryId()),
      /Open a project/
    )
  })

  it('rejects malformed and hostile stored records', async () => {
    const root = await openWorkspace()
    const stamp = new Date().toISOString()

    function stored(id, overrides) {
      return {
        version: 1,
        id,
        type: 'fact',
        title: null,
        content: 'x',
        createdAt: stamp,
        updatedAt: stamp,
        sources: [],
        ...overrides,
      }
    }

    const bad = [
      ['mem-traversal', { sources: [{ kind: 'file', path: '../../evil', digest: 'a'.repeat(64) }] }],
      ['mem-absolute', { sources: [{ kind: 'file', path: '/etc/passwd', digest: 'a'.repeat(64) }] }],
      ['mem-backslash', { sources: [{ kind: 'file', path: '..\\evil', digest: 'a'.repeat(64) }] }],
      ['mem-baddigest', { sources: [{ kind: 'file', path: 'ok.txt', digest: 'zzz' }] }],
      ['mem-badtype', { type: 'rumor' }],
      ['mem-badversion', { version: 99 }],
      ['mem-badsource', { sources: [{ kind: 'url', href: 'https://x' }] }],
    ]

    for (const [id, overrides] of bad) {
      await writeStorageFile(
        root,
        [...MEMORY_SEGMENTS, `${id}.json`],
        JSON.stringify(stored(id, overrides))
      )
    }

    await writeStorageFile(root, [...MEMORY_SEGMENTS, 'mem-garbage.json'], '{nope')

    const good = await createMemory(validInput({ content: 'survivor' }))
    const listed = await listMemories()

    assert.deepEqual(
      listed.records.map((record) => record.id),
      [good.id]
    )
    assert.deepEqual(listed.corrupt, [
      'mem-absolute',
      'mem-backslash',
      'mem-baddigest',
      'mem-badsource',
      'mem-badtype',
      'mem-badversion',
      'mem-garbage',
      'mem-traversal',
    ])

    await assert.rejects(() => getMemory('mem-traversal'), /corrupt/)
    await assert.rejects(() => getMemory('mem-garbage'), /corrupt/)
    assert.throws(() => sanitizeRecord(null), /corrupt/)
  })

  it('ignores stray and interrupted-write leftovers when listing', async () => {
    const root = await openWorkspace()
    const good = await createMemory(validInput({ content: 'kept' }))

    // A crashed temp-file+rename leaves at most a `.tmp-*` orphan next
    // to intact records; stray files must never break the list.
    await writeStorageFile(
      root,
      [...MEMORY_SEGMENTS, '.tmp-1234-deadbeef'],
      '{"version":1'
    )
    await writeStorageFile(root, [...MEMORY_SEGMENTS, 'notes.txt'], 'hi')

    const listed = await listMemories()

    assert.deepEqual(
      listed.records.map((record) => record.id),
      [good.id]
    )
    assert.deepEqual(listed.corrupt, [])
  })

  it('lists newest first and refuses to delete non-files', async () => {
    const root = await openWorkspace()
    const memoryDir = path.join(root, '.kryom', 'memory')

    const first = await createMemory(validInput({ content: 'first' }))

    // Ordering must not depend on timer granularity: wait for a new
    // millisecond tick (bounded) before creating the second record.
    const firstMs = Date.parse(first.updatedAt)
    const deadline = Date.now() + 1000

    while (Date.now() <= firstMs && Date.now() < deadline) {
      // Spin: no other work is pending in this process.
    }

    const second = await createMemory(validInput({ content: 'second' }))
    const listed = await listMemories()

    assert.deepEqual(
      listed.records.map((record) => record.id),
      [second.id, first.id]
    )

    await assert.rejects(() => deleteMemory('../memory'), /Invalid memory id/)

    // A directory planted where a record should be is refused, not
    // followed or removed.
    const victim = await createMemory(validInput({ content: 'victim' }))
    const victimFile = path.join(memoryDir, `${victim.id}.json`)

    await fs.unlink(victimFile)
    await fs.mkdir(victimFile)

    await assert.rejects(() => deleteMemory(victim.id), /corrupt/)
    assert.equal((await fs.lstat(victimFile)).isDirectory(), true)

    await fs.rmdir(victimFile)
  })

  it('exports only validated records in a documented format', async () => {
    const root = await openWorkspace('kryom-memory-export-')

    await writeSourceFile(root, 'src.txt', 'data\n')

    const kept = await createMemory(
      validInput({
        type: 'decision',
        title: 'Ship it',
        content: 'We ship on Fridays.',
        sources: [{ kind: 'file', path: 'src.txt' }],
      })
    )

    await writeStorageFile(
      root,
      [...MEMORY_SEGMENTS, 'mem-rotten.json'],
      '{"version":1,"id":"mem-rotten"'
    )

    const document = await buildExportDocument()

    assert.equal(document.version, 1)
    assert.equal(document.kind, 'kryom-memory-export')
    assert.ok(document.exportedAt)
    assert.equal(document.projectName, path.basename(root))
    assert.equal(document.records.length, 1)
    assert.deepEqual(document.skipped, ['mem-rotten'])

    const [record] = document.records

    assert.equal(record.id, kept.id)
    assert.equal(record.type, 'decision')
    assert.deepEqual(Object.keys(record).sort(), [
      'content',
      'createdAt',
      'id',
      'sources',
      'title',
      'type',
      'updatedAt',
    ])
    assert.equal(record.sources[0].path, 'src.txt')

    // Portability and secrecy: no absolute paths, no freshness
    // internals, no environment or credential material.
    const serialized = JSON.stringify(document)

    assert.ok(!serialized.includes(root))
    assert.ok(!serialized.includes('stale'))
    assert.ok(!/MODEL_API_KEY|TAVILY_API_KEY|Bearer [A-Za-z0-9]|"apiKey"/.test(serialized))
  })

  it('writes exports atomically and rejects bad destinations', async () => {
    const root = await openWorkspace()

    await createMemory(validInput({ content: 'export me' }))

    const target = path.join(root, 'backup.json')
    const result = await exportMemoriesToFile(target)

    assert.equal(result.path, target)
    assert.equal(result.exported, 1)
    assert.deepEqual(result.skipped, [])

    const raw = await fs.readFile(target, 'utf8')
    const parsed = JSON.parse(raw)

    assert.equal(parsed.kind, 'kryom-memory-export')
    assert.equal(parsed.records[0].content, 'export me')
    assert.equal(result.bytes, Buffer.byteLength(raw, 'utf8'))

    const leftovers = (await fs.readdir(root)).filter((name) =>
      name.startsWith('.tmp-export-')
    )

    assert.deepEqual(leftovers, [])

    await assert.rejects(
      () => exportMemoriesToFile(path.join(root, 'backup.txt')),
      /must be a \.json file/
    )
    await assert.rejects(
      () => exportMemoriesToFile('relative.json'),
      /absolute path is required/
    )
    await assert.rejects(
      () => exportMemoriesToFile(path.join(root, 'no-dir', 'x.json')),
      /destination folder does not exist/
    )
    await assert.rejects(() => exportMemoriesToFile(''), /Invalid export/)
  })

  it('deletes all memories while preserving unrelated state', async () => {
    const root = await openWorkspace()

    const first = await createMemory(validInput({ content: 'one' }))
    const second = await createMemory(validInput({ content: 'two' }))

    await writeStorageFile(
      root,
      [...MEMORY_SEGMENTS, 'mem-rotten.json'],
      'not json'
    )
    await writeStorageFile(root, [...MEMORY_SEGMENTS, 'notes.txt'], 'stray')

    // Unrelated `.kryom/` content that must survive bulk deletion.
    await saveChat([{ role: 'user', content: 'hi' }], { root })
    await writeStorageFile(
      root,
      ['.kryom', 'checkpoints', 'cp-keep', 'record.json'],
      '{"version":1}'
    )
    const session = await createSession('keep me')

    const result = await deleteAllMemories()

    assert.deepEqual(result.deleted.sort(), [first.id, second.id, 'mem-rotten'].sort())
    assert.deepEqual(result.failed, [])

    const listed = await listMemories()

    assert.deepEqual(listed.records, [])
    assert.deepEqual(listed.corrupt, [])

    const stray = await readStorageFile(root, [...MEMORY_SEGMENTS, 'notes.txt'])

    assert.equal(stray.found, true)

    const chat = await readStorageFile(root, ['.kryom', 'chat.json'])

    assert.equal(chat.found, true)

    const checkpoint = await readStorageFile(root, [
      '.kryom',
      'checkpoints',
      'cp-keep',
      'record.json',
    ])

    assert.equal(checkpoint.found, true)
    assert.equal((await readSession(session.id)).id, session.id)
  })

  it('reports partial bulk-deletion failures honestly', async () => {
    const root = await openWorkspace()
    const memoryDir = path.join(root, '.kryom', 'memory')

    const good = await createMemory(validInput({ content: 'good' }))
    const victim = await createMemory(validInput({ content: 'victim' }))

    await fs.unlink(path.join(memoryDir, `${victim.id}.json`))
    await fs.mkdir(path.join(memoryDir, `${victim.id}.json`))

    const result = await deleteAllMemories()

    assert.deepEqual(result.deleted, [good.id])
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].id, victim.id)
    assert.match(result.failed[0].reason, /Not a regular file/)
    assert.equal(
      (await fs.lstat(path.join(memoryDir, `${victim.id}.json`))).isDirectory(),
      true
    )

    await fs.rmdir(path.join(memoryDir, `${victim.id}.json`))

    const empty = await deleteAllMemories()

    assert.deepEqual(empty, { deleted: [], failed: [] })
  })

  it('keeps bulk deletion inside the current project', async () => {
    const rootA = await openWorkspace('kryom-memory-del-a-')
    const kept = await createMemory(validInput({ content: 'project A' }))

    await openWorkspace('kryom-memory-del-b-')
    await createMemory(validInput({ content: 'project B' }))

    const result = await deleteAllMemories()

    assert.equal(result.deleted.length, 1)
    assert.deepEqual((await listMemories()).records, [])

    const { found } = await readStorageFile(rootA, [
      ...MEMORY_SEGMENTS,
      `${kept.id}.json`,
    ])

    assert.equal(found, true)
  })
})
