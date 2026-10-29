const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
  closeWorkspace,
} = require('../workspace/workspace.service.cjs')
const {
  gatherSourceContext,
  MAX_CONTEXT_FILES,
  MAX_CONTEXT_FILE_BYTES,
  MAX_CONTEXT_TOTAL_BYTES,
} = require('./context.service.cjs')

async function openWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-ctx-'))
  await setWorkspaceRoot(dir)

  return dir
}

async function writeFile(root, relative, content) {
  const full = path.join(root, relative)

  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content)

  return full
}

describe('context.service', () => {
  it('gathers selected files with contents and byte counts', async () => {
    const root = await openWorkspace()

    try {
      await writeFile(root, 'src/app.ts', 'export const app = 1;\n')
      await writeFile(root, 'src/util.ts', 'export const util = 2;\n')

      const gathered = await gatherSourceContext([
        path.join(root, 'src', 'app.ts'),
        'src/util.ts',
      ])

      assert.equal(gathered.files.length, 2)
      assert.equal(gathered.excluded.length, 0)
      assert.equal(gathered.files[0].relativePath, path.join('src', 'app.ts'))
      assert.equal(gathered.files[0].content, 'export const app = 1;\n')
      assert.equal(
        gathered.totalBytes,
        gathered.files[0].bytes + gathered.files[1].bytes
      )

      // Duplicates resolve once.
      const deduped = await gatherSourceContext([
        'src/app.ts',
        path.join(root, 'src', 'app.ts'),
      ])

      assert.equal(deduped.files.length, 1)
    } finally {
      await closeWorkspace()
    }
  })

  it('excludes sensitive, private, and generated paths with reasons', async () => {
    const root = await openWorkspace()

    try {
      const sensitive = [
        '.env',
        '.env.local',
        '.kryom/chat.json',
        '.git/config',
        'node_modules/pkg/index.js',
        'dist/bundle.js',
        'keys/deploy.pem',
        'notes/secret-plan.md',
        'config/credentials.json',
      ]

      for (const relative of sensitive) {
        await writeFile(root, relative, 'sensitive-content-marker\n')
      }

      // Binary and oversized files are excluded, never truncated.
      await writeFile(root, 'bin/blob.dat', Buffer.from([0x89, 0x00, 0x01]))
      await writeFile(
        root,
        'big/huge.ts',
        `export const x = 1;\n${'y'.repeat(MAX_CONTEXT_FILE_BYTES)}`
      )

      const gathered = await gatherSourceContext([
        ...sensitive,
        'bin/blob.dat',
        'big/huge.ts',
      ])

      assert.equal(gathered.files.length, 0)
      assert.equal(gathered.excluded.length, sensitive.length + 2)

      const serialized = JSON.stringify(gathered)

      assert.doesNotMatch(serialized, /sensitive-content-marker/)
      assert.ok(
        gathered.excluded.every((entry) => entry.reason && entry.reason.length > 0)
      )
    } finally {
      await closeWorkspace()
    }
  })

  it('rejects traversal, outside roots, and symlinks loudly', async () => {
    const root = await openWorkspace()

    try {
      await writeFile(root, 'src/ok.ts', 'ok\n')

      await assert.rejects(
        () => gatherSourceContext([path.join(root, '..', 'evil.ts')]),
        /outside/
      )

      if (process.platform === 'win32') {
        await assert.rejects(
          () => gatherSourceContext(['..\\evil.ts']),
          /outside/
        )
      }

      await assert.rejects(
        () => gatherSourceContext([os.tmpdir()]),
        /outside/
      )

      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-ctx-out-'))
      const link = path.join(root, 'src', 'linked.ts')

      try {
        await fs.symlink(path.join(outside, 'x.ts'), link)
      } catch {
        return
      }

      await assert.rejects(
        () => gatherSourceContext([link]),
        /Symbolic links|does not exist/
      )
    } finally {
      await closeWorkspace()
    }
  })

  it('enforces file-count and total-byte budgets with reasons', async () => {
    const root = await openWorkspace()

    try {
      const names = []

      for (let index = 0; index < MAX_CONTEXT_FILES + 2; index += 1) {
        const name = `src/f${index}.ts`

        await writeFile(root, name, `export const f${index} = ${index};\n`)
        names.push(name)
      }

      const capped = await gatherSourceContext(names)

      assert.equal(capped.files.length, MAX_CONTEXT_FILES)
      assert.equal(capped.excluded.length, 2)
      assert.match(capped.excluded[0].reason, /file limit/)

      // Total budget: files just under the per-file cap exhaust the
      // total before the count limit is reached.
      const chunk = `export const big = 1;\n${'z'.repeat(MAX_CONTEXT_FILE_BYTES - 100)}`
      const bigNames = []

      for (let index = 0; index < 4; index += 1) {
        const name = `big/b${index}.ts`

        await writeFile(root, name, chunk)
        bigNames.push(name)
      }

      const budgeted = await gatherSourceContext(bigNames)
      const includedBytes = budgeted.files.reduce((sum, file) => sum + file.bytes, 0)

      assert.ok(includedBytes <= MAX_CONTEXT_TOTAL_BYTES)
      assert.ok(budgeted.excluded.length >= 1)
      assert.match(
        budgeted.excluded.map((entry) => entry.reason).join(' '),
        /budget exceeded/
      )

      // Included contents are complete, never truncated heads.
      for (const file of budgeted.files) {
        assert.equal(file.content.length, file.bytes)
      }
    } finally {
      await closeWorkspace()
    }
  })

  it('reports missing files and bad input honestly', async () => {
    const root = await openWorkspace()

    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true })

      const missing = await gatherSourceContext(['src/gone.ts'])

      assert.equal(missing.files.length, 0)
      assert.deepEqual(missing.excluded, [
        { path: 'src/gone.ts', reason: 'file not found' },
      ])

      const directory = await gatherSourceContext(['src'])

      assert.equal(directory.files.length, 0)
      assert.match(directory.excluded[0].reason, /not a regular file/)

      assert.deepEqual(await gatherSourceContext(undefined), {
        files: [],
        excluded: [],
        totalBytes: 0,
      })
      assert.deepEqual(await gatherSourceContext([]), {
        files: [],
        excluded: [],
        totalBytes: 0,
      })

      await assert.rejects(
        () => gatherSourceContext('src/x.ts'),
        /array is required/
      )
      await assert.rejects(
        () => gatherSourceContext(['src/x.ts', 42]),
        /must be text/
      )
    } finally {
      await closeWorkspace()
    }
  })

  it('requires an open workspace', async () => {
    await closeWorkspace()

    await assert.rejects(
      () => gatherSourceContext(['src/x.ts']),
      /Open a project folder/
    )
  })
})
