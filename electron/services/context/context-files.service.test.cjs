const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  MAX_FILE_BYTES,
  MAX_EXCERPT_CHARS,
  readContextFile,
} = require('./context-files.service.cjs')

describe('context-files', () => {
  it('reads bounded excerpts of user-picked files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-context-'))
    const file = path.join(dir, 'notes.txt')

    await fs.writeFile(file, 'line one\nline two\n', 'utf8')

    const result = await readContextFile(file)

    assert.equal(result.name, 'notes.txt')
    assert.equal(result.chars, 18)
    assert.equal(result.truncated, false)
    assert.equal(result.excerpt, 'line one\nline two\n')
  })

  it('truncates long files with an explicit flag', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-context-'))
    const file = path.join(dir, 'big.txt')

    await fs.writeFile(file, 'x'.repeat(MAX_EXCERPT_CHARS + 500), 'utf8')

    const result = await readContextFile(file)

    assert.equal(result.truncated, true)
    assert.equal(result.excerpt.length, MAX_EXCERPT_CHARS)
  })

  it('rejects missing files, directories, binaries, and huge files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-context-'))

    await assert.rejects(
      () => readContextFile(path.join(dir, 'missing.txt')),
      /not found/
    )
    await assert.rejects(() => readContextFile(dir), /not a file/)
    await assert.rejects(() => readContextFile(''), /Invalid file path/)
    await assert.rejects(() => readContextFile(null), /Invalid file path/)

    const binary = path.join(dir, 'blob.bin')
    await fs.writeFile(binary, Buffer.from([0x89, 0x50, 0x00, 0x01]))

    await assert.rejects(() => readContextFile(binary), /binary/)

    const huge = path.join(dir, 'huge.txt')
    const handle = await fs.open(huge, 'w')
    await handle.truncate(MAX_FILE_BYTES + 1)
    await handle.close()

    await assert.rejects(() => readContextFile(huge), /larger than/)
  })
})
