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
} = require('./code-index.service.cjs')
const {
  searchProject,
  parseQuery,
} = require('./semantic-search.service.cjs')

async function openFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-search-'))
  await fs.mkdir(path.join(root, 'src', 'auth'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'src', 'auth', 'login.ts'),
    'export class AuthService {\n  login(user: string) {\n    return authenticate(user)\n  }\n}\n'
  )
  await fs.writeFile(
    path.join(root, 'src', 'auth', 'password.ts'),
    'export function authenticate(user: string) {\n  return user.length > 0\n}\n'
  )
  await fs.writeFile(
    path.join(root, 'src', 'terminal-runner.ts'),
    'export function runTerminalCommand(cmd: string) {\n  return cmd\n}\n'
  )
  await setWorkspaceRoot(root)
  await refreshIndex()

  return root
}

describe('semantic-search', () => {
  it('parses intent: stop words removed, hints and phrases kept', async () => {
    const parsed = parseQuery('Find where "user login" is implemented symbol:AuthService file:auth')

    assert.ok(!parsed.tokens.includes('where'))
    assert.deepEqual(parsed.phrases, ['user login'])
    assert.deepEqual(parsed.symbolHints, ['authservice'])
    assert.deepEqual(parsed.fileHints, ['auth'])
  })

  it('finds authentication by intent with explained results', async () => {
    await openFixture()

    const result = await searchProject('where is authentication implemented')

    assert.ok(result.results.length > 0)
    assert.ok(result.results.some((entry) => entry.file.includes('auth')))
    assert.ok(result.results.every((entry) => entry.why && entry.excerpt !== undefined))
    assert.ok(result.results.every((entry) => typeof entry.score === 'number'))
    assert.ok(result.method.includes('Deterministic'))
  })

  it('ranks symbol matches above plain text', async () => {
    await openFixture()

    const result = await searchProject('symbol:AuthService')
    const kinds = result.results.map((entry) => entry.kind)

    assert.ok(kinds.includes('symbol'))
    assert.equal(result.results[0].kind, 'symbol')
  })

  it('matches exact phrases', async () => {
    await openFixture()

    const result = await searchProject('"runTerminalCommand"')

    assert.ok(result.results.some((entry) => entry.kind === 'exact'))
  })

  it('matches file structure for terminal execution code', async () => {
    await openFixture()

    const result = await searchProject('terminal execution')

    assert.ok(
      result.results.some((entry) => entry.file.includes('terminal-runner'))
    )
  })

  it('rejects empty queries and reports stale files', async () => {
    const root = await openFixture()

    await assert.rejects(() => searchProject('   '), /Enter a search query/)
    await assert.rejects(() => searchProject('the and of'), /no searchable terms/)

    await fs.writeFile(path.join(root, 'src', 'auth', 'login.ts'), 'stale\n')

    const result = await searchProject('authentication')

    assert.ok(result.stale.some((entry) => entry.path.includes('login.ts')))
    assert.ok(!result.results.some((entry) => entry.file.includes('login.ts')))
  })
})
