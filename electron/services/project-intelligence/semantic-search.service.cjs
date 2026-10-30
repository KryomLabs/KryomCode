// Semantic code search (Level 3C.1). Answers intent-style queries
// ("where is authentication implemented", "which services depend on
// module X") by combining four honest signals over the persisted
// index: exact text matches, symbol-name matches, file-path
// (structural) matches, and token-overlap relevance ranking.
//
// There are no embeddings and no model calls here: scoring is
// deterministic token overlap with per-result explanations, so every
// ranking can be audited. Queries may pin intent with `symbol:` and
// `file:` prefixes or `"quoted phrases"` for exact matching.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  checkIndexFreshness,
} = require('./code-index.service.cjs')
const {
  indexSymbols,
} = require('./symbol-index.service.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('semantic-search')

const MAX_FILES = 200
const MAX_FILE_BYTES = 256 * 1024
const MAX_RESULTS = 30
const MAX_EXCERPT_CHARS = 400
const MAX_QUERY_CHARS = 500

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'where', 'what', 'which', 'who', 'how', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'by', 'from', 'as', 'at', 'that', 'this',
  'these', 'those', 'it', 'its', 'find', 'show', 'list', 'all', 'every',
  'code', 'file', 'files', 'implemented', 'implementation', 'responsible',
  'related', 'about',
])

function openRoot() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  return root
}

function sharesStem(token, candidate) {
  // Intent matching: "authentication" should reach "auth"-family
  // tokens without a stemmer dictionary. A shared prefix of 4+ chars
  // in EITHER direction counts (covers inflectional variants both
  // ways); shorter overlaps are noise ("a", "to", "re").
  if (
    typeof token !== 'string' ||
    typeof candidate !== 'string' ||
    token.length < 4 ||
    candidate.length < 4
  ) {
    return false
  }

  return token.startsWith(candidate) || candidate.startsWith(token)
}

function splitIdentifier(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2)
}

function parseQuery(raw) {
  const query = String(raw || '').slice(0, MAX_QUERY_CHARS)
  const phrases = []
  const withoutPhrases = query.replace(/"([^"]{2,80})"/g, (match, inner) => {
    phrases.push(inner.toLowerCase())
    return ' '
  })

  const symbolHints = []
  const fileHints = []
  const rest = []

  for (const part of withoutPhrases.split(/\s+/)) {
    if (part.toLowerCase().startsWith('symbol:') && part.length > 7) {
      symbolHints.push(part.slice(7).toLowerCase())
    } else if (part.toLowerCase().startsWith('file:') && part.length > 5) {
      fileHints.push(part.slice(5).toLowerCase())
    } else if (part.trim()) {
      rest.push(part)
    }
  }

  const tokens = rest
    .flatMap((part) => splitIdentifier(part))
    .filter((token) => !STOP_WORDS.has(token))
    .slice(0, 16)

  return { tokens, phrases, symbolHints, fileHints }
}

async function readBounded(root, relativePath) {
  const fullPath = path.join(root, relativePath)
  let stat = null

  try {
    stat = await fs.stat(fullPath)
  } catch {
    return null
  }

  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
    return null
  }

  try {
    const buffer = await fs.readFile(fullPath)

    if (buffer.includes(0)) {
      return null
    }

    return buffer.toString('utf8')
  } catch {
    return null
  }
}

function excerptAround(lines, lineIndex) {
  const start = Math.max(0, lineIndex - 1)
  const end = Math.min(lines.length, lineIndex + 2)
  const text = lines.slice(start, end).join('\n').trim()

  return text.slice(0, MAX_EXCERPT_CHARS)
}

