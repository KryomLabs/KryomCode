const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  validateTemplateManifest,
  listTemplates,
  getTemplate,
  previewGeneration,
  generateTemplate,
} = require('./template-engine.cjs')

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-tpl-'))
}

describe('template-engine', () => {
  it('validates manifests strictly', () => {
    assert.throws(() => validateTemplateManifest(null), /object is required/)
    assert.throws(
      () => validateTemplateManifest({ templateVersion: 1, id: 'Bad!', version: '1.0.0' }),
      /"id"/
    )
    assert.throws(
      () =>
        validateTemplateManifest({
          templateVersion: 1,
          id: 'ok-id',
          version: '1.0.0',
          variables: [{ name: 'bad-name!' }],
        }),
      /bad name/
    )
  })

  it('ships three working builtin templates', async () => {
    const base = await tempBase()
    const listed = await listTemplates({ baseDir: base })
    const ids = listed.templates.map((entry) => entry.id)

    assert.ok(ids.includes('node-typescript'))
    assert.ok(ids.includes('react-vite'))
    assert.ok(ids.includes('basic-web'))
    assert.deepEqual(listed.corrupt, [])

    const node = await getTemplate('node-typescript', { baseDir: base })

    assert.ok(node.files.includes('package.json'))
    assert.ok(node.files.includes('src/index.ts'))
  })

  it('generates projects with substituted variables', async () => {
    const base = await tempBase()
    const destination = path.join(base, 'my-app')

    const result = await generateTemplate({
      templateId: 'node-typescript',
      destination,
      variables: { project_name: 'demo-app', description: 'Demo.' },
      baseDir: base,
    })

    assert.equal(result.destination, destination)
    assert.deepEqual(result.overwritten, [])

    const pkg = JSON.parse(await fs.readFile(path.join(destination, 'package.json'), 'utf8'))

    assert.equal(pkg.name, 'demo-app')

    const index = await fs.readFile(path.join(destination, 'src', 'index.ts'), 'utf8')

    assert.ok(index.includes('demo-app'))
    assert.ok(result.setup.commands.includes('npm install'))
  })

  it('protects existing directories and previews collisions', async () => {
    const base = await tempBase()
    const destination = path.join(base, 'taken')

    await fs.mkdir(destination, { recursive: true })
    await fs.writeFile(path.join(destination, 'package.json'), '{"user":true}\n')

    const preview = await previewGeneration({
      templateId: 'basic-web',
      destination,
      variables: { project_name: 'x' },
      baseDir: base,
    })

    assert.equal(preview.empty, false)
    assert.deepEqual(preview.collisions, [])

    const takenPreview = await previewGeneration({
      templateId: 'node-typescript',
      destination,
      variables: { project_name: 'x' },
      baseDir: base,
    })

    assert.deepEqual(takenPreview.collisions, ['package.json'])

    await assert.rejects(
      () =>
        generateTemplate({
          templateId: 'node-typescript',
          destination,
          variables: { project_name: 'x' },
          baseDir: base,
        }),
      /conflicting file/
    )

    // User files untouched.
    assert.equal(
      await fs.readFile(path.join(destination, 'package.json'), 'utf8'),
      '{"user":true}\n'
    )

    const confirmed = await generateTemplate({
      templateId: 'node-typescript',
      destination,
      variables: { project_name: 'x' },
      confirmed: true,
      baseDir: base,
    })

    assert.deepEqual(confirmed.overwritten, ['package.json'])
  })

  it('rejects traversal, bad variables, and missing parents', async () => {
    const base = await tempBase()

    await assert.rejects(
      () =>
        generateTemplate({
          templateId: 'node-typescript',
          destination: path.join(base, 'x'),
          variables: { project_name: 'Bad Name!' },
          baseDir: base,
        }),
      /required format/
    )

    await assert.rejects(
      () =>
        generateTemplate({
          templateId: 'node-typescript',
          destination: 'relative/path',
          variables: { project_name: 'x' },
          baseDir: base,
        }),
      /absolute path/
    )

    await assert.rejects(
      () =>
        generateTemplate({
          templateId: 'node-typescript',
          destination: path.join(base, 'missing-parent', 'x'),
          variables: { project_name: 'x' },
          baseDir: base,
        }),
      /parent directory does not exist/
    )
  })

  it('rejects invalid user templates without breaking builtins', async () => {
    const base = await tempBase()
    const dir = path.join(base, 'kryomcode-templates', 'broken')

    await fs.mkdir(path.join(dir, 'files'), { recursive: true })
    await fs.writeFile(path.join(dir, 'template.json'), '{nope')

    const listed = await listTemplates({ baseDir: base })

    assert.ok(listed.templates.some((entry) => entry.id === 'basic-web'))
    assert.ok(listed.corrupt.some((entry) => entry.dir === 'broken'))
  })
})
