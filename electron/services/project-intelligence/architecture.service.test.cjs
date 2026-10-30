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
  analyzeArchitecture,
} = require('./architecture.service.cjs')

async function openFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-arch-'))
  await fs.mkdir(path.join(root, 'src', 'services'), { recursive: true })
  await fs.mkdir(path.join(root, 'electron'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'demo',
      type: 'module',
      main: 'electron/main.cjs',
      scripts: { build: 'vite build' },
      dependencies: { react: '^19.0.0' },
    })
  )
  await fs.writeFile(path.join(root, 'tsconfig.json'), '{}\n')
  await fs.writeFile(path.join(root, 'electron', 'main.cjs'), 'console.log(1)\n')
  await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export {}\n')
  await fs.writeFile(
    path.join(root, 'src', 'services', 'auth.service.ts'),
    'export class AuthService {}\n'
  )
  await fs.writeFile(
    path.join(root, 'src', 'auth.service.test.ts'),
    'import "./auth.service"\n'
  )
  await setWorkspaceRoot(root)
  await refreshIndex()

  return root
}

describe('architecture', () => {
  it('detects languages, frameworks, configs, and entry points', async () => {
    await openFixture()

    const result = await analyzeArchitecture()

    assert.equal(result.primaryLanguage, 'typescript')
    assert.ok(result.frameworks.includes('react'))
    assert.ok(result.configs.includes('package.json'))
    assert.ok(result.configs.includes('tsconfig.json'))
    assert.ok(
      result.entryPoints.some((entry) => entry.path === 'electron/main.cjs')
    )
    assert.ok(result.entryPoints.some((entry) => entry.path === 'src/main.ts'))
  })

  it('lists modules, services, boundaries, and conventions with evidence', async () => {
    await openFixture()

    const result = await analyzeArchitecture()
    const moduleNames = result.modules.map((entry) => entry.name)

    assert.ok(moduleNames.includes('src'))
    assert.ok(moduleNames.includes('electron'))
    assert.ok(result.services.some((entry) => entry.includes('auth.service.ts')))
    assert.ok(result.boundaries.length >= 3)
    assert.ok(
      result.boundaries.every((entry) => entry.evidence && entry.detail)
    )
    assert.ok(
      result.conventions.some((entry) => entry.name === 'ECMAScript modules')
    )
  })

  it('excludes files changed or deleted after indexing', async () => {
    const root = await openFixture()
    const before = await analyzeArchitecture()

    assert.equal(before.staleFiles, 0)

    await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const x = 1\n')
    await fs.unlink(path.join(root, 'src', 'services', 'auth.service.ts'))

    const after = await analyzeArchitecture()

    assert.ok(after.staleFiles >= 2)
    assert.ok(after.stale.some((entry) => entry.path.endsWith('main.ts')))
    assert.ok(after.surveyed < before.surveyed)
  })

  it('requires a fresh index', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-arch-empty-'))

    await setWorkspaceRoot(root)
    await assert.rejects(() => analyzeArchitecture(), /No code index/)
  })
})
