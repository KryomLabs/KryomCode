// Pure parsers for common build/test output. No I/O, no processes:
// deterministic and safe to unit test.

const MAX_DIAGNOSTICS = 200

// TypeScript: src/app.ts(12,4): error TS2322: Type 'x' is not assignable...
const TSC_PATTERN = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/

// ESLint / generic: src/app.ts:12:4: error: message
const GENERIC_PATTERN = /^(.+?):(\d+):(\d+):\s+(error|warning)s?:\s+(.*)$/

// Node stack: at fn (/abs/path/file.js:12:4) or at /abs/path/file.js:12:4
const STACK_PATTERN = /at\s+(?:.*?\()?([^()\s]+):(\d+):(\d+)\)?/

function normalizeSeverity(value) {
  return value === 'warning' ? 'warning' : 'error'
}

function parseTscLine(line) {
  const match = TSC_PATTERN.exec(line.trim())

  if (!match) {
    return null
  }

  return {
    file: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
    severity: normalizeSeverity(match[4]),
    code: match[5],
    message: match[6].slice(0, 2000),
    source: 'tsc',
  }
}

function parseGenericLine(line) {
  const trimmed = line.trim()

  if (TSC_PATTERN.test(trimmed)) {
    return null
  }

  const match = GENERIC_PATTERN.exec(trimmed)

  if (!match) {
    return null
  }

  return {
    file: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
    severity: normalizeSeverity(match[4]),
    code: null,
    message: match[5].slice(0, 2000),
    source: 'generic',
  }
}

function parseStackLine(line) {
  const trimmed = line.trim()

  if (!trimmed.startsWith('at ')) {
    return null
  }

  const match = STACK_PATTERN.exec(trimmed)

  if (!match) {
    return null
  }

  const file = match[1]

  if (file.startsWith('node:') || file.startsWith('internal/')) {
    return null
  }

  return {
    file,
    line: Number(match[2]),
    column: Number(match[3]),
    severity: 'error',
    code: 'STACK',
    message: trimmed.slice(0, 2000),
    source: 'stack',
  }
}

function dedupe(diagnostics) {
  const seen = new Set()
  const output = []

  for (const entry of diagnostics) {
    const key = `${entry.file}:${entry.line}:${entry.column}:${entry.code}:${entry.message}`

    if (!seen.has(key)) {
      seen.add(key)
      output.push(entry)
    }
  }

  return output
}

function parseOutput(output) {
  if (typeof output !== 'string' || !output) {
    return { diagnostics: [], truncated: false }
  }

  const found = []

  for (const line of output.split('\n')) {
    if (found.length >= MAX_DIAGNOSTICS) {
      break
    }

    const parsed =
      parseTscLine(line) || parseGenericLine(line) || parseStackLine(line)

    if (parsed) {
      found.push(parsed)
    }
  }

  const diagnostics = dedupe(found).slice(0, MAX_DIAGNOSTICS)

  return {
    diagnostics,
    truncated: found.length >= MAX_DIAGNOSTICS,
  }
}

module.exports = {
  parseOutput,
  MAX_DIAGNOSTICS,
}
