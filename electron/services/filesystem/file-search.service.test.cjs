const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const { searchFiles } = require('./file-search.service.cjs')

async function openFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-search-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'app.ts'), 'hello world\nsecond line\n')
  await fs.writeFile(path.join(root, 'src', 'util.ts'), 'nothing here\n')
  await fs.writeFile(path.join(root, 'README.md'), 'say hello again\n')
  await fs.writeFile(path.join(root, 'node_modules', 'dep', 'skip.js'), 'hello hidden\n')
  await setWorkspaceRoot(root)

  return root
}

describe('file-search.service', () => {
  it('requires an open workspace', async () => {
    await assert.rejects(
      () => searchFiles('x', { mode: 'name' }),
      /Open a project folder/
    )
  })

  it('finds files by name', async () => {
    await openFixture()

    const result = await searchFiles('app', { mode: 'name' })
    const names = result.matches.map((match) => match.relativePath)

    assert.ok(names.some((name) => name.endsWith('app.ts')))
    assert.ok(!names.some((name) => name.includes('node_modules')))
  })

  it('greps content with line numbers', async () => {
    await openFixture()

    const result = await searchFiles('hello', { mode: 'content' })

    assert.equal(result.matches.length, 2)
    assert.ok(
      result.matches.every((match) => typeof match.line === 'number')
    )
    assert.ok(
      result.matches.every((match) => !match.relativePath.includes('node_modules'))
    )
  })

  it('rejects invalid queries and modes', async () => {
    await openFixture()

    await assert.rejects(() => searchFiles('', { mode: 'name' }), /search text/)
    await assert.rejects(
      () => searchFiles('x', { mode: 'fuzzy' }),
      /mode/
    )
  })
})
