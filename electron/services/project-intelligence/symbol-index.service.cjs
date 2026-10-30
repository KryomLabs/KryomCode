// Symbol and reference indexing (Level 3C.1). Extracts classes,
// functions, methods, interfaces, type aliases, variables, and
// import/export relationships from indexed JavaScript/TypeScript
// files, and finds identifier references across files.
//
// This is an approximate static scan, not a compiler: patterns are
// matched outside comments and string literals, dynamic constructs
// (computed names, re-exports through variables, decorators that
// rename) are not resolved, and results say so. Stale or unindexed
// files are reported, never silently scanned from memory.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  checkIndexFreshness,
} = require('./code-index.service.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('symbol-index')

const MAX_FILE_BYTES = 256 * 1024
const MAX_FILES_PER_CALL = 200
const MAX_SYMBOLS_PER_FILE = 500
const MAX_REFERENCES = 200

const SUPPORTED_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
])

function openRoot() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  return root
}

function isSupported(relativePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
}

// Masks comments and string literals with spaces while preserving
// newlines, so line numbers in the masked source match the original.
// Template substitutions stay visible (they hold real code).
function maskSource(source) {
  const chars = source.split('')
  const len = chars.length
  let i = 0
  let state = 'code'
  let quote = ''

  const blank = (index) => {
    if (chars[index] !== '\n' && chars[index] !== '\r') {
      chars[index] = ' '
    }
  }

  while (i < len) {
    const ch = chars[i]
    const next = i + 1 < len ? chars[i + 1] : ''

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        blank(i)
        blank(i + 1)
        i += 2
        state = 'line-comment'
        continue
      }

      if (ch === '/' && next === '*') {
        blank(i)
        blank(i + 1)
        i += 2
        state = 'block-comment'
        continue
      }

      if (ch === '"' || ch === "'") {
        state = 'string'
        quote = ch
        blank(i)
        i += 1
        continue
      }

      if (ch === '`') {
        state = 'template'
        blank(i)
        i += 1
        continue
      }

      i += 1
      continue
    }

    if (state === 'line-comment') {
      if (ch === '\n') {
        state = 'code'
      } else {
        blank(i)
      }

      i += 1
      continue
    }

    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        blank(i)
        blank(i + 1)
        i += 2
        state = 'code'
      } else {
        blank(i)
        i += 1
      }

      continue
    }

    if (state === 'string') {
      if (ch === '\\') {
        blank(i)

        if (i + 1 < len) {
          blank(i + 1)
        }

        i += 2
        continue
      }

      if (ch === '\n') {
        state = 'code'
        i += 1
        continue
      }

      if (ch === quote) {
        blank(i)
        i += 1
        state = 'code'
        continue
      }

      blank(i)
      i += 1
      continue
    }

    // Template literal: mask literal text, keep ${...} code visible.
    if (ch === '\\') {
      blank(i)

      if (i + 1 < len) {
        blank(i + 1)
      }

      i += 2
      continue
    }

    if (ch === '`') {
      blank(i)
      i += 1
      state = 'code'
      continue
    }

    if (ch === '$' && next === '{') {
      i += 2
      let depth = 1

      while (i < len && depth > 0) {
        if (chars[i] === '{') {
          depth += 1
        } else if (chars[i] === '}') {
          depth -= 1
        }

        i += 1
      }

      continue
    }

    blank(i)
    i += 1
  }

  return chars.join('')
}

