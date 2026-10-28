const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  createSession,
  readSession,
  writeSession,
} = require('../research/session-store.cjs')
const {
  TEMPLATES,
  exportBriefDocx,
  exportTextDocx,
  importDocxFile,
} = require('./document.service.cjs')

async function openWorkspace(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  await setWorkspaceRoot(dir)

  return dir
}

function isZip(buffer) {
  return buffer[0] === 0x50 && buffer[1] === 0x4b
}

describe('document.service', () => {
  it('exposes exactly the supported templates', () => {
    assert.deepEqual(TEMPLATES, ['report', 'technical'])
  })

  it('exports text to a Word-readable file with formatting preserved', async () => {
    const dir = await openWorkspace('kryom-docx-')
    const markdown = [
      '# Warehouse routing',
      '',
      'Key claim with citation [1] and **bold** plus `code`.',
      '',
      '- first item',
      '- second item',
      '',
      '1. ordered one',
      '2. ordered two',
      '',
      '> a quoted note',
      '',
      '```',
      'const x = 1',
      '```',
    ].join('\n')

    for (const template of TEMPLATES) {
      const exported = await exportTextDocx('Routing notes', markdown, template)

      assert.ok(isZip(exported.buffer))
      assert.ok(exported.bytes > 1000)
      assert.match(exported.fileName, /\.docx$/)

      const filePath = path.join(dir, `roundtrip-${template}.docx`)
      await fs.writeFile(filePath, exported.buffer)

      const imported = await importDocxFile(filePath)

      assert.equal(imported.truncated, false)
      assert.match(imported.text, /Warehouse routing/)
      assert.match(imported.text, /citation \[1\]/)
      assert.match(imported.text, /first item/)
      assert.match(imported.text, /ordered two/)
      assert.match(imported.text, /const x = 1/)
    }
  })

  it('exports a research brief with a numbered bibliography', async () => {
    const dir = await openWorkspace('kryom-brief-')
    const session = await createSession('Compare routing algorithms')

    session.brief.markdown =
      '# Findings\n\nA* beats Dijkstra here [1].\n\n## Limits\n\nSmall sample.'
    session.brief.version = 1
    session.brief.generatedAt = new Date().toISOString()
    session.sources = [
      {
        title: 'Routing at scale',
        authors: ['Ada Lovelace'],
        venue: 'J. Logistics',
        publishedAt: '2024-05-01',
        url: 'https://example.com/routing',
      },
    ]
    await writeSession(session)

    const stored = await readSession(session.id)
    assert.equal(stored.brief.version, 1)

    const exported = await exportBriefDocx(session.id, 'report')

    assert.ok(isZip(exported.buffer))
    assert.match(exported.fileName, /^brief-.*\.docx$/)

    const filePath = path.join(dir, exported.fileName)
    await fs.writeFile(filePath, exported.buffer)

    const imported = await importDocxFile(filePath)

    assert.match(imported.text, /Research Brief/)
    assert.match(imported.text, /A\* beats Dijkstra here \[1\]/)
    assert.match(imported.text, /not a peer-reviewed paper/)
    assert.match(imported.text, /Routing at scale/)
    assert.match(imported.text, /https:\/\/example\.com\/routing/)
  })

  it('refuses brief export before a brief exists', async () => {
    await openWorkspace('kryom-nobrief-')
    const session = await createSession('Unresearched topic')

    await assert.rejects(
      () => exportBriefDocx(session.id, 'report'),
      /no generated brief/
    )
    await assert.rejects(
      () => exportBriefDocx('missing-id', 'report'),
      /not found/
    )
    await assert.rejects(
      () => exportBriefDocx(session.id, 'fancy'),
      /Invalid template/
    )
  })

  it('validates text export inputs', async () => {
    await assert.rejects(() => exportTextDocx('', 'x', 'report'), /Invalid title/)
    await assert.rejects(
      () => exportTextDocx('t', '   ', 'report'),
      /nothing to export/
    )
    await assert.rejects(
      () => exportTextDocx('t', 'x', 'fancy'),
      /Invalid template/
    )
    await assert.rejects(
      () => exportTextDocx('t', 'x'.repeat(200_001), 'report'),
      /exceeds/
    )
  })

  it('rejects non-docx, missing, oversized, and corrupt imports', async () => {
    const dir = await openWorkspace('kryom-import-')

    await assert.rejects(
      () => importDocxFile(path.join(dir, 'notes.txt')),
      /Only \.docx/
    )
    await assert.rejects(
      () => importDocxFile(path.join(dir, 'missing.docx')),
      /does not exist/
    )

    const fake = path.join(dir, 'fake.docx')
    await fs.writeFile(fake, 'not a zip file')

    await assert.rejects(() => importDocxFile(fake), /Could not read/)
  })
})
