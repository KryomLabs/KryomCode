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
  indexSymbols,
  findSymbol,
  findReferences,
} = require('./symbol-index.service.cjs')

async function openFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-symbols-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'src', 'auth.ts'),
    [
      'export class AuthService {',
      '  login() { return true }',
      '}',
      '',
      'export function hashPassword(input: string) {',
      '  return input',
      '}',
      '',
      'export interface Credentials { user: string }',
      'export type Token = string',
      'export const VERSION = 1',
      '// export class FakeInComment {}',
      'const text = "class FakeInString {}"',
      '',
    ].join('\n')
  )
  await fs.writeFile(
    path.join(root, 'src', 'app.ts'),
    [
      'import { AuthService, hashPassword } from "./auth"',
      'const service = new AuthService()',
      'service.login()',
      'hashPassword("x")',
      '',
    ].join('\n')
  )
  await fs.writeFile(path.join(root, 'notes.md'), '# notes\n')
  await setWorkspaceRoot(root)
  await refreshIndex()

  return root
}

describe('symbol-index', () => {
  it('extracts classes, functions, interfaces, types, and variables', async () => {
    await openFixture()

    const indexed = await indexSymbols({ paths: ['src/auth.ts'] })
    const found = indexed.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)

    assert.ok(found.includes('class:AuthService'))
    assert.ok(found.includes('function:hashPassword'))
    assert.ok(found.includes('interface:Credentials'))
    assert.ok(found.includes('type:Token'))
    assert.ok(found.includes('variable:VERSION'))
    assert.equal(indexed.approximate, true)
  })

  it('ignores symbols inside comments and strings', async () => {
    await openFixture()

    const indexed = await indexSymbols({ paths: ['src/auth.ts'] })
    const names = indexed.symbols.map((symbol) => symbol.name)

    assert.ok(!names.includes('FakeInComment'))
    assert.ok(!names.includes('FakeInString'))
  })

  it('records imports with specifiers and line numbers', async () => {
    await openFixture()

    const indexed = await indexSymbols({ paths: ['src/app.ts'] })

    assert.equal(indexed.imports.length, 1)
    assert.equal(indexed.imports[0].specifier, './auth')
    assert.equal(indexed.imports[0].line, 1)
    assert.ok(indexed.imports[0].names.includes('AuthService'))
  })

  it('skips unsupported languages with a reason', async () => {
    await openFixture()

    const indexed = await indexSymbols({ paths: ['notes.md', 'src/auth.ts'] })

    assert.ok(indexed.scanned.includes('src/auth.ts'))
    assert.ok(indexed.skipped.some((entry) => entry.path === 'notes.md'))
  })

  it('finds definitions and cross-file references', async () => {
    await openFixture()

    const symbol = await findSymbol('AuthService')

    assert.equal(symbol.definitions.length, 1)
    assert.equal(symbol.definitions[0].file, 'src/auth.ts')

    const refs = await findReferences('hashPassword')
    const files = refs.references.map((entry) => entry.file)

    assert.ok(files.includes('src/auth.ts'))
    assert.ok(files.includes('src/app.ts'))
    assert.ok(refs.definitions.length >= 1)
  })

  it('reports stale files instead of scanning them', async () => {
    const root = await openFixture()

    await fs.writeFile(path.join(root, 'src', 'auth.ts'), 'changed\n')

    const indexed = await indexSymbols({ paths: ['src/auth.ts'] })

    assert.equal(indexed.scanned.length, 0)
    assert.ok(indexed.stale.some((entry) => entry.path === 'src/auth.ts'))
  })
})
