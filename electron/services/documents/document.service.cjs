// Local Word-compatible document workflows. Research briefs and text
// exports become real .docx files via the `docx` library; imports read
// back through `mammoth`. Everything runs locally: no cloud calls,
// no credentials, no fabricated content.
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} = require('docx')
const mammoth = require('mammoth')

const {
  assertNonEmptyString,
  assertEnum,
} = require('../../security/validate-input.cjs')
const {
  readSession,
  readBrief,
} = require('../research/session-store.cjs')

const TEMPLATES = ['report', 'technical']
const MAX_MARKDOWN_CHARS = 200_000
const MAX_LINES = 10_000
const MAX_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_IMPORT_CHARS = 200_000

const TEMPLATE_STYLES = {
  report: {
    titleSize: 64,
    titleColor: '1F4E79',
    headingColor: '1F4E79',
    codeShading: 'F2F2F2',
  },
  technical: {
    titleSize: 56,
    titleColor: '222222',
    headingColor: '333333',
    codeShading: 'E8E8E8',
  },
}

// Inline markdown: **bold**, `code`, [text](url) links flattened to
// "text (url)", images to "[image: alt]". Citation markers like [1]
// pass through untouched so brief numbering survives.
function inlineRuns(text, base) {
  const runs = []
  const flattened = text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[image: $1]')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
  const parts = flattened.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)

  for (const part of parts) {
    if (!part) {
      continue
    }

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      runs.push(new TextRun({ ...base, text: part.slice(2, -2), bold: true }))
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      runs.push(
        new TextRun({
          ...base,
          text: part.slice(1, -1),
          font: 'Consolas',
          size: 19,
        })
      )
    } else {
      runs.push(new TextRun({ ...base, text: part }))
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ ...base, text: '' })]
}

function isTableSeparator(line) {
  return /^\|?[\s:|-]+\|?$/.test(line) && line.includes('-')
}

function markdownToParagraphs(markdown, style) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_LINES)
  const out = []
  let inCode = false
  let codeLines = []
  let blankRun = 0

  const flushCode = () => {
    if (codeLines.length > 0) {
      out.push(
        new Paragraph({
          shading: { fill: style.codeShading },
          children: [
            new TextRun({
              text: codeLines.join('\n'),
              font: 'Consolas',
              size: 19,
            }),
          ],
        })
      )
      codeLines = []
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ')
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      if (inCode) {
        flushCode()
      }

      inCode = !inCode
      blankRun = 0
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    if (!trimmed) {
      blankRun += 1

      if (blankRun <= 1) {
        out.push(new Paragraph({ text: '' }))
      }

      continue
    }

    blankRun = 0

    if (trimmed === '---' || trimmed === '***') {
      out.push(new Paragraph({ text: '—' }))
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/)

    if (heading) {
      const level =
        heading[1].length === 1
          ? HeadingLevel.HEADING_1
          : heading[1].length === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3

      out.push(
        new Paragraph({
          heading: level,
          children: inlineRuns(heading[2], {
            color: style.headingColor,
          }),
        })
      )
      continue
    }

    if (/^(\d+)\.\s+/.test(trimmed)) {
      out.push(new Paragraph({ children: inlineRuns(trimmed, {}) }))
      continue
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/)

    if (bullet) {
      out.push(
        new Paragraph({
          bullet: { level: 0 },
          children: inlineRuns(bullet[1], {}),
        })
      )
      continue
    }

    const quote = trimmed.match(/^>\s?(.*)$/)

    if (quote) {
      out.push(
        new Paragraph({
          indent: { left: 720 },
          children: inlineRuns(quote[1], { italics: true, color: '555555' }),
        })
      )
      continue
    }

    if (trimmed.includes('|') && trimmed.split('|').length >= 3) {
      if (isTableSeparator(trimmed)) {
        continue
      }

      const cells = trimmed
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0)

      if (cells.length > 0) {
        out.push(new Paragraph({ children: inlineRuns(cells.join('  |  '), {}) }))
        continue
      }
    }

    out.push(new Paragraph({ children: inlineRuns(trimmed, {}) }))
  }

  flushCode()

  return out
}

function slugFileName(title, suffix) {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'document'

  return `${slug}${suffix}`
}