// Searches the project for developer-intent queries. Returns ranked
// results with match kinds and score explanations, plus the files
// that were stale/skipped so absence of evidence is visible.
async function searchProject(query, { limit = MAX_RESULTS } = {}) {
  const root = openRoot()

  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('Enter a search query.')
  }

  const parsed = parseQuery(query)

  if (
    parsed.tokens.length === 0 &&
    parsed.phrases.length === 0 &&
    parsed.symbolHints.length === 0 &&
    parsed.fileHints.length === 0
  ) {
    throw new Error('The query holds no searchable terms.')
  }

  const { readStorageFile } = require('../../security/storage-path.cjs')
  const stored = await readStorageFile(root, ['.kryom', 'index', 'manifest.json'])

  if (!stored.found || !stored.data) {
    throw new Error('No code index exists yet. Refresh the index first.')
  }

  const manifest = JSON.parse(stored.data)
  const candidates = Object.keys(manifest.files || {}).slice(0, MAX_FILES)
  const freshness = await checkIndexFreshness(candidates)
  const current = freshness.entries.filter((entry) => entry.status === 'current')
  const stale = freshness.entries.filter((entry) => entry.status !== 'current')

  const results = new Map()

  const addResult = (file, line, kind, score, why, excerpt) => {
    const key = `${file}:${line}:${kind}`

    if (!results.has(key)) {
      results.set(key, { file, line, kind, score, why, excerpt })
    }
  }

  // Signal 1+2: exact phrases and token matches in file contents.
  for (const entry of current) {
    const content = await readBounded(root, entry.path)

    if (!content) {
      continue
    }

    const lines = content.split('\n')
    const lowered = content.toLowerCase()

    for (const phrase of parsed.phrases) {
      const at = lowered.indexOf(phrase)

      if (at >= 0) {
        const line = content.slice(0, at).split('\n').length

        addResult(
          entry.path,
          line,
          'exact',
          50,
          `Exact phrase "${phrase}" found in file contents.`,
          excerptAround(lines, line - 1)
        )
      }
    }

    if (parsed.tokens.length > 0) {
      const fileTokens = new Set(splitIdentifier(content.slice(0, 32768)))
      let hits = 0

      for (const token of parsed.tokens) {
        if (fileTokens.has(token) || lowered.includes(token) || [...fileTokens].some((candidate) => sharesStem(token, candidate))) {
          hits += 1
        }
      }

      if (hits > 0) {
        let firstLine = 1

        for (let index = 0; index < lines.length; index += 1) {
          const lineLower = lines[index].toLowerCase()

          if (parsed.tokens.some((token) => lineLower.includes(token))) {
            firstLine = index + 1
            break
          }
        }

        addResult(
          entry.path,
          firstLine,
          'text',
          10 + hits * 5,
          `${hits}/${parsed.tokens.length} query term(s) match file contents.`,
          excerptAround(lines, firstLine - 1)
        )
      }
    }
  }

  // Signal 3: symbol-name matches (definitions weigh more).
  const symbolFiles = current.map((entry) => entry.path)
  const supported = []

  for (const file of symbolFiles) {
    const ext = path.extname(file).toLowerCase()

    if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(ext)) {
      supported.push(file)
    }
  }

  if (supported.length > 0) {
    const indexed = await indexSymbols({ paths: supported.slice(0, MAX_FILES) })
    const wanted = [...parsed.tokens, ...parsed.symbolHints]

    for (const symbol of indexed.symbols) {
      const nameTokens = splitIdentifier(symbol.name)
      let hits = 0

      for (const token of wanted) {
        if (nameTokens.includes(token) || symbol.name.toLowerCase().includes(token) || nameTokens.some((candidate) => sharesStem(token, candidate))) {
          hits += 1
        }
      }

      if (hits > 0) {
        addResult(
          symbol.file,
          symbol.line,
          'symbol',
          20 + hits * 8,
          `Symbol "${symbol.name}" (${symbol.kind}) matches ${hits} query term(s).`,
          `${symbol.kind} ${symbol.name}`
        )
      }
    }
  }

  // Signal 4: structural (file path) matches.
  for (const entry of current) {
    const pathTokens = splitIdentifier(entry.path.replace(/\//g, ' '))
    let hits = 0

    for (const token of [...parsed.tokens, ...parsed.fileHints]) {
      if (pathTokens.includes(token) || entry.path.toLowerCase().includes(token) || pathTokens.some((candidate) => sharesStem(token, candidate))) {
        hits += 1
      }
    }

    if (hits > 0) {
      const existing = [...results.values()].find(
        (result) => result.file === entry.path && result.kind === 'structural'
      )

      if (!existing) {
        addResult(
          entry.path,
          1,
          'structural',
          8 + hits * 4,
          `File path matches ${hits} query term(s).`,
          entry.path
        )
      }
    }
  }

  const ranked = [...results.values()]
    .sort((a, b) => b.score - a.score || (a.file < b.file ? -1 : 1))
    .slice(0, Math.min(Math.max(1, limit), MAX_RESULTS))

  // Never log the raw query: searches can contain pasted secrets.
  // Term/result counts preserve diagnostics without the content.
  log.info(
    `Project search: ${ranked.length} result(s) for ${parsed.tokens.length} term(s).`
  )

  return {
    query: query.slice(0, MAX_QUERY_CHARS),
    interpretation: parsed,
    results: ranked,
    searchedFiles: current.length,
    stale,
    indexTruncated: manifest.counts.truncated === true,
    method: 'Deterministic token, exact-phrase, symbol, and path matching with explained scores. No embeddings or model calls.',
  }
}

module.exports = {
  searchProject,
  parseQuery,
}
