const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  getWorkspaceRoot,
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  createSession,
  readSession,
  writeSession,
  writeBrief,
  readBrief,
  listSessions,
  setActiveSession,
  getActiveSessionId,
  getActiveSession,
} = require('./session-store.cjs')
const {
  validateBrief,
  buildExtractiveBrief,
  buildSynthesisPrompt,
  buildResearchContext,
  sanitizeCitationLookalikes,
} = require('./brief.service.cjs')
const {
  executeSession,
  deriveQuestions,
  deriveQueries,
  compareEvidence,
  cancelResearch,
} = require('./research.service.cjs')

async function openWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-research-'))
  await setWorkspaceRoot(dir)

  return dir
}

function fakeSource(index) {
  return {
    provider: 'openalex',
    title: `Paper ${index}`,
    url: `https://example.com/paper-${index}`,
    authors: ['Test Author'],
    publishedAt: '2024-01-01',
    abstract: `Abstract text for paper ${index} with real findings.`,
    venue: 'Test Venue',
    doi: null,
    sourceType: 'paper-open',
    accessStatus: 'open',
    excerpt: '',
  }
}

describe('research session store', () => {
  it('creates, reads, and lists sessions inside the workspace', async () => {
    const root = await openWorkspace()
    const session = await createSession('Test robotics objective')

    assert.match(session.id, /^rs-/)
    assert.equal(session.steps.length, 7)

    const loaded = await readSession(session.id)

    assert.equal(loaded.objective, 'Test robotics objective')

    const listed = await listSessions()

    assert.equal(listed.length, 1)
    assert.equal(listed[0].id, session.id)

    const active = await getActiveSessionId()

    assert.equal(active, session.id)

    const stored = path.join(root, '.kryom', 'research', `${session.id}.json`)
    const stat = await fs.stat(stored)

    assert.ok(stat.isFile())
  })

  it('rejects invalid objectives and unknown sessions', async () => {
    await openWorkspace()

    await assert.rejects(createSession(''), /Invalid objective/)
    await assert.rejects(createSession('x'.repeat(3000)), /Invalid objective/)
    await assert.rejects(readSession('nope-missing'), /not found/)
    await assert.rejects(readSession('../escape'), /Invalid research session id/)
  })

  it('writes and reads brief files', async () => {
    await openWorkspace()

    const session = await createSession('Brief test')

    await writeBrief(session.id, '# Hello')
    assert.equal(await readBrief(session.id), '# Hello')
  })

  it('tracks the active session across reads', async () => {
    await openWorkspace()

    const first = await createSession('First')
    const second = await createSession('Second')

    assert.equal((await getActiveSession()).id, second.id)

    await setActiveSession(first.id)
    assert.equal((await getActiveSession()).id, first.id)
  })

  it('refuses to escape through a planted research link', async (t) => {
    const root = await openWorkspace()
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-research-out-'))

    await fs.mkdir(path.join(root, '.kryom'), { recursive: true })

    try {
      await fs.symlink(
        outside,
        path.join(root, '.kryom', 'research'),
        'junction'
      )
    } catch (error) {
      t.skip(`link creation unavailable: ${error.message}`)
      return
    }

    await assert.rejects(
      () => createSession('Escape attempt'),
      /Symbolic links|escapes/
    )
    await assert.rejects(
      () => writeSession({ id: 'rs-x', brief: null }),
      /Symbolic links|escapes/
    )
    await assert.rejects(
      () => listSessions(),
      /Symbolic links|escapes/
    )

    assert.deepEqual(await fs.readdir(outside), [])
  })

  it('never reads sessions through a planted file link', async (t) => {
    await openWorkspace()

    const session = await createSession('Link test')
    const dir = path.join(getWorkspaceRoot(), '.kryom', 'research')
    const target = path.join(dir, `${session.id}.json`)
    const stashed = `${target}.planted`

    await fs.rename(target, stashed)

    try {
      await fs.symlink(stashed, target)
    } catch (error) {
      await fs.rename(stashed, target)
      t.skip(`symlink creation unavailable: ${error.message}`)
      return
    }

    try {
      await assert.rejects(() => readSession(session.id), /Symbolic links/)

      // Listing skips the planted link instead of following it.
      const listed = await listSessions()

      assert.ok(listed.every((entry) => entry.id !== session.id))
    } finally {
      await fs.unlink(target).catch(() => undefined)
      await fs.rename(stashed, target).catch(() => undefined)
    }
  })

  it('persists sessions across simulated restarts', async () => {
    const root = await openWorkspace()
    const session = await createSession('Restart test')

    session.sources.push(fakeSource(1))
    await writeSession(session)

    // Simulate a restart: re-resolve the same root and reload from disk.
    await setWorkspaceRoot(root)

    const reloaded = await readSession(session.id)

    assert.equal(reloaded.sources.length, 1)
    assert.equal(reloaded.sources[0].title, 'Paper 1')
  })
})