async function buildDocx({ title, markdown, template, footerNote, bibliography }) {
  const style = TEMPLATE_STYLES[template]
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: title, size: style.titleSize, color: style.titleColor, bold: true }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Exported from KryomCode on ${new Date().toISOString().slice(0, 10)}. ${footerNote}`,
          size: 18,
          color: '666666',
          italics: true,
        }),
      ],
    }),
    new Paragraph({ text: '' }),
    ...markdownToParagraphs(markdown, style),
  ]

  if (bibliography && bibliography.length > 0) {
    children.push(
      new Paragraph({ text: '' }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: 'Sources', color: style.headingColor })],
      })
    )

    bibliography.forEach((entry, index) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${index + 1}] ${entry}`, size: 20 }),
          ],
        })
      )
    })
  }

  const doc = new Document({
    title,
    creator: 'KryomCode',
    description: footerNote,
    sections: [{ children }],
  })

  return Packer.toBuffer(doc)
}

function assertTemplate(template) {
  return assertEnum(template, 'template', TEMPLATES)
}

function assertMarkdown(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new Error('Invalid markdown: nothing to export.')
  }

  if (markdown.length > MAX_MARKDOWN_CHARS) {
    throw new Error(
      `Invalid markdown: exceeds ${MAX_MARKDOWN_CHARS} characters.`
    )
  }

  return markdown
}

function bibliographyFromSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .slice(0, 200)
    .map((source) => {
      const parts = []

      if (source.title) {
        parts.push(source.title)
      }

      if (Array.isArray(source.authors) && source.authors.length > 0) {
        parts.push(source.authors.join(', '))
      }

      if (source.venue) {
        parts.push(source.venue)
      }

      const year =
        typeof source.publishedAt === 'string'
          ? source.publishedAt.slice(0, 4)
          : null

      if (year && /^\d{4}$/.test(year)) {
        parts.push(year)
      }

      if (source.url) {
        parts.push(source.url)
      }

      return parts.join('. ') || 'Untitled source'
    })
}

async function exportBriefDocx(sessionId, template) {
  assertTemplate(template)

  const session = await readSession(sessionId)
  let markdown = session.brief && session.brief.markdown ? session.brief.markdown : ''

  if (!markdown.trim()) {
    try {
      markdown = await readBrief(sessionId)
    } catch {
      markdown = ''
    }
  }

  if (!markdown.trim()) {
    throw new Error(
      'This session has no generated brief yet. Run research to completion first.'
    )
  }

  assertMarkdown(markdown)

  const buffer = await buildDocx({
    title: `Research Brief: ${session.objective.slice(0, 120)}`,
    markdown,
    template,
    footerNote:
      'Extractive summary of retrieved sources; not a peer-reviewed paper.',
    bibliography: bibliographyFromSources(session.sources),
  })

  return {
    buffer,
    fileName: `brief-${session.id.slice(0, 12)}.docx`,
    bytes: buffer.length,
  }
}

async function exportTextDocx(title, markdown, template) {
  assertNonEmptyString(title, 'title', 200)
  assertTemplate(template)
  assertMarkdown(markdown)

  const buffer = await buildDocx({
    title: title.trim().slice(0, 200),
    markdown,
    template,
    footerNote: 'Exported from KryomCode.',
    bibliography: [],
  })

  return {
    buffer,
    fileName: slugFileName(title.trim(), '.docx'),
    bytes: buffer.length,
  }
}

async function importDocxFile(absPath) {
  assertNonEmptyString(absPath, 'path', 2000)

  if (path.extname(absPath).toLowerCase() !== '.docx') {
    throw new Error('Only .docx files can be imported.')
  }

  let stat = null

  try {
    stat = await fs.lstat(absPath)
  } catch {
    throw new Error('File does not exist.')
  }

  if (stat.isSymbolicLink()) {
    throw new Error('Symbolic links are not followed.')
  }

  if (!stat.isFile()) {
    throw new Error('Only regular files can be imported.')
  }

  if (stat.size > MAX_IMPORT_BYTES) {
    throw new Error('File exceeds the 5 MB import limit.')
  }

  let text = ''

  try {
    const result = await mammoth.extractRawText({ path: absPath })

    text = typeof result.value === 'string' ? result.value : ''
  } catch (error) {
    throw new Error(
      `Could not read this Word file: ${error.message.slice(0, 300)}`
    )
  }

  const truncated = text.length > MAX_IMPORT_CHARS

  return {
    text: text.slice(0, MAX_IMPORT_CHARS),
    truncated,
    fileName: path.basename(absPath),
  }
}

module.exports = {
  TEMPLATES,
  exportBriefDocx,
  exportTextDocx,
  importDocxFile,
}