const PATTERNS = [
  { kind: 'class', regex: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'interface', regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'type', regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
  { kind: 'enum', regex: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'function', regex: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*(?:\*\s*)?([A-Za-z_$][\w$]*)/ },
  { kind: 'variable', regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/ },
  { kind: 'method', regex: /^\s*(?:public|private|protected|static|async|readonly|\s)*(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\(/ },
]

function extractFromLines(masked, relativePath) {
  const symbols = []
  const lines = masked.split('\n')
  let truncated = false

  for (let index = 0; index < lines.length; index += 1) {
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) {
      truncated = true
      break
    }

    const line = lines[index]
    const lineNumber = index + 1

    for (const pattern of PATTERNS) {
      const match = line.match(pattern.regex)

      if (match) {
        // Method pattern is intentionally loose; skip lines that are
        // clearly calls or control flow rather than definitions.
        if (pattern.kind === 'method') {
          const trimmed = line.trim()

          if (
            /^(if|for|while|switch|catch|return|await|new|typeof|yield)\b/.test(trimmed) ||
            /[=;]$/.test(trimmed) === false && trimmed.includes('=>')
          ) {
            continue
          }
        }

        symbols.push({
          name: match[1],
          kind: pattern.kind,
          file: relativePath,
          line: lineNumber,
          exported: /^\s*export\b/.test(line),
        })
        break
      }
    }

    const exportMatch = line.match(/^\s*export\s*\{([^}]*)\}/)

    if (exportMatch) {
      for (const part of exportMatch[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim()

        if (/^[A-Za-z_$][\w$]*$/.test(name)) {
          symbols.push({
            name,
            kind: 'export',
            file: relativePath,
            line: lineNumber,
            exported: true,
          })
        }
      }
    }
  }

  return { symbols, truncated }
}

function extractImports(masked, relativePath, original) {
  // Specifiers live inside quoted strings, which masking blanks, so
  // matching runs on the ORIGINAL lines. The masked line gates each
  // parse: a line showing no import syntax after masking is a
  // comment, a string, or plain code (same shape as the change-set
  // import parser: comments excluded, strings intact).
  const sourceLines = (typeof original === 'string' ? original : masked).split('\n')
  const imports = []
  const lines = masked.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const originalLine = /\b(import|require|export)\b/.test(line) ? (sourceLines[index] ?? '') : ''
    const fromMatch =
      originalLine.match(/\bimport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/) ||
      originalLine.match(/\bexport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/) ||
      originalLine.match(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/) ||
      originalLine.match(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/)

    if (fromMatch) {
      const names = []
      const braceMatch = originalLine.match(/\{([^}]*)\}/)

      if (braceMatch) {
        for (const part of braceMatch[1].split(',')) {
          const name = part.trim().split(/\s+/)[0]

          if (name) {
            names.push(name.slice(0, 120))
          }
        }
      }

      const defaultMatch = originalLine.match(/\bimport\s+([A-Za-z_$][\w$]*)\s*(,|\bfrom\b)/)

      if (defaultMatch) {
        names.push(defaultMatch[1])
      }

      imports.push({
        file: relativePath,
        line: index + 1,
        specifier: fromMatch[1].slice(0, 500),
        names: names.slice(0, 20),
      })
    }
  }

  return imports.slice(0, MAX_SYMBOLS_PER_FILE)
}

async function scanFile(root, relativePath) {
  const fullPath = path.join(root, relativePath)
  let stat = null

  try {
    stat = await fs.stat(fullPath)
  } catch {
    return { status: 'missing' }
  }

  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
    return { status: 'skipped', reason: 'Too large to scan.' }
  }

  let buffer = null

  try {
    buffer = await fs.readFile(fullPath)
  } catch {
    return { status: 'missing' }
  }

  if (buffer.includes(0)) {
    return { status: 'skipped', reason: 'Binary file.' }
  }

  const text = buffer.toString('utf8')
  const masked = maskSource(text)
  const { symbols, truncated } = extractFromLines(masked, relativePath)

  return {
    status: 'scanned',
    symbols,
    imports: extractImports(masked, relativePath, text),
    truncated,
  }
}

