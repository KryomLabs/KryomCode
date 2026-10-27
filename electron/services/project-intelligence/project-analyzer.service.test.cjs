const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  getWorkspaceSummary,
  buildWorkspaceContext,
} = require('./project-analyzer.service.cjs')

async function openFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-intel-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true })
  await fs.mkdir(path.join(root, 'dist'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'demo',
      scripts: { build: 'vite build', test: 'node --test' },
      dependencies: { react: '^19.0.0', vite: '^6.0.0' },
      devDependencies: { typescript: '^5.7.0' },
    })
  )
  await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export {};\n')
  await fs.writeFile(path.join(root, 'node_modules', 'dep', 'x.js'), 'x\n')
  await fs.writeFile(path.join(root, 'dist', 'out.js'), 'x\n')
  await fs.writeFile(path.join(root, '.env'), 'MODEL_API_KEY=secret\n')
  await setWorkspaceRoot(root)

  return root
}

describe('project-intelligence', () => {
  it('summarizes project type, scripts, and frameworks', async () => {
    await openFixture()

    const summary = await getWorkspaceSummary()

    assert.equal(summary.projectType, 'node')
    assert.ok(summary.frameworks.includes('react'))
    assert.ok(summary.frameworks.includes('vite'))
    assert.ok(summary.frameworks.includes('typescript'))
    assert.deepEqual(Object.keys(summary.scripts).sort(), ['build', 'test'])
    assert.ok(summary.configs.includes('package.json'))
  })

  it('excludes dependencies, build output, and secrets from the index', async () => {
    await openFixture()

    const summary = await getWorkspaceSummary()
    const names = summary.fileIndex.map((entry) => entry.relativePath)

    assert.ok(names.some((name) => name.endsWith('index.ts')))
    assert.ok(!names.some((name) => name.includes('node_modules')))
    assert.ok(!names.some((name) => name.startsWith('dist')))
    assert.ok(!names.some((name) => name.startsWith('.env')))
  })

  it('builds bounded context without secret contents', async () => {
    await openFixture()

    const { context, projectType } = await buildWorkspaceContext({ maxChars: 1000 })

    assert.equal(projectType, 'node')
    assert.ok(context.length <= 1000)
    assert.ok(context.includes('node'))
    assert.ok(!context.includes('secret'))
  })
})
