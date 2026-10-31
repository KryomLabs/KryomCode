const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  createSession,
  readSession,
  writeSession,
  listSessions,
  searchSessions,
  renameSession,
  deleteSession,
  getActiveSession,
} = require('./session-store.cjs')
const {
  executeSession,
  mergeSources,
} = require('./research.service.cjs')
const {
  buildHtmlReport,
  buildHandoff,
  validateBrief,
} = require('./brief.service.cjs')

async function openWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-deep-'))
  await setWorkspaceRoot(dir)

  return dir
}

function fakeSource(index, overrides = {}) {
  return {
    provider: 'openalex',
    title: `Deep Paper ${index} about retrieval evaluation methods`,
    url: `https://example.com/deep-${index}`,
    authors: ['Deep Author'],
    publishedAt: '2024-06-01',
    abstract: `This study examines retrieval evaluation methods and reports measured accuracy improvements for approach ${index} in detail.`,
    venue: 'Deep Venue',
    doi: null,
    sourceType: 'paper-open',
    accessStatus: 'open',
    excerpt: '',
    ...overrides,
  }
}

describe('deep research sessions', () => {
  it('creates sessions with depth and migrates old records', async () => {
    await openWorkspace()

    const session = await createSession('Depth objective', { depth: 'deep', name: 'Deep Run' })

    assert.equal(session.depth, 'deep')
    assert.equal(session.name, 'Deep Run')
    assert.deepEqual(session.plan.subQuestions, [])
    assert.deepEqual(session.claims, [])

    const legacy = await createSession('Legacy objective')

    delete legacy.plan
    delete legacy.claims
    delete legacy.depth
    delete legacy.name
    legacy.sources = [{ title: 'Old', url: 'https://example.com/old' }]
    await writeSession(legacy)

    const migrated = await readSession(legacy.id)

    assert.equal(migrated.depth, 'standard')
    assert.equal(migrated.name, '')
    assert.ok(Array.isArray(migrated.plan.subQuestions))
    assert.match(migrated.sources[0].id, /^src-/)
    assert.deepEqual(migrated.sources[0].supports, [])
  })

  it('rejects invalid depths and names', async () => {
    await openWorkspace()

    await assert.rejects(createSession('Bad depth', { depth: 'ultra' }), /Invalid depth/)

    const session = await createSession('Rename target')

    await assert.rejects(renameSession(session.id, '   '), /Invalid name/)
    await assert.rejects(renameSession(session.id, 'x'.repeat(200)), /Invalid name/)
  })

  it('renames, searches, and deletes sessions', async () => {
    await openWorkspace()

    const first = await createSession('Robotics navigation objective')
    const second = await createSession('Unrelated cooking objective')

    const renamed = await renameSession(first.id, 'Nav Research')

    assert.equal(renamed.name, 'Nav Research')

    const found = await searchSessions('navigation')

    assert.equal(found.length, 1)
    assert.equal(found[0].id, first.id)

    const byId = await searchSessions(second.id)

    assert.ok(byId.some((entry) => entry.id === second.id))

    await assert.rejects(searchSessions('   '), /search query is required/)

    const removed = await deleteSession(first.id)

    assert.deepEqual(removed, { id: first.id, deleted: true })

    const remaining = await listSessions()

    assert.ok(remaining.every((entry) => entry.id !== first.id))
    await assert.rejects(readSession(first.id), /not found/)

    // Deleting the active session repoints activity honestly.
    const active = await getActiveSession()

    assert.ok(!active || active.id !== first.id)

    await assert.rejects(deleteSession('rs-missing-session'), /not found/)
  })

  it('runs a quick session end to end without verification', async () => {
    await openWorkspace()

    let calls = 0
    const searchImpl = async () => {
      calls += 1

      return { sources: [fakeSource(calls)], errors: [], duplicates: 0 }
    }
    const session = await createSession('Quick robotics', { depth: 'quick' })

    await executeSession(session.id, { searchImpl, allowLlm: false })

    const done = await readSession(session.id)

    assert.equal(done.status, 'completed')
    assert.equal(done.depth, 'quick')
    assert.equal(done.plan.subQuestions.length, 2)
    assert.ok(done.plan.subQuestions.every((entry) => entry.status === 'done'))
    assert.ok(done.sources.length > 0 && done.sources.length <= 8)
    assert.deepEqual(done.claims, [])
    assert.deepEqual(done.conflicts, [])
    assert.ok(done.sources.every((source) => source.id && source.quality && source.retrievedAt))
    assert.equal(validateBrief(done.brief.markdown, done.sources).ok, true)
  })

  it('runs a standard session with claims and provenance', async () => {
    await openWorkspace()

    let calls = 0
    const searchImpl = async (query) => {
      calls += 1
      const providers = ['arxiv', 'openalex', 'crossref', 'semanticscholar']
      const host = ['arxiv.org', 'example.org', 'example.net', 'example.edu'][calls % 4]

      return {
        sources: [fakeSource(calls, { provider: providers[calls % 4], url: `https://${host}/deep-${calls}` })],
        errors: [],
        duplicates: 0,
      }
    }
    const session = await createSession('Standard retrieval study', { depth: 'standard' })

    await executeSession(session.id, { searchImpl, allowLlm: false })

    const done = await readSession(session.id)

    assert.equal(done.status, 'completed')
    assert.equal(done.plan.subQuestions.length, 4)
    assert.ok(done.claims.length > 0)
    assert.ok(done.sources.every((source) => Array.isArray(source.supports) && source.supports.length > 0))
    assert.ok(done.findings.every((finding) => finding.sourceIndexes.every((index) => index >= 1 && index <= done.sources.length)))
    assert.equal(validateBrief(done.brief.markdown, done.sources).ok, true)
    assert.match(done.brief.markdown, /Research methodology/)
    assert.match(done.brief.markdown, /Evidence verification/)
  })

  it('continues past per-question failures and records them', async () => {
    await openWorkspace()

    const searchImpl = async (query) => {
      if (/limitations/i.test(query)) {
        throw new Error('provider exploded')
      }

      return { sources: [fakeSource(1)], errors: [], duplicates: 0 }
    }
    const session = await createSession('Partial failure study', { depth: 'standard' })

    await executeSession(session.id, { searchImpl, allowLlm: false })

    const done = await readSession(session.id)

    assert.equal(done.status, 'completed')
    assert.ok(done.sources.length > 0)
    assert.ok(done.errors.some((entry) => /provider exploded/.test(entry.message)))
    assert.ok(done.plan.subQuestions.some((entry) => entry.status === 'failed'))
  })

  it('merges provenance across duplicate sources', async () => {
    await openWorkspace()

    const session = await createSession('Provenance study')

    session.sources = []
    mergeSources(session, [fakeSource(1)], { supports: ['q1'], maxSources: 20 })
    mergeSources(session, [fakeSource(1, { provider: 'crossref' })], { supports: ['q2'], maxSources: 20 })

    assert.equal(session.sources.length, 1)
    assert.deepEqual([...session.sources[0].supports].sort(), ['q1', 'q2'])
    assert.ok(session.sources[0].quality)
  })

  it('builds an escaped HTML report from saved state', async () => {
    await openWorkspace()

    const session = await createSession('HTML <b>report</b> objective')

    session.sources = [fakeSource(1, { title: 'Title <script>alert(1)</script>', url: 'javascript:alert(1)' })]
    session.claims = [
      { id: 'clm-1', text: 'Claim with <b>markup</b>.', sourceId: null, questionIds: [], method: 'extractive', status: 'insufficient-evidence', supportingSourceIds: [], explanation: 'test' },
    ]
    session.brief = { version: 1, markdown: '# Brief\n\nText [1].\n', generatedAt: '2024-01-01', via: 'test' }

    const html = buildHtmlReport(session)

    assert.match(html, /&lt;script&gt;/)
    assert.doesNotMatch(html, /<script>alert/)
    // Unsafe schemes render as inert text, never as links.
    assert.doesNotMatch(html, /href="javascript/)
    assert.match(html, />javascript:alert\(1\)</)
    assert.match(html, /insufficient-evidence/)
  })

  it('builds labeled handoffs for chat and agent targets', async () => {
    await openWorkspace()

    const session = await createSession('Handoff objective')

    session.sources = [fakeSource(1), fakeSource(2)]
    session.findings = [
      { claim: 'First finding.', sourceIndexes: [1], confidence: 'high', note: 'supported' },
      { claim: 'Second finding.', sourceIndexes: [2], confidence: 'low', note: 'thin' },
    ]
    session.implementationTasks = ['Do the thing.']
    session.conflicts = [{ id: 'cfl-1', claimIds: [], sourceIds: [], topic: 'x', status: 'conflicting-evidence', description: 'Disagreement.' }]

    const chat = buildHandoff(session, { target: 'chat' })

    assert.match(chat, /UNTRUSTED/)
    assert.match(chat, /not instructions/)
    assert.match(chat, /First finding/)
    assert.match(chat, /conflicting-evidence flag/)

    const agent = buildHandoff(session, { target: 'agent-brief', findingIndexes: [2] })

    assert.match(agent, /Second finding/)
    assert.doesNotMatch(agent, /First finding/)
    assert.match(agent, /Do the thing/)
    assert.match(agent, /require user approval/)
  })
})