// Indexes symbols for the given paths (or every supported indexed
// file when paths is null). Only files the code index reports as
// current are scanned; anything else is listed as skipped/stale with
// a reason, never guessed.
async function indexSymbols({ paths = null, limit = MAX_FILES_PER_CALL } = {}) {
  const root = openRoot()
  const wanted = paths === null ? null : [...new Set(paths)]

  if (wanted !== null && wanted.length === 0) {
    throw new Error('No files were provided.')
  }

  const bounded = wanted === null ? null : wanted.slice(0, limit)
  let candidates = bounded

  if (candidates === null) {
    const { getIndexStatus } = require('./code-index.service.cjs')
    const status = await getIndexStatus()

    if (!status.indexed) {
      throw new Error('No code index exists yet. Refresh the index first.')
    }

    const manifest = await (async () => {
      const {
        readStorageFile,
      } = require('../../security/storage-path.cjs')

      try {
        const { found, data } = await readStorageFile(
          root,
          ['.kryom', 'index', 'manifest.json']
        )

        return found && data ? JSON.parse(data) : null
      } catch {
        return null
      }
    })()

    if (!manifest) {
      throw new Error('No code index exists yet. Refresh the index first.')
    }

    candidates = Object.keys(manifest.files)
      .filter((entry) => isSupported(entry))
      .slice(0, limit)
  }

  const freshness = await checkIndexFreshness(candidates)
  const symbols = []
  const imports = []
  const scanned = []
  const skipped = []
  const stale = []

  for (const entry of freshness.entries) {
    if (entry.status !== 'current') {
      stale.push(entry)
      continue
    }

    if (!isSupported(entry.path)) {
      skipped.push({ path: entry.path, reason: 'Unsupported language for symbol extraction.' })
      continue
    }

    const scannedFile = await scanFile(root, entry.path)

    if (scannedFile.status !== 'scanned') {
      skipped.push({
        path: entry.path,
        reason: scannedFile.reason || 'File is not readable.',
      })
      continue
    }

    scanned.push(entry.path)
    symbols.push(...scannedFile.symbols)
    imports.push(...scannedFile.imports)
  }

  log.info(`Symbol scan: ${scanned.length} file(s), ${symbols.length} symbol(s).`)

  return {
    scanned,
    skipped,
    stale,
    symbols,
    imports,
    approximate: true,
    note: 'Static scan only: dynamic constructs are not resolved.',
  }
}

// Finds definitions of one identifier across supported indexed files.
async function findSymbol(name) {
  if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name.trim())) {
    throw new Error('Invalid symbol name.')
  }

  const target = name.trim()
  const indexed = await indexSymbols({})

  return {
    name: target,
    definitions: indexed.symbols.filter((symbol) => symbol.name === target),
    stale: indexed.stale,
    skipped: indexed.skipped,
    approximate: true,
  }
}

// Finds references (word-boundary usages outside comments/strings) of
// one identifier across supported indexed files.
async function findReferences(name) {
  if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name.trim())) {
    throw new Error('Invalid symbol name.')
  }

  const root = openRoot()
  const target = name.trim()
  const indexed = await indexSymbols({})
  const usage = new RegExp(`\\b${target}\\b`)
  const references = []

  for (const relativePath of indexed.scanned) {
    let buffer = null

    try {
      buffer = await fs.readFile(path.join(root, relativePath))
    } catch {
      continue
    }

    const lines = maskSource(buffer.toString('utf8')).split('\n')

    for (let index = 0; index < lines.length; index += 1) {
      if (references.length >= MAX_REFERENCES) {
        break
      }

      if (usage.test(lines[index])) {
        references.push({ file: relativePath, line: index + 1 })
      }
    }

    if (references.length >= MAX_REFERENCES) {
      break
    }
  }

  return {
    name: target,
    definitions: indexed.symbols.filter((symbol) => symbol.name === target),
    references,
    truncated: references.length >= MAX_REFERENCES,
    stale: indexed.stale,
    skipped: indexed.skipped,
    approximate: true,
  }
}

module.exports = {
  MAX_FILES_PER_CALL,
  MAX_REFERENCES,
  indexSymbols,
  findSymbol,
  findReferences,
}
