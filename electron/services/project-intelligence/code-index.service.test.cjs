const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  refreshIndex,
  getIndexStatus,
  checkIndexFreshness,
  selectContext,
} = require('./code-index.service.cjs')

async function openFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-codeindex-'))
  await fs.mkdir(path.join(root, 'src', 'auth'), { recursive: true })
  await fs.mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'src', 'auth', 'login.ts'),
    'export function login() { return true }\n'
  )
  await fs.writeFile(
    path.join(root, 'src', 'auth', 'session.ts'),
    'export function session() { return true }\n'
  )
  await fs.writeFile(path.join(root, 'src', 'main.ts'), 'import "./auth/login"\n')
  await fs.writeFile(path.join(root, 'node_modules', 'dep', 'x.js'), 'x\n')
  await fs.writeFile(path.join(root, '.env'), 'MODEL_API_KEY=secret\n')
  await setWorkspaceRoot(root)

  return root
}

describe('code-index', () => {
  it('indexes project files and skips dependencies and secrets', async () => {
    await openFixture()

    const report = await refreshIndex()
    const status = await getIndexStatus()

    assert.equal(status.indexed, true)
    assert.equal(status.total, 3)
    assert.equal(report.added.length, 3)
    assert.equal(report.truncated, false)
  })

  it('refreshes incrementally and reports what changed', async () => {
    const root = await openFixture()

    await refreshIndex()
    await fs.writeFile(path.join(root, 'src', 'main.ts'), 'import "./auth/session"\n')
    await fs.writeFile(path.join(root, 'src', 'extra.ts'), 'export const x = 1\n')

    const report = await refreshIndex()

    assert.deepEqual(report.changed, ['src/main.ts'])
    assert.deepEqual(report.added, ['src/extra.ts'])
    assert.equal(report.unchanged, 2)
  })

  it('detects stale and missing files instead of trusting the index', async () => {
    const root = await openFixture()

    await refreshIndex()
    await fs.writeFile(path.join(root, 'src', 'main.ts'), 'changed\n')
    await fs.unlink(path.join(root, 'src', 'extra-missing.ts')).catch(() => {})
    await fs.unlink(path.join(root, 'src', 'auth', 'session.ts'))

    const result = await checkIndexFreshness([
      'src/main.ts',
      'src/auth/session.ts',
      'src/auth/login.ts',
      'src/never-indexed.ts',
    ])

    const byPath = Object.fromEntries(
      result.entries.map((entry) => [entry.path, entry.status])
    )

    assert.equal(result.indexed, true)
    assert.equal(result.allCurrent, false)
    assert.equal(byPath['src/main.ts'], 'stale')
    assert.equal(byPath['src/auth/session.ts'], 'missing')
    assert.equal(byPath['src/auth/login.ts'], 'current')
    assert.equal(byPath['src/never-indexed.ts'], 'unindexed')
  })

  it('selects ranked context inside an explicit budget', async () => {
    await openFixture()
    await refreshIndex()

    const result = await selectContext({ query: 'auth login', maxChars: 4000 })

    assert.ok(result.usedChars <= result.budget)
    assert.ok(result.selected.length > 0)
    assert.ok(result.selected[0].path.includes('auth'))
    assert.ok(Array.isArray(result.stale))
  })

  it('excludes stale files from selected context', async () => {
    const root = await openFixture()

    await refreshIndex()
    await fs.writeFile(path.join(root, 'src', 'auth', 'login.ts'), 'stale\n')

    const result = await selectContext({})

    assert.ok(!result.selected.some((entry) => entry.path === 'src/auth/login.ts'))
    assert.ok(result.stale.some((entry) => entry.path === 'src/auth/login.ts'))
  })

  it('deduplicates identical content', async () => {
    const root = await openFixture()

    await fs.writeFile(path.join(root, 'src', 'copy.ts'), 'export const x = 1\n')
    await fs.writeFile(path.join(root, 'src', 'copy2.ts'), 'export const x = 1\n')
    await refreshIndex()

    const result = await selectContext({ maxChars: 24000 })
    const copies = result.selected.filter((entry) =>
      entry.path === 'src/copy.ts' || entry.path === 'src/copy2.ts'
    )

    assert.equal(copies.length, 1)
    assert.ok(
      result.skipped.some((entry) => entry.reason.includes('Duplicate'))
    )
  })
})