describe('research brief', () => {
  it('validates citations against the source list', () => {
    const sources = [fakeSource(1), fakeSource(2)]

    assert.deepEqual(validateBrief('See [1] and [2].', sources), { ok: true, errors: [] })

    const bad = validateBrief('See [3].', sources)

    assert.equal(bad.ok, false)
    assert.match(bad.errors.join(' '), /\[3\]/)

    const empty = validateBrief('  ', sources)

    assert.equal(empty.ok, false)
  })

  it('rejects citations pointing at sources without URLs', () => {
    const sources = [{ title: 'Broken', url: 'not-a-url' }]
    const result = validateBrief('See [1].', sources)

    assert.equal(result.ok, false)
  })

  it('builds an extractive brief citing every source', async () => {
    await openWorkspace()

    const session = await createSession('Quantum AI objective')

    session.questions = ['Q1', 'Q2']
    session.sources = [fakeSource(1), fakeSource(2)]

    const markdown = buildExtractiveBrief(session)

    assert.match(markdown, /Quantum AI objective/)
    assert.match(markdown, /\[1\] Paper 1/)
    assert.match(markdown, /\[2\] Paper 2/)
    assert.match(markdown, /https:\/\/example.com\/paper-1/)

    const validation = validateBrief(markdown, session.sources)

    assert.equal(validation.ok, true)
  })

  it('builds an honest brief when no sources exist', async () => {
    await openWorkspace()

    const session = await createSession('Empty objective')
    const markdown = buildExtractiveBrief(session)

    assert.match(markdown, /No sources were retrieved/)
  })

  it('rewrites citation lookalikes in untrusted text', () => {
    assert.equal(
      sanitizeCitationLookalikes('see [99] and [2]'),
      'see (99) and (2)'
    )
    assert.equal(sanitizeCitationLookalikes('no brackets'), 'no brackets')
  })

  it('builds synthesis prompts and chat context from real data', async () => {
    await openWorkspace()

    const session = await createSession('Context objective')

    session.questions = ['Q1']
    session.sources = [fakeSource(1)]

    const prompt = buildSynthesisPrompt(session)

    assert.match(prompt, /Context objective/)
    assert.match(prompt, /Paper 1/)

    const context = buildResearchContext(session)

    assert.match(context, /Context objective/)
    assert.match(context, /Paper 1/)
    assert.match(context, /example.com/)
  })
})

