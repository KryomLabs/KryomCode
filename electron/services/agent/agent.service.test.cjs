const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  MockProvider,
} = require('../ai/providers/mock.provider.cjs')
const { planTask, applyEdits, cancelPlan } = require('./agent.service.cjs')

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-agent-'))
  await setWorkspaceRoot(dir)

  return dir
}

function digestOf(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

describe('agent.service', () => {
  it('aborts in-flight planning on cancel', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      assert.deepEqual(cancelPlan(), { cancelled: false })

      const provider = new MockProvider({ delayMs: 5000 })
      const run = planTask({ task: 'Do something.' }, { provider })

      // Wait for the provider call to land (not a fixed sleep) so the
      // cancel deterministically hits an in-flight request.
      const deadline = Date.now() + 5000

      while (provider.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }

      assert.equal(provider.calls.length, 1)
      assert.deepEqual(cancelPlan(), { cancelled: true })
      await assert.rejects(() => run, /cancelled/)
      assert.deepEqual(cancelPlan(), { cancelled: false })
    } finally {
      restore()
    }
  })

  it('plans validated edits and returns commands unexecuted', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'new.txt')
      const sentinel = path.join(root, 'must-not-exist.txt')
      const provider = new MockProvider({
        answer: JSON.stringify({
          edits: [{ path: target, action: 'create', content: 'planned' }],
          commands: [`node -e "require('fs').writeFileSync('${sentinel}', 'x')"`],
          notes: 'demo plan',
        }),
      })

      const plan = await planTask({ task: 'Add a file.' }, { provider })

      assert.equal(plan.edits.length, 1)
      // planTask returns the validated real path, which may differ in
      // string form from the input on Windows (8.3 short names).
      assert.equal(
        plan.edits[0].path,
        path.join(await fs.realpath(root), 'new.txt')
      )
      assert.equal(plan.edits[0].preview, 'planned')
      assert.equal(plan.commands.length, 1)
      assert.equal(plan.model, 'muse-spark-1.3')

      await assert.rejects(() => fs.stat(target))
      await assert.rejects(() => fs.stat(sentinel))
    } finally {
      restore()
    }
  })

  it('rejects malformed plans and traversal paths', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()

      const badJson = new MockProvider({ answer: 'not json at all' })
      await assert.rejects(
        () => planTask({ task: 'Do it.' }, { provider: badJson }),
        /valid plan/
      )

      const traversal = new MockProvider({
        answer: JSON.stringify({
          edits: [
            { path: path.join(root, '..', 'evil.txt'), action: 'create', content: 'x' },
          ],
        }),
      })
      await assert.rejects(
        () => planTask({ task: 'Do it.' }, { provider: traversal }),
        /outside/
      )
    } finally {
      restore()
    }
  })

  it('validates planner risks, outcomes, and suggested steps', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      const provider = new MockProvider({
        answer: JSON.stringify({
          edits: [],
          commands: [],
          notes: 'ok',
          expectedOutcome: 'Tests pass.',
          risks: [
            {
              severity: 'high',
              explanation: 'Could break login.',
              mitigation: 'Run auth tests.',
            },
          ],
          steps: ['Write code', 'Run tests'],
        }),
      })

      const plan = await planTask({ task: 'Do it.' }, { provider })

      assert.equal(plan.expectedOutcome, 'Tests pass.')
      assert.deepEqual(plan.risks, [
        {
          severity: 'high',
          explanation: 'Could break login.',
          mitigation: 'Run auth tests.',
        },
      ])
      assert.deepEqual(plan.suggestedSteps, ['Write code', 'Run tests'])

      const bare = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [], notes: '' }),
      })

      const minimal = await planTask({ task: 'Do it.' }, { provider: bare })

      assert.equal(minimal.expectedOutcome, '')
      assert.deepEqual(minimal.risks, [])
      assert.deepEqual(minimal.suggestedSteps, [])

      const badRisk = new MockProvider({
        answer: JSON.stringify({
          edits: [],
          risks: [{ severity: 'low', explanation: 'x' }],
        }),
      })

      await assert.rejects(
        () => planTask({ task: 'Do it.' }, { provider: badRisk }),
        /Invalid plan risk/
      )
    } finally {
      restore()
    }
  })

  it('attaches chat context only on explicit opt-in', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const { saveChat } = require('../ai/chat-store.cjs')

      await saveChat(
        [
          { role: 'user', content: 'Remember the blue widget.' },
          { role: 'assistant', content: 'Noted.' },
        ],
        { root }
      )

      const withChat = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [], notes: '' }),
      })

      const plan = await planTask(
        { task: 'Do it.', includeChat: true },
        { provider: withChat }
      )

      const sent = withChat.calls[0].messages.map((entry) => entry.content).join('\n')

      assert.ok(sent.includes('blue widget'))
      assert.equal(plan.contextSnapshot.chat.messageCount, 2)
      assert.equal(plan.contextSnapshot.files.length, 0)
      assert.equal(plan.contextSnapshot.research, null)
      assert.ok(plan.contextSnapshot.workspace.projectName)

      const withoutChat = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [], notes: '' }),
      })

      const plain = await planTask({ task: 'Do it.' }, { provider: withoutChat })
      const plainSent = withoutChat.calls[0].messages
        .map((entry) => entry.content)
        .join('\n')

      assert.ok(!plainSent.includes('blue widget'))
      assert.equal(plain.contextSnapshot.chat, null)

      await assert.rejects(
        () =>
          planTask(
            { task: 'Do it.', includeChat: 'yes' },
            { provider: new MockProvider({}) }
          ),
        /Invalid includeChat flag/
      )
    } finally {
      restore()
    }
  })

  it('records file and research provenance in snapshots', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const { createSession } = require('../research/session-store.cjs')

      await fs.writeFile(path.join(root, 'app.ts'), 'const x = 1\n')

      const session = await createSession('Snapshot provenance.')

      const provider = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [], notes: '' }),
      })

      const plan = await planTask(
        {
          task: 'Do it.',
          contextPaths: [path.join(root, 'app.ts')],
          researchSessionId: session.id,
        },
        { provider }
      )

      assert.equal(plan.contextSnapshot.files.length, 1)
      assert.equal(plan.contextSnapshot.files[0].relativePath, 'app.ts')
      assert.match(plan.contextSnapshot.files[0].digest, /^[0-9a-f]{64}$/)
      assert.equal(plan.contextSnapshot.research.sessionId, session.id)
      assert.equal(plan.contextSnapshot.research.briefVersion, 0)
      assert.equal(plan.contextSnapshot.chat, null)
    } finally {
      restore()
    }
  })

  it('applies approved edits and rolls back on failure', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const existing = path.join(root, 'keep.txt')
      await fs.writeFile(existing, 'original')

      const ok = await applyEdits({
        edits: [
          { path: path.join(root, 'made.txt'), action: 'create', content: 'new' },
          {
            path: existing,
            action: 'modify',
            content: 'updated',
            originalDigest: digestOf('original'),
          },
        ],
      })

      assert.equal(ok.completed, true)
      assert.equal(ok.rolledBack, false)
      assert.equal(ok.applied.length, 2)
      assert.equal(await fs.readFile(existing, 'utf8'), 'updated')

      // A mid-apply failure (oversized content the pre-apply
      // freshness gate does not screen) still rolls back the edit
      // that already landed.
      const failed = await applyEdits({
        edits: [
          {
            path: existing,
            action: 'modify',
            content: 'broken-plan',
            originalDigest: digestOf('updated'),
          },
          {
            path: path.join(root, 'made.txt'),
            action: 'modify',
            content: `too big: ${'x'.repeat(1024 * 1024 + 1)}`,
            originalDigest: digestOf('new'),
            originalLength: 3,
          },
        ],
      })

      assert.equal(failed.completed, false)
      assert.equal(failed.rolledBack, true)
      assert.ok(failed.failed)
      assert.match(failed.failed.message, /exceeds 1 MB/)
      assert.equal(await fs.readFile(existing, 'utf8'), 'updated')
    } finally {
      restore()
    }
  })

  it('stops applying when cancelled and rejects bad edits', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'cancelled.txt')
      const controller = new AbortController()
      controller.abort()

      const cancelled = await applyEdits(
        { edits: [{ path: target, action: 'create', content: 'x' }] },
        { signal: controller.signal }
      )

      assert.equal(cancelled.cancelled, true)
      assert.equal(cancelled.completed, false)
      await assert.rejects(() => fs.stat(target))

      await assert.rejects(() => applyEdits({ edits: [] }), /No approved edits/)
      const invalid = await applyEdits({
        edits: [{ path: target, action: 'explode', content: 'x' }],
      })

      assert.equal(invalid.completed, false)
      assert.equal(invalid.rolledBack, true)
      assert.match(invalid.failed.message, /invalid/)
    } finally {
      restore()
    }
  })

  it('sends selected source contents to the planner and reports them', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const source = path.join(root, 'src', 'greet.ts')

      await fs.mkdir(path.join(root, 'src'), { recursive: true })
      await fs.writeFile(source, 'export function greet() {\n  return "hi";\n}\n')

      const provider = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [], notes: 'ok' }),
      })
      const plan = await planTask(
        { task: 'Greet loudly.', contextPaths: ['src/greet.ts'] },
        { provider }
      )

      const sent = provider.lastCall.messages
        .map((message) => message.content)
        .join('\n')

      assert.match(sent, /UNTRUSTED reference material/)
      assert.match(sent, /src\/greet\.ts|src\\greet\.ts/)
      assert.match(sent, /return "hi"/)
      assert.equal(plan.contextFiles.length, 1)
      assert.equal(plan.contextExcluded.length, 0)
      assert.ok(plan.totalContextBytes > 0)

      // Excluded files are reported, never transmitted.
      await fs.writeFile(path.join(root, '.env'), 'MODEL_API_KEY=live-secret\n')

      const redacted = await planTask(
        {
          task: 'Greet loudly.',
          contextPaths: ['src/greet.ts', '.env'],
        },
        { provider }
      )
      const redactedSent = provider.lastCall.messages
        .map((message) => message.content)
        .join('\n')

      assert.doesNotMatch(redactedSent, /live-secret/)
      assert.equal(redacted.contextFiles.length, 1)
      assert.equal(redacted.contextExcluded.length, 1)
      assert.match(redacted.contextExcluded[0].reason, /sensitive/)
    } finally {
      restore()
    }
  })

  it('rejects context traversal before contacting the model', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const provider = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [], notes: '' }),
      })

      await assert.rejects(
        () =>
          planTask(
            {
              task: 'Do it.',
              contextPaths: [path.join(root, '..', 'evil.ts')],
            },
            { provider }
          ),
        /outside/
      )
      assert.equal(provider.calls.length, 0)
    } finally {
      restore()
    }
  })

  it('rejects malformed edit proposals with clear errors', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const existing = path.join(root, 'keep.txt')
      await fs.writeFile(existing, 'original')

      const cases = [
        [{ path: existing, action: 'explode', content: 'x' }, /action/],
        [{ path: existing, action: 'modify' }, /content is required/],
        [{ path: '', action: 'modify', content: 'x' }, /path is invalid/],
        ['not-an-object', /an object is required/],
        [
          { path: existing, action: 'create', content: 'x' },
          /already exists/,
        ],
        [
          { path: path.join(root, 'gone.txt'), action: 'modify', content: 'x' },
          /must be an existing file/,
        ],
        [
          { path: path.join(root, 'gone.txt'), action: 'delete' },
          /must be an existing file/,
        ],
      ]

      for (const [edits, pattern] of cases) {
        const provider = new MockProvider({
          answer: JSON.stringify({ edits: [edits], commands: [], notes: '' }),
        })

        await assert.rejects(
          () => planTask({ task: 'Do it.' }, { provider }),
          pattern
        )
      }

      const nonArray = new MockProvider({
        answer: JSON.stringify({ edits: {}, commands: [], notes: '' }),
      })

      await assert.rejects(
        () => planTask({ task: 'Do it.' }, { provider: nonArray }),
        /must be an array/
      )

      // Oversized targets are rejected at plan time, not apply time.
      const huge = path.join(root, 'huge.bin')
      await fs.writeFile(huge, Buffer.alloc(1024 * 1024 + 1))

      const tooBig = new MockProvider({
        answer: JSON.stringify({
          edits: [{ path: huge, action: 'modify', content: 'x' }],
          commands: [],
          notes: '',
        }),
      })

      await assert.rejects(
        () => planTask({ task: 'Do it.' }, { provider: tooBig }),
        /too large/
      )
    } finally {
      restore()
    }
  })

  it('records digests and reasons for grounded edits', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'app.ts')
      await fs.writeFile(target, 'const a = 1;\n')

      const provider = new MockProvider({
        answer: JSON.stringify({
          edits: [
            {
              path: target,
              action: 'modify',
              content: 'const a = 2;\n',
              reason: 'Bump the constant.',
            },
            {
              path: path.join(root, 'new.ts'),
              action: 'create',
              content: 'export const b = 3;\n',
            },
          ],
          commands: [],
          notes: '',
        }),
      })
      const plan = await planTask({ task: 'Bump it.' }, { provider })

      assert.equal(plan.edits[0].reason, 'Bump the constant.')
      assert.equal(plan.edits[0].originalDigest, digestOf('const a = 1;\n'))
      assert.equal(plan.edits[0].originalLength, 'const a = 1;\n'.length)
      assert.equal(plan.edits[1].reason, '')
      assert.equal(plan.edits[1].originalDigest, undefined)
    } finally {
      restore()
    }
  })

  it('rejects stale proposals without overwriting newer edits', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'app.ts')
      await fs.writeFile(target, 'version one\n')

      const provider = new MockProvider({
        answer: JSON.stringify({
          edits: [
            {
              path: target,
              action: 'modify',
              content: 'version two\n',
              reason: 'test',
            },
          ],
          commands: [],
          notes: '',
        }),
      })
      const plan = await planTask({ task: 'Bump it.' }, { provider })

      // The file changes after planning (user edit, another tool).
      await fs.writeFile(target, 'version three\n')

      const stale = await applyEdits({ edits: plan.edits })

      // The pre-apply gate blocks with zero writes, so there is
      // nothing to roll back and no checkpoint to record.
      assert.equal(stale.completed, false)
      assert.equal(stale.rolledBack, false)
      assert.equal(stale.checkpoint, null)
      assert.deepEqual(stale.applied, [])
      assert.match(stale.failed.message, /Pre-apply check blocked 1 edit/)
      assert.equal(stale.stale.length, 1)
      assert.equal(stale.stale[0].path, 'app.ts')
      assert.equal(stale.stale[0].status, 'stale')
      assert.match(stale.stale[0].reason, /Changed since the plan/)
      assert.equal(await fs.readFile(target, 'utf8'), 'version three\n')

      // A fresh plan against current content applies cleanly.
      const fresh = await planTask({ task: 'Bump it.' }, { provider })
      const applied = await applyEdits({ edits: fresh.edits })

      assert.equal(applied.completed, true)
      assert.equal(await fs.readFile(target, 'utf8'), 'version two\n')

      // Missing digests fail closed instead of applying blindly.
      await fs.writeFile(target, 'version four\n')

      const undigested = await applyEdits({
        edits: [{ path: target, action: 'modify', content: 'x\n' }],
      })

      assert.equal(undigested.completed, false)
      assert.equal(undigested.stale.length, 1)
      assert.equal(undigested.stale[0].status, 'unverified')
      assert.equal(await fs.readFile(target, 'utf8'), 'version four\n')
    } finally {
      restore()
    }
  })

  it('blocks mixed stale batches with zero writes and no checkpoint', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const current = path.join(root, 'current.ts')
      const changed = path.join(root, 'changed.ts')
      const removed = path.join(root, 'removed.ts')
      const bystander = path.join(root, 'bystander.ts')

      await fs.writeFile(current, 'steady\n')
      await fs.writeFile(changed, 'planned\n')
      await fs.writeFile(removed, 'doomed\n')
      await fs.writeFile(bystander, 'hands off\n')

      const edits = [
        {
          path: current,
          action: 'modify',
          content: 'steady v2\n',
          originalDigest: digestOf('steady\n'),
          originalLength: 7,
        },
        {
          path: changed,
          action: 'modify',
          content: 'planned v2\n',
          originalDigest: digestOf('planned\n'),
          originalLength: 8,
        },
        {
          path: removed,
          action: 'delete',
          originalDigest: digestOf('doomed\n'),
          originalLength: 7,
        },
      ]

      // Two files move after planning: one edited, one deleted.
      await fs.writeFile(changed, 'user rewrite\n')
      await fs.unlink(removed)

      const blocked = await applyEdits({ edits })

      assert.equal(blocked.completed, false)
      assert.equal(blocked.rolledBack, false)
      assert.equal(blocked.checkpoint, null)
      assert.deepEqual(blocked.applied, [])
      assert.equal(blocked.stale.length, 2)
      assert.deepEqual(
        blocked.stale.map((entry) => [entry.path, entry.status]),
        [
          ['changed.ts', 'stale'],
          ['removed.ts', 'missing'],
        ]
      )

      // Zero writes: even the current edit is held back, and the
      // unrelated bystander file is untouched.
      assert.equal(await fs.readFile(current, 'utf8'), 'steady\n')
      assert.equal(await fs.readFile(changed, 'utf8'), 'user rewrite\n')
      assert.equal(await fs.readFile(bystander, 'utf8'), 'hands off\n')
      await assert.rejects(() => fs.stat(removed))

      // Re-planning against current content clears the block.
      const retry = await applyEdits({
        edits: [
          {
            path: current,
            action: 'modify',
            content: 'steady v2\n',
            originalDigest: digestOf('steady\n'),
            originalLength: 7,
          },
        ],
      })

      assert.equal(retry.completed, true)
      assert.equal(await fs.readFile(current, 'utf8'), 'steady v2\n')
      assert.equal(await fs.readFile(changed, 'utf8'), 'user rewrite\n')
    } finally {
      restore()
    }
  })

  it('blocks same-file duplicate batches with zero writes and no checkpoint', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'dupe.ts')
      const other = path.join(root, 'other.ts')

      await fs.writeFile(target, 'original\n')
      await fs.writeFile(other, 'other\n')

      const blocked = await applyEdits({
        edits: [
          {
            path: target,
            action: 'modify',
            content: 'first\n',
            originalDigest: digestOf('original\n'),
            originalLength: 9,
          },
          {
            path: target,
            action: 'modify',
            content: 'second\n',
            originalDigest: digestOf('original\n'),
            originalLength: 9,
          },
          {
            path: other,
            action: 'modify',
            content: 'other v2\n',
            originalDigest: digestOf('other\n'),
            originalLength: 6,
          },
        ],
      })

      assert.equal(blocked.completed, false)
      assert.equal(blocked.rolledBack, false)
      assert.equal(blocked.checkpoint, null)
      assert.deepEqual(blocked.applied, [])
      assert.match(blocked.failed.message, /Conflicting edits/)
      assert.deepEqual(blocked.conflicts, [{ path: 'dupe.ts', indexes: [0, 1] }])

      // Zero writes: even the unrelated current edit is held back.
      assert.equal(await fs.readFile(target, 'utf8'), 'original\n')
      assert.equal(await fs.readFile(other, 'utf8'), 'other\n')

      // Approving only one of the pair clears the block.
      const retry = await applyEdits({
        edits: [
          {
            path: target,
            action: 'modify',
            content: 'second\n',
            originalDigest: digestOf('original\n'),
            originalLength: 9,
          },
        ],
      })

      assert.equal(retry.completed, true)
      assert.equal(await fs.readFile(target, 'utf8'), 'second\n')
    } finally {
      restore()
    }
  })

  it('writes approved content byte-for-byte, unrelated lines intact', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const target = path.join(root, 'app.ts')
      const original = 'line one\nline two\nline three\n'
      const updated = 'line one\nline TWO\nline three\n'

      await fs.writeFile(target, original)

      const result = await applyEdits({
        edits: [
          {
            path: target,
            action: 'modify',
            content: updated,
            originalDigest: digestOf(original),
          },
        ],
      })

      assert.equal(result.completed, true)
      assert.equal(await fs.readFile(target, 'utf8'), updated)
    } finally {
      restore()
    }
  })

  it('never executes plan commands on the apply path', async () => {
    const restore = useTestKey()

    try {
      const root = await openWorkspace()
      const sentinel = path.join(root, 'must-not-exist.txt')
      const target = path.join(root, 'made.txt')
      const provider = new MockProvider({
        answer: JSON.stringify({
          edits: [{ path: target, action: 'create', content: 'made' }],
          commands: [`node -e "require('fs').writeFileSync('${sentinel}', 'x')"`],
          notes: '',
        }),
      })
      const plan = await planTask({ task: 'Make it.' }, { provider })
      const applied = await applyEdits({ edits: plan.edits })

      assert.equal(applied.completed, true)
      assert.equal(await fs.readFile(target, 'utf8'), 'made')
      await assert.rejects(() => fs.stat(sentinel))
    } finally {
      restore()
    }
  })

  it('leaves planning consistent after provider failures', async () => {
    const restore = useTestKey()

    try {
      await openWorkspace()

      const failing = { chat: async () => { throw new Error('Model boom.') } }

      await assert.rejects(
        () => planTask({ task: 'Do it.' }, { provider: failing }),
        /Model boom/
      )

      // A later plan still works: no stuck in-flight controller.
      const provider = new MockProvider({
        answer: JSON.stringify({ edits: [], commands: [], notes: 'ok' }),
      })
      const plan = await planTask({ task: 'Do it.' }, { provider })

      assert.equal(plan.notes, 'ok')
      assert.deepEqual(cancelPlan(), { cancelled: false })
    } finally {
      restore()
    }
  })

  it('aborts an apply batch before any edit on a pre-cancelled signal', async () => {
    const root = await openWorkspace()
    const target = path.join(root, 'made.txt')
    const controller = new AbortController()
    controller.abort()

    const result = await applyEdits(
      { edits: [{ path: target, action: 'create', content: 'x' }] },
      { signal: controller.signal }
    )

    assert.equal(result.completed, false)
    assert.equal(result.cancelled, true)
    assert.deepEqual(result.applied, [])
    assert.equal(result.rolledBack, false)
    assert.equal(result.checkpoint, null)
    await assert.rejects(fs.stat(target), /ENOENT/)
    assert.deepEqual(cancelPlan(), { cancelled: false })
  })

  it('stops an apply between edits and checkpoints partial work', async () => {
    const root = await openWorkspace()
    const edits = Array.from({ length: 20 }, (_, index) => ({
      path: path.join(root, `f${index}.txt`),
      action: 'create',
      content: `file ${index}`,
    }))

    const run = applyEdits({ edits, task: 'Partial probe' })
    setImmediate(() => cancelPlan())
    const result = await run

    assert.equal(result.completed, false)
    assert.equal(result.cancelled, true)
    assert.equal(result.rolledBack, false)
    assert.ok(result.applied.length >= 0 && result.applied.length <= 20)

    // Checkpoint consistency holds at any split point.
    if (result.applied.length === 0) {
      assert.equal(result.checkpoint, null)
    } else {
      assert.ok(result.checkpoint && result.checkpoint.id)
      assert.equal(result.checkpoint.files, result.applied.length)
    }

    // Disk matches the reported partial batch exactly (compared by
    // file name so workspace path aliases cannot fool the check).
    const appliedNames = new Set(
      result.applied.map((item) => path.basename(item.path))
    )

    for (const item of result.applied) {
      const content = await fs.readFile(
        path.join(root, path.basename(item.path)),
        'utf8'
      )

      assert.match(content, /^file \d+$/)
    }

    for (let index = 0; index < edits.length; index += 1) {
      const exists = await fs
        .stat(path.join(root, `f${index}.txt`))
        .then(
          () => true,
          () => false
        )

      assert.equal(exists, appliedNames.has(`f${index}.txt`))
    }

    assert.deepEqual(cancelPlan(), { cancelled: false })
  })
})
