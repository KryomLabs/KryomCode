// Change-set tests (Level 3B.6): dependency analysis, ordering,
// conflicts, validation, bounds, and isolation. Synthetic local
// projects only; no network, no Meta calls.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  CHANGESET_VERSION,
  MAX_GRAPH_FILES,
  MAX_DEPTH,
  MAX_ANALYSIS_BYTES,
  buildChangeSet,
} = require('./change-set.cjs')

async function openWorkspace(prefix = 'kryom-changeset-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))

  await setWorkspaceRoot(root)

  return root
}

async function write(root, rel, content) {
  const full = path.join(root, rel)

  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content)

  return full
}

function digestOf(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
}

async function fingerprinted(root, rel, action, overrides = {}) {
  const full = path.join(root, rel)
  const buffer = await fs.readFile(full)

  return {
    path: rel,
    action,
    originalDigest: digestOf(buffer.toString('utf8')),
    originalLength: buffer.length,
    ...overrides,
  }
}

function blockersByPath(manifest) {
  return new Map(
    manifest.validation.blockers.map((entry) => [entry.path, entry.reason])
  )
}

describe('change-set', () => {
  it('exposes versioned bounds', () => {
    assert.equal(CHANGESET_VERSION, 1)
    assert.equal(MAX_GRAPH_FILES, 100)
    assert.equal(MAX_DEPTH, 4)
    assert.equal(MAX_ANALYSIS_BYTES, 256 * 1024)
  })

  it('detects direct and transitive dependencies with fingerprints', async () => {
    const root = await openWorkspace()

    await write(root, 'src/a.ts', "import { b } from './b'\nexport const a = b\n")
    await write(root, 'src/b.ts', "import { c } from './c'\nexport const b = c\n")
    await write(root, 'src/c.ts', 'export const c = 1\n')

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'src/a.ts', 'modify', {
        index: 0,
        content: "import { b } from './b'\nexport const a = b + 1\n",
      }),
      await fingerprinted(root, 'src/b.ts', 'modify', {
        index: 1,
        content: "import { c } from './c'\nexport const b = c + 1\n",
      }),
    ])

    assert.equal(manifest.version, 1)
    assert.equal(manifest.validation.ok, true)

    const byPath = new Map(manifest.targets.map((entry) => [entry.path, entry]))

    assert.equal(byPath.get('src/a.ts').imports[0].status, 'resolved')
    assert.equal(byPath.get('src/a.ts').imports[0].target, 'src/b.ts')
    assert.equal(byPath.get('src/a.ts').analysisSource, 'proposed')

    // One in-set edge: a imports b, so b applies first.
    assert.deepEqual(manifest.edges, [{ from: 0, to: 1, via: './b' }])
    assert.deepEqual(manifest.order, [1, 0])
    assert.match(manifest.orderReason, /dependencies first/)

    // Transitive external dependency c is fingerprinted, not parsed
    // for ordering.
    const external = manifest.externalDependencies.find(
      (entry) => entry.path === 'src/c.ts'
    )

    assert.ok(external)
    assert.equal(external.depth, 1)
    assert.equal(external.digest, digestOf('export const c = 1\n'))
    assert.deepEqual(manifest.reviewGroups, [
      { indexes: [0, 1], files: ['src/a.ts', 'src/b.ts'] },
    ])
  })

  it('parses import and export forms while ignoring comments and strings', async () => {
    const root = await openWorkspace()

    await write(root, 'lib/x.js', 'module.exports = 1\n')
    await write(root, 'lib/y.js', 'module.exports = 2\n')
    await write(root, 'lib/z.js', 'module.exports = 3\n')
    await write(root, 'lib/w.js', 'module.exports = 4\n')
    await write(root, 'lib/v.js', 'module.exports = 5\n')
    const content = [
      "import a from './x'",
      "import './y'",
      "import type { T } from './z'",
      "export * from './w'",
      "const v = require('./v')",
      "const lazy = import('./x')",
      "// import ghost from './ghost'",
      "/* export * from './ghost2' */",
      "const s = \"import fake from './fake'\"",
      'export const done = 1',
      '',
    ].join('\n')
    await write(root, 'lib/main.js', content)

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'lib/main.js', 'modify', {
        index: 0,
        content,
      }),
    ])

    const found = new Map(
      manifest.targets[0].imports.map((entry) => [entry.specifier, entry.status])
    )

    assert.equal(found.get('./x'), 'resolved')
    assert.equal(found.get('./y'), 'resolved')
    assert.equal(found.get('./z'), 'resolved')
    assert.equal(found.get('./w'), 'resolved')
    assert.equal(found.get('./v'), 'resolved')
    assert.ok(!found.has('./ghost'))
    assert.ok(!found.has('./ghost2'))
    assert.ok(!found.has('./fake'))
    assert.equal(manifest.validation.ok, true)
  })

  it('detects cycles and keeps plan order for cyclic members', async () => {
    const root = await openWorkspace()

    await write(root, 'cyc/a.ts', "import './b'\n")
    await write(root, 'cyc/b.ts', "import './a'\n")
    await write(root, 'cyc/plain.ts', 'export const p = 1\n')

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'cyc/a.ts', 'modify', {
        index: 0,
        content: "import './b'\nexport const a = 1\n",
      }),
      await fingerprinted(root, 'cyc/b.ts', 'modify', {
        index: 1,
        content: "import './a'\nexport const b = 1\n",
      }),
      await fingerprinted(root, 'cyc/plain.ts', 'modify', {
        index: 2,
        content: 'export const p = 2\n',
      }),
    ])

    assert.equal(manifest.cycles.length, 1)
    assert.deepEqual(manifest.order, [2, 0, 1])
    assert.match(manifest.orderReason, /cyclic member\(s\) keep plan order/)
    assert.ok(
      manifest.validation.warnings.some((entry) => /cycle\(s\)/.test(entry.reason))
    )
    // Cycles warn; they never block a change set.
    assert.equal(manifest.validation.ok, true)
  })

  it('reports unsupported, unresolved, unknown, and external references honestly', async () => {
    const root = await openWorkspace()

    await write(root, 'mix/app.ts', 'export const x = 1\n')
    await write(root, 'mix/tool.py', 'import os\n')

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'mix/app.ts', 'modify', {
        index: 0,
        content: [
          "import { missing } from './missing'",
          "import { alias } from '~/alias'",
          "import react from 'react'",
          'export const x = 2',
          '',
        ].join('\n'),
      }),
      await fingerprinted(root, 'mix/tool.py', 'modify', {
        index: 1,
        content: 'import os\n',
      }),
    ])

    const byPath = new Map(manifest.targets.map((entry) => [entry.path, entry]))
    const kinds = new Map(
      byPath.get('mix/app.ts').imports.map((entry) => [entry.specifier, entry.status])
    )

    assert.equal(kinds.get('./missing'), 'unresolved')
    assert.equal(kinds.get('~/alias'), 'unknown')
    assert.equal(kinds.get('react'), 'external')
    assert.equal(byPath.get('mix/tool.py').status, 'unsupported')
    assert.equal(byPath.get('mix/tool.py').language, 'unsupported')
    assert.equal(manifest.totalUnresolved, 1)
    assert.equal(manifest.totalUnknown, 1)
    assert.equal(manifest.totalExternals, 1)

    // Unknowns warn; they never block and never trigger partial work.
    assert.equal(manifest.validation.ok, true)
    assert.deepEqual(manifest.order, [0, 1])
    assert.ok(
      manifest.validation.warnings.some((entry) =>
        /unresolved and .* unknown/.test(entry.reason)
      )
    )
  })

  it('blocks missing and stale targets without throwing', async () => {
    const root = await openWorkspace()

    await write(root, 'stale/keep.ts', 'export const k = 1\n')
    await write(root, 'stale/gone.ts', 'export const g = 1\n')
    await write(root, 'stale/drift.ts', 'export const d = 1\n')

    const keep = await fingerprinted(root, 'stale/keep.ts', 'modify', {
      index: 0,
      content: 'export const k = 2\n',
    })
    const gone = await fingerprinted(root, 'stale/gone.ts', 'modify', {
      index: 1,
      content: 'export const g = 2\n',
    })
    const drift = await fingerprinted(root, 'stale/drift.ts', 'modify', {
      index: 2,
      content: 'export const d = 2\n',
    })

    await fs.unlink(path.join(root, 'stale/gone.ts'))
    await write(root, 'stale/drift.ts', 'export const d = 999\n')

    const manifest = await buildChangeSet([keep, gone, drift])

    assert.equal(manifest.validation.ok, false)

    const blockers = blockersByPath(manifest)

    assert.match(blockers.get('stale/gone.ts'), /missing/)
    assert.match(blockers.get('stale/drift.ts'), /stale/)
    assert.ok(!blockers.has('stale/keep.ts'))
  })

  it('detects conflicting edits to the same file', async () => {
    const root = await openWorkspace()

    await write(root, 'dup/file.ts', 'export const f = 1\n')

    const first = await fingerprinted(root, 'dup/file.ts', 'modify', {
      index: 0,
      content: 'export const f = 2\n',
    })
    const second = await fingerprinted(root, 'dup/file.ts', 'modify', {
      index: 1,
      content: 'export const f = 3\n',
    })

    const manifest = await buildChangeSet([first, second])

    assert.equal(manifest.validation.ok, false)
    assert.deepEqual(manifest.conflicts, [{ path: 'dup/file.ts', indexes: [0, 1] }])
    assert.ok(
      manifest.validation.blockers.some((entry) =>
        /Conflicting edits/.test(entry.reason)
      )
    )
  })

  it('labels blockers with machine-readable kinds', async () => {
    const root = await openWorkspace()

    await write(root, 'kinds/file.ts', 'export const f = 1\n')

    const conflicted = await buildChangeSet([
      await fingerprinted(root, 'kinds/file.ts', 'modify', {
        index: 0,
        content: 'export const f = 2\n',
      }),
      await fingerprinted(root, 'kinds/file.ts', 'modify', {
        index: 1,
        content: 'export const f = 3\n',
      }),
    ])

    assert.deepEqual(
      conflicted.validation.blockers.map((entry) => entry.kind),
      ['conflict']
    )

    const edit = await fingerprinted(root, 'kinds/file.ts', 'modify', {
      index: 0,
      content: 'export const f = 2\n',
    })

    await write(root, 'kinds/file.ts', 'export const f = 999\n')

    const stale = await buildChangeSet([edit])

    assert.deepEqual(
      stale.validation.blockers.map((entry) => entry.kind),
      ['freshness']
    )
  })

  it('detects create/modify conflicts on the same path', async () => {
    const root = await openWorkspace()

    const manifest = await buildChangeSet([
      {
        index: 0,
        path: 'fresh/new.ts',
        action: 'create',
        content: 'export const n = 1\n',
      },
      {
        index: 1,
        path: 'fresh/new.ts',
        action: 'create',
        content: 'export const n = 2\n',
      },
    ])

    assert.equal(manifest.validation.ok, false)
    assert.deepEqual(manifest.conflicts, [{ path: 'fresh/new.ts', indexes: [0, 1] }])
  })

  it('warns when a dependency changes after the baseline analysis', async () => {
    const root = await openWorkspace()

    await write(root, 'base/dep.ts', 'export const d = 1\n')
    await write(root, 'base/main.ts', "import './dep'\n")

    const edit = await fingerprinted(root, 'base/main.ts', 'modify', {
      index: 0,
      content: "import './dep'\nexport const m = 1\n",
    })

    const before = await buildChangeSet([edit])

    assert.equal(before.validation.ok, true)

    await write(root, 'base/dep.ts', 'export const d = 2\n')

    const after = await buildChangeSet([edit], { baseline: before })

    assert.ok(
      after.validation.warnings.some(
        (entry) =>
          entry.path === 'base/dep.ts' &&
          /changed since the previous analysis/.test(entry.reason)
      )
    )
    // Stale dependencies warn; only stale targets block.
    assert.equal(after.validation.ok, true)

    // A forged baseline degrades to no comparison, never an error.
    const forged = await buildChangeSet([edit], { baseline: { nope: true } })

    assert.equal(
      forged.validation.warnings.some((entry) => entry.path === 'base/dep.ts'),
      false
    )
  })

  it('blocks deletes that break dependents, inside and outside the set', async () => {
    const root = await openWorkspace()

    await write(root, 'del/shared.ts', 'export const s = 1\n')
    await write(root, 'del/user.ts', "import './shared'\n")
    await write(root, 'del/outsider.ts', "import './shared'\n")

    const internal = await buildChangeSet([
      await fingerprinted(root, 'del/shared.ts', 'delete', { index: 0 }),
      await fingerprinted(root, 'del/user.ts', 'modify', {
        index: 1,
        content: "import './shared'\nexport const u = 1\n",
      }),
    ])

    assert.equal(internal.validation.ok, false)
    assert.ok(
      internal.validation.blockers.some((entry) =>
        /change-set dependents/.test(entry.reason)
      )
    )

    const external = await buildChangeSet([
      await fingerprinted(root, 'del/shared.ts', 'delete', { index: 0 }),
    ])

    assert.equal(external.validation.ok, false)
    assert.ok(
      external.validation.blockers.some(
        (entry) =>
          /external importer/.test(entry.reason) &&
          entry.reason.includes('del/outsider.ts')
      )
    )
  })

  it('allows deletes with no importers', async () => {
    const root = await openWorkspace()

    await write(root, 'gone/old.ts', 'export const o = 1\n')
    await write(root, 'gone/keep.ts', 'export const k = 1\n')

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'gone/old.ts', 'delete', { index: 0 }),
    ])

    assert.equal(manifest.validation.ok, true)
    assert.equal(manifest.targets[0].action, 'delete')
  })

  it('keeps sparse plan indexes through ordering', async () => {
    const root = await openWorkspace()

    await write(root, 'sp/a.ts', "import './b'\n")
    await write(root, 'sp/b.ts', 'export const b = 1\n')

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'sp/a.ts', 'modify', {
        index: 2,
        content: "import './b'\nexport const a = 1\n",
      }),
      await fingerprinted(root, 'sp/b.ts', 'modify', {
        index: 5,
        content: 'export const b = 2\n',
      }),
    ])

    assert.deepEqual(manifest.order, [5, 2])
    assert.deepEqual(manifest.edges, [{ from: 2, to: 5, via: './b' }])
  })

  it('rejects malformed input fail-closed', async () => {
    await openWorkspace()

    await assert.rejects(() => buildChangeSet([]), /No edits were provided/)
    await assert.rejects(() => buildChangeSet('nope'), /No edits were provided/)
    await assert.rejects(
      () => buildChangeSet(new Array(21).fill({ path: 'x', action: 'modify' })),
      /At most 20 edits/
    )
    await assert.rejects(
      () => buildChangeSet([null]),
      /edits\[0\] is invalid/
    )
    await assert.rejects(
      () => buildChangeSet([{ path: 'x.ts', action: 'explode' }]),
      /edits\[0\].action is invalid/
    )
    await assert.rejects(
      () => buildChangeSet([{ path: '  ', action: 'modify' }]),
      /edits\[0\].path is invalid/
    )
    await assert.rejects(
      () =>
        buildChangeSet([
          { index: 0, path: 'a.ts', action: 'modify' },
          { index: 0, path: 'b.ts', action: 'modify' },
        ]),
      /Duplicate edit index/
    )
  })

  it('blocks traversal and outside-workspace targets without throwing', async () => {
    const root = await openWorkspace()

    await write(root, 'safe/ok.ts', 'export const o = 1\n')

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'safe/ok.ts', 'modify', {
        index: 0,
        content: 'export const o = 2\n',
      }),
      { index: 1, path: '../escape.ts', action: 'modify' },
      {
        index: 2,
        path: path.join(os.tmpdir(), 'kryom-outside.ts'),
        action: 'modify',
      },
    ])

    assert.equal(manifest.validation.ok, false)

    const blockers = blockersByPath(manifest)

    assert.match(blockers.get('../escape.ts') ?? '', /inaccessible|outside/i)
    assert.ok(
      manifest.validation.blockers.some((entry) => entry.index === 2)
    )

    const byIndex = new Map(manifest.targets.map((entry) => [entry.index, entry]))

    assert.equal(byIndex.get(1).status, 'inaccessible')
    assert.equal(byIndex.get(2).status, 'inaccessible')
    assert.equal(byIndex.get(0).status, 'analyzed')
  })

  it('never resolves imports into excluded directories', async () => {
    const root = await openWorkspace()

    await write(root, 'node_modules/pkg/index.js', 'module.exports = 1\n')
    await write(root, 'src/app.ts', 'export const a = 1\n')

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'src/app.ts', 'modify', {
        index: 0,
        content: "import { p } from '../node_modules/pkg'\nexport const a = 2\n",
      }),
    ])

    const [item] = manifest.targets[0].imports

    assert.equal(item.status, 'unknown')
    assert.match(item.reason, /excluded directory/)
    assert.equal(manifest.externalDependencies.length, 0)
    assert.equal(manifest.validation.ok, true)
  })

  it('caps traversal depth and file count with honest truncation', async () => {
    const root = await openWorkspace()

    // A six-deep chain: depth 1..4 analyze, depth 5+ cap out.
    await write(root, 'deep/entry.ts', "import './d1'\n")

    for (let level = 1; level <= 6; level += 1) {
      const next = level === 6 ? '' : `import './d${level + 1}'\n`

      await write(root, `deep/d${level}.ts`, `${next}export const v${level} = 1\n`)
    }

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'deep/entry.ts', 'modify', {
        index: 0,
        content: "import './d1'\nexport const e = 1\n",
      }),
    ])

    const depths = manifest.externalDependencies.map((entry) => entry.depth)

    assert.ok(depths.includes(1))
    assert.ok(depths.includes(4))
    assert.ok(!depths.some((depth) => depth > 5))
    assert.ok(
      manifest.externalDependencies.some(
        (entry) => entry.status === 'depth-capped'
      )
    )
    assert.equal(manifest.bounds.truncated, true)
    assert.ok(
      manifest.validation.warnings.some((entry) =>
        /hit its bounds/.test(entry.reason)
      )
    )
    // Truncation warns; it never blocks.
    assert.equal(manifest.validation.ok, true)
  })

  it('caps fan-out at the graph file bound', async () => {
    const root = await openWorkspace()

    const lines = []

    for (let leaf = 0; leaf < MAX_GRAPH_FILES + 20; leaf += 1) {
      await write(root, `wide/leaf${leaf}.ts`, `export const v = ${leaf}\n`)
      lines.push(`import './leaf${leaf}'`)
    }

    await write(root, 'wide/hub.ts', `${lines.join('\n')}\n`)

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'wide/hub.ts', 'modify', {
        index: 0,
        content: `${lines.join('\n')}\nexport const h = 1\n`,
      }),
    ])

    assert.ok(manifest.externalDependencies.length <= MAX_GRAPH_FILES)
    assert.equal(manifest.bounds.truncated, true)
    assert.equal(manifest.validation.ok, true)
  })

  it('marks oversized files as too-large instead of parsing partially', async () => {
    const root = await openWorkspace()

    await write(root, 'big/huge.ts', `export const h = 1\n${'// pad\n'.repeat(100)}`)
    const big = `import './huge'\n${'// pad\n'.repeat(40000)}\nexport const m = 1\n`

    await write(root, 'big/main.ts', "import './huge'\n")

    const manifest = await buildChangeSet([
      await fingerprinted(root, 'big/main.ts', 'modify', { index: 0, content: big }),
    ])

    assert.ok(
      Buffer.byteLength(big, 'utf8') > MAX_ANALYSIS_BYTES,
      'fixture must exceed the analysis cap'
    )
    assert.equal(manifest.targets[0].status, 'too-large')
    assert.deepEqual(manifest.targets[0].imports, [])
    assert.ok(
      manifest.validation.warnings.some((entry) =>
        /too-large/.test(entry.reason)
      )
    )
    assert.equal(manifest.validation.ok, true)
  })

  it('applies in manifest order with checkpoint undo as recovery', async () => {
    const root = await openWorkspace()

    await write(root, 'ord/base.ts', 'export const b = 1\n')
    await write(root, 'ord/top.ts', "import './base'\n")

    const { applyEdits } = require('./agent.service.cjs')
    const { undoCheckpoint } = require('./checkpoint-store.cjs')

    const edits = [
      {
        ...(await fingerprinted(root, 'ord/top.ts', 'modify')),
        index: 0,
        content: "import './base'\nexport const t = 2\n",
      },
      {
        ...(await fingerprinted(root, 'ord/base.ts', 'modify')),
        index: 1,
        content: 'export const b = 2\n',
      },
    ]

    const manifest = await buildChangeSet(edits)

    assert.equal(manifest.validation.ok, true)
    assert.deepEqual(manifest.order, [1, 0])

    const byIndex = new Map(edits.map((edit) => [edit.index, edit]))
    const ordered = manifest.order.map((index) => byIndex.get(index))
    const applied = await applyEdits({ edits: ordered, task: '3B.6 ordered apply' })

    assert.equal(applied.completed, true)
    assert.equal(applied.applied.length, 2)
    assert.ok(applied.checkpoint && 'id' in applied.checkpoint)

    // The checkpoint undoes the whole ordered batch.
    const undone = await undoCheckpoint(applied.checkpoint.id)

    assert.equal(undone.restored.length, 2)
    assert.equal(await fs.readFile(path.join(root, 'ord/base.ts'), 'utf8'), 'export const b = 1\n')
    assert.equal(await fs.readFile(path.join(root, 'ord/top.ts'), 'utf8'), "import './base'\n")
  })

  it('requires an open project', async () => {
    const { closeWorkspace } = require('../workspace/workspace.service.cjs')

    await openWorkspace()
    await closeWorkspace()

    await assert.rejects(
      () => buildChangeSet([{ path: 'x.ts', action: 'modify' }]),
      /Open a project folder first/
    )
  })
})
