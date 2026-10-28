const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  MockProvider,
} = require('../ai/providers/mock.provider.cjs')
const { chat } = require('../ai/ai.service.cjs')
const { planTask } = require('../agent/agent.service.cjs')
const {
  createSession,
  writeSession,
} = require('./session-store.cjs')
const { loadResearchContext } = require('./brief.service.cjs')

function useTestKey() {
  const saved = {
    MODEL_API_KEY: process.env.MODEL_API_KEY,
    META_MODEL: process.env.META_MODEL,
  }

  process.env.MODEL_API_KEY = 'test-key'
  delete process.env.META_MODEL

  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

async function openWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-handoff-'))
  await setWorkspaceRoot(dir)

  return dir
}

async function seedSession() {
  const session = await createSession('Handoff test objective')

  session.sources = [
    {
      provider: 'arxiv',
      title: 'Handoff Paper',
      url: 'https://example.com/handoff',
      authors: ['Seedy Author'],
      publishedAt: '2024-02-02',
      abstract: 'Evidence about handoffs.',
      venue: 'arXiv',
      doi: null,
      sourceType: 'preprint',
      accessStatus: 'open',
      excerpt: '',
    },
  ]
  session.questions = ['What is a handoff?']
  session.brief = {
    version: 1,
    markdown: '# Brief\n\nSee [1] for handoff evidence.',
    generatedAt: new Date().toISOString(),
    via: 'extractive (test)',
  }
  session.status = 'completed'

  await writeSession(session)

  return session
}

describe('research handoff', () => {
  it('chat works normally without a research session', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      const provider = new MockProvider({ answer: 'plain answer' })
      const result = await chat({ prompt: 'hi' }, { provider })

      assert.equal(result.answer, 'plain answer')
      assert.equal(result.researchSessionId, undefined)

      const systems = provider.lastCall.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n')

      assert.doesNotMatch(systems, /Research brief context/)
    } finally {
      restore()
    }
  })

  it('chat grounds answers in the saved session, not a re-run', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      const session = await seedSession()
      const provider = new MockProvider({ answer: 'grounded' })
      const result = await chat(
        { prompt: 'Which papers have we found?', researchSessionId: session.id },
        { provider }
      )

      assert.equal(result.researchSessionId, session.id)

      const systems = provider.lastCall.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n')

      assert.match(systems, /Handoff test objective/)
      assert.match(systems, /Handoff Paper/)
      assert.match(systems, /example\.com\/handoff/)
    } finally {
      restore()
    }
  })

  it('chat rejects unknown and malformed session ids', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      const provider = new MockProvider()

      await assert.rejects(
        () => chat({ prompt: 'hi', researchSessionId: 'rs-missing' }, { provider }),
        /not found/
      )
      await assert.rejects(
        () => chat({ prompt: 'hi', researchSessionId: '../escape' }, { provider }),
        /Invalid research session id/
      )
      await assert.rejects(
        () => chat({ prompt: 'hi', researchSessionId: 42 }, { provider }),
        /Invalid research session id/
      )

      assert.equal(provider.calls.length, 0)
    } finally {
      restore()
    }
  })

  it('agent plans from the brief without re-running research', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      const session = await seedSession()
      const provider = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [], notes: 'planned from brief' }),
      })
      const plan = await planTask(
        { task: 'Implement from research.', researchSessionId: session.id },
        { provider }
      )

      assert.equal(plan.researchSessionId, session.id)

      const systems = provider.lastCall.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n')

      assert.match(systems, /Handoff test objective/)
      assert.match(systems, /Handoff Paper/)
      assert.match(systems, /\[1\]/)
    } finally {
      restore()
    }
  })

  it('agent rejects unknown research sessions before planning', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      const provider = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [] }),
      })

      await assert.rejects(
        () => planTask({ task: 'Do it.', researchSessionId: 'rs-missing' }, { provider }),
        /not found/
      )
      await assert.rejects(
        () => planTask({ task: 'Do it.', researchSessionId: '' }, { provider }),
        /Invalid research session id/
      )

      assert.equal(provider.calls.length, 0)
    } finally {
      restore()
    }
  })

  it('loadResearchContext validates ids and loads saved data', async () => {
    await openWorkspace()

    const session = await seedSession()
    const loaded = await loadResearchContext(session.id)

    assert.equal(loaded.sessionId, session.id)
    assert.match(loaded.context, /Handoff Paper/)

    await assert.rejects(loadResearchContext(''), /Invalid research session id/)
    await assert.rejects(loadResearchContext('../x'), /Invalid research session id/)
    await assert.rejects(loadResearchContext('rs-missing'), /not found/)
  })
})