describe('research service', () => {
  it('derives bounded questions and queries', () => {
    const questions = deriveQuestions('Quantum robotics')
    const queries = deriveQueries('Quantum robotics', questions)

    assert.ok(questions.length >= 1 && questions.length <= 4)
    assert.ok(queries.length >= 1 && queries.length <= 6)
    assert.equal(queries[0], 'Quantum robotics')
  })

  it('compares evidence into per-source findings', () => {
    const session = { sources: [fakeSource(1), { ...fakeSource(2), abstract: '', excerpt: '' }] }
    const detail = compareEvidence(session)

    assert.match(detail, /2 source/)
    assert.equal(session.findings.length, 2)
    assert.deepEqual(session.findings[0].sourceIndexes, [1])
    assert.equal(session.findings[1].confidence, 'low')
  })

  it('runs end to end with injected search and no LLM', async () => {
    await openWorkspace()

    const seen = []
    const searchImpl = async (query) => {
      seen.push(query)

      return {
        sources: [{ ...fakeSource(seen.length), url: `https://example.com/paper-${seen.length}` }],
        errors: [],
        duplicates: 0,
      }
    }

    const session = await createSession('Robotics grasping')

    // allowLlm:false forces the extractive path without needing a key.
    await executeSession(session.id, { searchImpl, allowLlm: false })

    const done = await readSession(session.id)

    assert.equal(done.status, 'completed')
    assert.ok(done.sources.length > 0)
    assert.ok(done.brief.version >= 1)
    assert.match(done.brief.via, /extractive/)
    assert.ok(done.steps.every((step) => ['done', 'skipped'].includes(step.status)))

    const validation = validateBrief(done.brief.markdown, done.sources)

    assert.equal(validation.ok, true)

    const file = await readBrief(done.id)

    assert.equal(file, done.brief.markdown)
  })

  it('records provider failures without inventing sources', async () => {
    await openWorkspace()

    const searchImpl = async () => ({ sources: [], errors: [{ provider: 'arxiv', message: 'boom' }], duplicates: 0 })
    const session = await createSession('Failing providers')

    await executeSession(session.id, { searchImpl, allowLlm: false })

    const done = await readSession(session.id)

    assert.equal(done.sources.length, 0)
    assert.equal(done.status, 'blocked')
    assert.ok(done.errors.length > 0)
    assert.match(done.brief.markdown, /No sources were retrieved/)
  })

  it('falls back to extractive when the LLM cites invalid sources', async () => {
    await openWorkspace()

    const searchImpl = async () => ({ sources: [fakeSource(1)], errors: [], duplicates: 0 })
    const llmProvider = {
      chat: async () => ({ answer: 'Breakthrough proven, see [99].', model: 'mock' }),
    }
    const session = await createSession('Bad LLM citations')

    await executeSession(session.id, { searchImpl, llmProvider })

    const done = await readSession(session.id)

    assert.match(done.brief.via, /extractive/)
    assert.equal(validateBrief(done.brief.markdown, done.sources).ok, true)
  })

  it('completes when source text contains bracketed numbers and markup', async () => {
    await openWorkspace()

    const searchImpl = async () => ({
      sources: [
        {
          provider: 'probe',
          title: 'Paper [99] on <b>bold</b> claims',
          url: 'https://example.com/lookalike',
          authors: ['A <i>U</i>thor'],
          publishedAt: '2024-01-01',
          abstract: 'As shown in [2], results hold.',
          venue: 'Conf [2024]',
          doi: null,
          sourceType: 'paper',
          accessStatus: 'open',
          excerpt: '',
        },
      ],
      errors: [],
      duplicates: 0,
    })
    const session = await createSession('Lookalike probe')

    await executeSession(session.id, { searchImpl, allowLlm: false })

    const done = await readSession(session.id)

    assert.equal(done.status, 'completed')
    assert.equal(validateBrief(done.brief.markdown, done.sources).ok, true)
    assert.match(done.brief.markdown, /\(99\)/)
    assert.doesNotMatch(done.brief.markdown, /<b>|<i>|\[99\]|\[2024\]/)
  })

  it('cancels a running session honestly', async () => {
    await openWorkspace()

    const searchImpl = async (query, { signal }) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 50)

        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('Research was cancelled.'))
          }, { once: true })
        }
      })

      return { sources: [], errors: [], duplicates: 0 }
    }
    const session = await createSession('Slow research')
    const run = executeSession(session.id, { searchImpl, allowLlm: false })

    await cancelResearch(session.id)
    await assert.rejects(run, /cancelled/)

    const done = await readSession(session.id)

    assert.equal(done.status, 'cancelled')
  })
})
