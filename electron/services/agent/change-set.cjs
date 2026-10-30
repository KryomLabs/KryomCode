// Dependency-aware change sets (Level 3B.6). Read-only analysis over
// an approved edit batch: parses static JS/TS imports, resolves
// relative specifiers inside the workspace, builds a dependency
// graph, detects cycles, and returns a manifest with a safe
// application order, conflicts, review groups, and whole-set
// validation.
//
// Advisory only: the manifest informs review and ordering but never
// bypasses approval, containment, freshness, checkpoints, rollback,
// or cancellation — those stay enforced in the apply path, which
// this module never calls. Unknown means unknown: unsupported
// languages, aliases, and truncated scans are reported as such,
// never guessed.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  resolveWorkspacePath,
} = require('../../security/validate-path.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('change-set')

const CHANGESET_VERSION = 1
const MAX_EDITS = 20
const MAX_GRAPH_FILES = 100
const MAX_DEPTH = 4
const MAX_ANALYSIS_BYTES = 256 * 1024
const MAX_SPECIFIERS_PER_FILE = 200
const MAX_EDGES = 500
const MAX_SPECIFIER_CHARS = 1000
const MAX_REVERSE_SCAN = 100
const MAX_LISTED_IMPORTERS = 10
const MAX_LISTED_REFS = 50
const MAX_CYCLES_LISTED = 10

const EDIT_ACTIONS = ['create', 'modify', 'delete']

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

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

const RESOLVE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]

// Directory segments that are never entered during analysis. This is
// the union of the context-gathering and project-index exclusions,
// plus .kryom: dependencies are never resolved into or through them.
const EXCLUDED_DIR_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.kryom',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target',
])

const EXCLUDED_BASENAME_PATTERNS = [
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /secret/i,
  /credential/i,
]

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function displayPath(root, resolved) {
  return path.relative(root, resolved).split(path.sep).join('/')
}

function identityKey(resolved) {
  return canonicalTargetKey(resolved)
}

// Canonical identity for an edit target: the single source of truth
// shared by conflict detection here and in the apply path, so both
// layers agree on what "the same file" means.
function canonicalTargetKey(resolved) {
  const normalized = path.normalize(resolved)

  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isExcludedRelative(display) {
  const segments = display.split('/')
  const base = segments[segments.length - 1] || ''

  if (segments.some((segment) => EXCLUDED_DIR_SEGMENTS.has(segment))) {
    return true
  }

  if (base.startsWith('.env') || base === '.DS_Store') {
    return true
  }

  return EXCLUDED_BASENAME_PATTERNS.some((pattern) => pattern.test(base))
}

function languageOf(display) {
  const ext = path.extname(display).toLowerCase()

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return 'unsupported'
  }

  return TS_EXTENSIONS.has(ext) ? 'ts' : 'js'
}

// Masks comments (replaced with spaces, offsets preserved) and
// records string-literal spans so statement patterns never match
// inside strings. Handles nested template literals inside ${}
// expressions. Known limitation: a division or regex literal whose
// text contains `//` blanks the rest of its line, so an import
// later on that same line would be missed; imports are statements
// and virtually always start their own line or follow a semicolon.
function maskSource(source) {
  const chars = source.split('')
  const stringSpans = []
  const len = chars.length
  let i = 0

  // Frames: { type: 'code', braceDepth } or { type: 'template', start }.
  const stack = [{ type: 'code', braceDepth: 0 }]

  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) {
      if (chars[k] !== '\n' && chars[k] !== '\r') {
        chars[k] = ' '
      }
    }
  }

  while (i < len) {
    const frame = stack[stack.length - 1]
    const ch = chars[i]
    const next = i + 1 < len ? chars[i + 1] : ''

    if (frame.type === 'code') {
      if (ch === '/' && next === '/') {
        const start = i

        while (i < len && chars[i] !== '\n') {
          i += 1
        }

        blank(start, i)
        continue
      }

      if (ch === '/' && next === '*') {
        const start = i

        i += 2

        while (
          i < len &&
          !(chars[i] === '*' && i + 1 < len && chars[i + 1] === '/')
        ) {
          i += 1
        }

        i = Math.min(len, i + 2)
        blank(start, i)
        continue
      }

      if (ch === '"' || ch === "'") {
        const quote = ch
        const start = i

        i += 1

        while (i < len) {
          if (chars[i] === '\\') {
            i += 2
            continue
          }

          // Lenient unterminated string: a newline ends it rather
          // than swallowing the rest of the file.
          if (chars[i] === '\n' || chars[i] === quote) {
            if (chars[i] === quote) {
              i += 1
            }

            break
          }

          i += 1
        }

        stringSpans.push([start, Math.min(i, len)])
        continue
      }

      if (ch === '`') {
        stack.push({ type: 'template', start: i })
        i += 1
        continue
      }

      if (ch === '{' && stack.length > 1) {
        frame.braceDepth += 1
        i += 1
        continue
      }

      if (ch === '}' && stack.length > 1) {
        if (frame.braceDepth === 0) {
          stack.pop()
        } else {
          frame.braceDepth -= 1
        }

        i += 1
        continue
      }

      i += 1
      continue
    }

    if (ch === '\\') {
      i += 2
      continue
    }

    if (ch === '`') {
      stringSpans.push([frame.start, i + 1])
      stack.pop()
      i += 1
      continue
    }

    if (ch === '$' && next === '{') {
      stack.push({ type: 'code', braceDepth: 0 })
      i += 2
      continue
    }

    i += 1
  }

  while (stack.length > 1) {
    const frame = stack.pop()

    if (frame.type === 'template') {
      stringSpans.push([frame.start, len])
    }
  }

  return { code: chars.join(''), stringSpans }
}

const STATIC_IMPORT_PATTERN =
  /\bimport\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?(['"])([^'";\n]+)\1/g
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*(['"])([^'";\n]+)\1\s*\)/g
const EXPORT_FROM_PATTERN =
  /\bexport\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)(['"])([^'";\n]+)\1/g
const REQUIRE_PATTERN = /\brequire\s*\(\s*(['"])([^'";\n]+)\1\s*\)/g

function spanContains(spans, offset) {
  return spans.some(([start, end]) => offset >= start && offset < end)
}

// Extracts static import specifiers: `import ... from`, side-effect
// imports, `export ... from`, dynamic `import()` with a string
// literal, and `require()` with a string literal. Everything else —
// computed specifiers, template imports with substitutions, loader
// magic — is out of scope and simply not reported.
function extractSpecifiers(source) {
  const { code, stringSpans } = maskSource(source)
  const found = []
  const seen = new Set()
  let truncated = false

  const collect = (pattern, kind) => {
    pattern.lastIndex = 0

    let match = pattern.exec(code)

    while (match) {
      if (!spanContains(stringSpans, match.index)) {
        const specifier = match[2].trim()

        if (
          specifier &&
          specifier.length <= MAX_SPECIFIER_CHARS &&
          !specifier.includes('\0')
        ) {
          const key = `${kind}:${specifier}`

          if (!seen.has(key)) {
            seen.add(key)

            if (found.length >= MAX_SPECIFIERS_PER_FILE) {
              truncated = true
            } else {
              found.push({ specifier, kind })
            }
          }
        }
      }

      match = pattern.exec(code)
    }
  }

  collect(STATIC_IMPORT_PATTERN, 'import')
  collect(DYNAMIC_IMPORT_PATTERN, 'dynamic-import')
  collect(EXPORT_FROM_PATTERN, 'export')
  collect(REQUIRE_PATTERN, 'require')

  return { specifiers: found, truncated }
}

function classifySpecifier(specifier) {
  if (specifier === '.' || specifier === '..') {
    return 'relative'
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return 'relative'
  }

  if (
    specifier.startsWith('/') ||
    specifier.startsWith('\\') ||
    /^[a-zA-Z]:/.test(specifier) ||
    specifier.includes('://')
  ) {
    return 'absolute'
  }

  // Path aliases (~/, #/) and tsconfig paths cannot be resolved
  // without project config the analyzer deliberately does not read.
  if (specifier.startsWith('~') || specifier.startsWith('#')) {
    return 'alias'
  }

  return 'external'
}

function resolutionFailure(message) {
  if (/outside/i.test(message || '')) {
    return 'Import points outside the project.'
  }

  if (/[Ss]ymbolic link/.test(message || '')) {
    return 'Import target is a symbolic link.'
  }

  if (/workspace root/.test(message || '')) {
    return 'Import points at the workspace root.'
  }

  return 'Import target cannot be read.'
}

// Resolves a relative specifier against the importing file. Only the
// filesystem is consulted — never node_modules, which is excluded
// by design — and containment runs through the same validator as
// every other file operation. inSetPaths holds normalized identities
// of change-set targets so imports of to-be-created files resolve
// within the set instead of reporting unresolved.
async function resolveRelativeImport(specifier, fromAbsPath, root, inSetPaths) {
  const fromDir = path.dirname(fromAbsPath)
  const logical = path.normalize(path.join(fromDir, specifier))
  const rel = path.relative(root, logical)

  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { status: 'unknown', reason: 'Import points outside the project.' }
  }

  if (isExcludedRelative(rel.split(path.sep).join('/'))) {
    return { status: 'unknown', reason: 'Import points into an excluded directory.' }
  }

  const candidates = [logical]

  if (!path.extname(logical)) {
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(logical + ext)
    }

    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(path.join(logical, `index${ext}`))
    }
  }

  for (const candidate of candidates) {
    const key = identityKey(candidate)

    if (inSetPaths.has(key)) {
      return {
        status: 'resolved',
        relativePath: inSetPaths.get(key),
        inSet: true,
      }
    }

    try {
      const resolved = await resolveWorkspacePath(path.relative(root, candidate))

      if (!resolved.stat.isFile()) {
        continue
      }

      return {
        status: 'resolved',
        relativePath: displayPath(root, resolved.path),
        realPath: resolved.path,
        inSet: false,
      }
    } catch (error) {
      const message = error && error.message ? error.message : ''

      if (message.includes('does not exist')) {
        continue
      }

      return { status: 'unknown', reason: resolutionFailure(message) }
    }
  }

  return { status: 'unresolved', reason: 'Import target was not found.' }
}

async function classifyImport(specifier, fromAbsPath, root, inSetPaths) {
  const kind = classifySpecifier(specifier)

  if (kind === 'external') {
    return { status: 'external', reason: 'Package import; project files only.' }
  }

  if (kind === 'absolute') {
    return { status: 'unknown', reason: 'Absolute imports are not resolved.' }
  }

  if (kind === 'alias') {
    return { status: 'unknown', reason: 'Aliased imports are not resolved.' }
  }

  return resolveRelativeImport(specifier, fromAbsPath, root, inSetPaths)
}

// Reads one file for analysis. Files over the byte cap, binaries,
// and read failures yield a status instead of content: analysis is
// never silently partial.
async function readAnalysisSource(absPath, stat) {
  if (stat.size > MAX_ANALYSIS_BYTES) {
    return { status: 'too-large', reason: `Over the ${MAX_ANALYSIS_BYTES}-byte analysis cap.` }
  }

  let buffer = null

  try {
    buffer = await fs.readFile(absPath)
  } catch {
    return { status: 'unreadable', reason: 'File cannot be read.' }
  }

  if (buffer.length > MAX_ANALYSIS_BYTES) {
    return { status: 'too-large', reason: `Over the ${MAX_ANALYSIS_BYTES}-byte analysis cap.` }
  }

  if (buffer.includes(0)) {
    return { status: 'binary', reason: 'Binary file.' }
  }

  return {
    status: 'ok',
    content: buffer.toString('utf8'),
    digest: sha256Hex(buffer),
    length: buffer.length,
  }
}

function assertEditShape(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`edits[${index}] is invalid.`)
  }

  if (!EDIT_ACTIONS.includes(entry.action)) {
    throw new Error(`edits[${index}].action is invalid.`)
  }

  if (typeof entry.path !== 'string' || !entry.path.trim()) {
    throw new Error(`edits[${index}].path is invalid.`)
  }
}

// Resolves every target to a canonical identity. Unresolvable
// targets (traversal, outside, symlink) are analysis-skipped here;
// the freshness check below reports them as blockers, so this pass
// never throws for environment problems — only malformed input
// throws, fail-closed.
async function resolveTargets(root, edits) {
  const targets = []

  // The manifest speaks the caller's edit indexes (stable plan
  // indexes, possibly sparse), falling back to batch position when
  // an edit carries none.
  for (const [position, entry] of edits.entries()) {
    assertEditShape(entry, position)

    const trimmed = entry.path.trim()
    let resolved = null
    let inaccessibleReason = null

    try {
      resolved = await resolveWorkspacePath(trimmed, { allowMissing: true })
    } catch (error) {
      inaccessibleReason = error && error.message ? error.message : 'Invalid path.'
    }

    targets.push({
      index: typeof entry.index === 'number' ? entry.index : position,
      action: entry.action,
      requested: trimmed,
      absPath: resolved ? resolved.path : null,
      key: resolved ? identityKey(resolved.path) : null,
      display: resolved ? displayPath(root, resolved.path) : trimmed,
      exists: resolved ? resolved.exists : false,
      isFile: Boolean(resolved && resolved.exists && resolved.stat.isFile()),
      stat: resolved ? resolved.stat : null,
      inaccessibleReason,
      fingerprint:
        typeof entry.originalDigest === 'string' ? entry.originalDigest : null,
      fingerprintLength:
        typeof entry.originalLength === 'number' ? entry.originalLength : null,
      proposedContent:
        (entry.action === 'create' || entry.action === 'modify') &&
        typeof entry.content === 'string'
          ? entry.content
          : null,
    })
  }

  return targets
}

function findConflicts(targets) {
  const byKey = new Map()

  for (const target of targets) {
    if (!target.key) {
      continue
    }

    if (!byKey.has(target.key)) {
      byKey.set(target.key, [])
    }

    byKey.get(target.key).push(target)
  }

  return [...byKey.values()].filter((group) => group.length > 1)
}

// Analyzes one target file. Proposed content (the post-apply state)
// is parsed when present; otherwise the current file is parsed. A
// target that cannot be analyzed keeps a status explaining why, and
// contributes no edges.
async function analyzeTarget(root, target, inSetPaths, counters, seeds) {
  const file = {
    index: target.index,
    action: target.action,
    path: target.display,
    status: 'analyzed',
    statusReason: '',
    language: languageOf(target.display),
    analysisSource: 'none',
    fingerprint: target.fingerprint,
    fingerprintLength: target.fingerprintLength,
    currentDigest: null,
    currentLength: null,
    imports: [],
    specifiersTruncated: false,
  }

  if (target.inaccessibleReason) {
    file.status = 'inaccessible'
    file.statusReason = target.inaccessibleReason
    return file
  }

  if (file.language === 'unsupported') {
    file.status = 'unsupported'
    file.statusReason = 'Only JavaScript/TypeScript imports are analyzed.'
    return file
  }

  let source = null

  if (target.proposedContent !== null) {
    file.analysisSource = 'proposed'

    if (Buffer.byteLength(target.proposedContent, 'utf8') > MAX_ANALYSIS_BYTES) {
      file.status = 'too-large'
      file.statusReason = `Proposed content is over the ${MAX_ANALYSIS_BYTES}-byte analysis cap.`
      return file
    }

    source = target.proposedContent
  } else {
    if (!target.exists || !target.isFile) {
      file.status = 'missing'
      file.statusReason = 'No current file and no proposed content to analyze.'
      return file
    }

    const read = await readAnalysisSource(target.absPath, target.stat)

    if (read.status !== 'ok') {
      file.status = read.status
      file.statusReason = read.reason
      return file
    }

    file.analysisSource = 'current'
    file.currentDigest = read.digest
    file.currentLength = read.length
    source = read.content
  }

  const { specifiers, truncated } = extractSpecifiers(source)

  file.specifiersTruncated = truncated

  for (const { specifier, kind } of specifiers) {
    const outcome = await classifyImport(specifier, target.absPath, root, inSetPaths)

    counters.edges += 1

    if (outcome.status === 'resolved') {
      seeds.push(outcome)
    }

    file.imports.push({
      specifier: specifier.slice(0, MAX_SPECIFIER_CHARS),
      kind,
      status: outcome.status,
      target: outcome.relativePath ?? null,
      reason: outcome.reason ?? '',
    })
  }

  return file
}

// Breadth-first traversal from the targets over resolved in-project
// imports, recording fingerprints for stale-dependency detection.
// Bounded by file count and depth; anything past the bounds is
// reported as truncated, never silently dropped from the verdict.
async function traverseDependencies(root, seeds, inSetPaths, counters) {
  const nodes = new Map()
  const queue = []

  let dropped = 0

  for (const seed of seeds) {
    if (seed.status === 'resolved' && !seed.inSet && seed.realPath) {
      const key = identityKey(seed.realPath)

      if (nodes.has(key)) {
        continue
      }

      if (nodes.size >= MAX_GRAPH_FILES) {
        dropped += 1
        continue
      }

      nodes.set(key, {
        path: seed.relativePath,
        absPath: seed.realPath,
        depth: 1,
        digest: null,
        length: null,
        status: 'pending',
      })
      queue.push(key)
    }
  }

  let depthReached = 0
  let capped = false

  while (queue.length > 0 && nodes.size < MAX_GRAPH_FILES) {
    const key = queue.shift()
    const node = nodes.get(key)

    if (node.depth > MAX_DEPTH) {
      node.status = 'depth-capped'
      capped = true
      depthReached = Math.max(depthReached, node.depth)
      continue
    }

    depthReached = Math.max(depthReached, node.depth)

    let stat = null

    try {
      stat = await fs.stat(node.absPath)
    } catch {
      node.status = 'missing'
      continue
    }

    if (!stat.isFile()) {
      node.status = 'not-a-file'
      continue
    }

    const read = await readAnalysisSource(node.absPath, stat)

    if (read.status !== 'ok') {
      node.status = read.status
      continue
    }

    node.status = 'analyzed'
    node.digest = read.digest
    node.length = read.length

    const { specifiers } = extractSpecifiers(read.content)

    for (const { specifier } of specifiers) {
      const outcome = await classifyImport(specifier, node.absPath, root, inSetPaths)

      counters.edges += 1

      if (outcome.status === 'resolved' && !outcome.inSet && outcome.realPath) {
        const childKey = identityKey(outcome.realPath)

        if (nodes.has(childKey)) {
          continue
        }

        if (nodes.size >= MAX_GRAPH_FILES) {
          dropped += 1
          continue
        }

        nodes.set(childKey, {
          path: outcome.relativePath,
          absPath: outcome.realPath,
          depth: node.depth + 1,
          digest: null,
          length: null,
          status: 'pending',
        })
        queue.push(childKey)
      }
    }
  }

  return {
    nodes: [...nodes.values()].map((node) => ({
      path: node.path,
      depth: node.depth,
      digest: node.digest,
      length: node.length,
      status: node.status === 'pending' ? 'depth-capped' : node.status,
    })),
    truncated: capped || dropped > 0 || queue.length > 0,
    depthReached,
  }
}

// Cycle detection over in-set edges (importer -> dependency).
// Indexes are the caller's edit indexes, which may be sparse when
// only a subset of a plan is approved.
function findCycles(indexes, edges) {
  const outgoing = new Map()

  for (const index of indexes) {
    outgoing.set(index, [])
  }

  for (const edge of edges) {
    outgoing.get(edge.from).push(edge.to)
  }

  const cycles = []
  const visited = new Set()
  const stack = []

  const visit = (node) => {
    if (stack.includes(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node])
      return
    }

    if (visited.has(node)) {
      return
    }

    visited.add(node)
    stack.push(node)

    for (const next of outgoing.get(node)) {
      if (cycles.length >= MAX_CYCLES_LISTED) {
        break
      }

      visit(next)
    }

    stack.pop()
  }

  for (const index of indexes) {
    if (cycles.length >= MAX_CYCLES_LISTED) {
      break
    }

    visit(index)
  }

  return cycles
}

// Dependencies-first order (Kahn's algorithm over in-set edges, with
// a plan-ordered queue for determinism). Cyclic members keep plan
// order and are named in the reason; nothing is silently dropped.
function orderTargets(targets, edges, cycles) {
  const inCycle = new Set(cycles.flat())
  const indexOf = new Map(targets.map((target, position) => [target.index, position]))
  const remaining = new Map()
  const dependents = new Map()

  for (const target of targets) {
    remaining.set(target.index, 0)
    dependents.set(target.index, [])
  }

  // Edge (importer -> dependency): the dependency applies first, so
  // the importer waits on one more prerequisite.
  for (const edge of edges) {
    if (inCycle.has(edge.from) || inCycle.has(edge.to)) {
      continue
    }

    remaining.set(edge.from, remaining.get(edge.from) + 1)
    dependents.get(edge.to).push(edge.from)
  }

  const ready = targets
    .map((target) => target.index)
    .filter((index) => !inCycle.has(index) && remaining.get(index) === 0)
    .sort((a, b) => indexOf.get(a) - indexOf.get(b))
  const order = []

  while (ready.length > 0) {
    const next = ready.shift()

    order.push(next)

    for (const dependent of dependents.get(next).sort(
      (a, b) => indexOf.get(a) - indexOf.get(b)
    )) {
      remaining.set(dependent, remaining.get(dependent) - 1)

      if (remaining.get(dependent) === 0) {
        ready.push(dependent)
        ready.sort((a, b) => indexOf.get(a) - indexOf.get(b))
      }
    }
  }

  const cyclic = targets
    .map((target) => target.index)
    .filter((index) => inCycle.has(index) || !order.includes(index))
    .sort((a, b) => indexOf.get(a) - indexOf.get(b))

  order.push(...cyclic)

  return { order, cyclicCount: cyclic.length }
}

function reviewGroups(targets, edges) {
  const neighbors = new Map(targets.map((target) => [target.index, new Set()]))

  for (const edge of edges) {
    neighbors.get(edge.from).add(edge.to)
    neighbors.get(edge.to).add(edge.from)
  }

  const seen = new Set()
  const groups = []

  for (const target of targets) {
    if (seen.has(target.index)) {
      continue
    }

    const component = []
    const queue = [target.index]

    seen.add(target.index)

    while (queue.length > 0) {
      const next = queue.shift()

      component.push(next)

      for (const neighbor of neighbors.get(next)) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor)
          queue.push(neighbor)
        }
      }
    }

    if (component.length > 1) {
      const byIndex = new Map(targets.map((entry) => [entry.index, entry]))

      component.sort(
        (a, b) =>
          targets.indexOf(byIndex.get(a)) - targets.indexOf(byIndex.get(b))
      )
      groups.push({
        indexes: component,
        files: component.map((index) => byIndex.get(index).display),
      })
    }
  }

  return groups
}

// Bounded reverse check for delete targets: which project files
// import the file about to be deleted? Reuses the project file
// index (never a fresh walk) and the same parser plus resolver, so
// only confirmed resolutions count — never string guessing. Runs
// only when the change set deletes files.
async function findExternalImporters(root, deleteTargets, inSetPaths) {
  const { getWorkspaceSummary } = require('../project-intelligence/project-analyzer.service.cjs')
  const summary = await getWorkspaceSummary()
  const wanted = new Map(deleteTargets.map((target) => [target.key, target]))
  const importers = new Map()
  let scanned = 0

  for (const entry of summary.fileIndex) {
    if (scanned >= MAX_REVERSE_SCAN) {
      break
    }

    const display = entry.relativePath.split(path.sep).join('/')

    if (languageOf(display) === 'unsupported' || isExcludedRelative(display)) {
      continue
    }

    if (entry.size > MAX_ANALYSIS_BYTES) {
      continue
    }

    const absPath = path.join(root, entry.relativePath)
    let stat = null

    try {
      stat = await fs.stat(absPath)
    } catch {
      continue
    }

    if (!stat.isFile()) {
      continue
    }

    // Targets analyze their own imports elsewhere; here only
    // external files matter.
    if ([...wanted.keys()].includes(identityKey(absPath))) {
      continue
    }

    const read = await readAnalysisSource(absPath, stat)

    scanned += 1

    if (read.status !== 'ok') {
      continue
    }

    const { specifiers } = extractSpecifiers(read.content)

    for (const { specifier } of specifiers) {
      const outcome = await classifyImport(specifier, absPath, root, inSetPaths)

      if (outcome.status !== 'resolved') {
        continue
      }

      const match = [...wanted.values()].find(
        (target) => target.display === outcome.relativePath
      )

      if (match) {
        if (!importers.has(match.key)) {
          importers.set(match.key, { target: match, files: [] })
        }

        const files = importers.get(match.key).files

        if (!files.includes(display)) {
          files.push(display)
        }
      }
    }
  }

  return {
    importers: [...importers.values()],
    scanned,
    complete:
      !summary.counts.truncated && scanned < MAX_REVERSE_SCAN,
  }
}

function nowIso() {
  return new Date().toISOString()
}

// Compares current dependency fingerprints against a previous
// manifest (the review-time analysis). The baseline is advisory
// input: malformed shapes are ignored, never trusted — a forged or
// missing baseline only loses warnings, never hides target
// staleness, which is always re-derived from the edits.
function staleDependencyWarnings(current, baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    return []
  }

  if (
    typeof baseline.at !== 'string' ||
    !Array.isArray(baseline.externalDependencies)
  ) {
    return []
  }

  const before = new Map()

  for (const entry of baseline.externalDependencies) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof entry.path === 'string' &&
      typeof entry.digest === 'string'
    ) {
      before.set(entry.path, entry.digest)
    }
  }

  const warnings = []

  for (const node of current) {
    if (!node.digest || !before.has(node.path)) {
      continue
    }

    if (before.get(node.path) !== node.digest) {
      warnings.push({
        path: node.path,
        reason:
          'Dependency changed since the previous analysis; ' +
          'order re-derived from current files.',
      })
    }
  }

  return warnings
}

// Builds the change-set manifest for an approved edit batch.
// Read-only: inspects targets, dependencies, and project files but
// writes nothing. Throws fail-closed on malformed input; environment
// problems (stale, missing, inaccessible) become validation
// blockers, never exceptions. options.baseline is an earlier
// manifest used only to detect changed dependencies.
async function buildChangeSet(edits, options = {}) {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error('No edits were provided.')
  }

  if (edits.length > MAX_EDITS) {
    throw new Error(`At most ${MAX_EDITS} edits can be analyzed at once.`)
  }

  const targets = await resolveTargets(root, edits)

  // Ordering and edge maps key on edit indexes: duplicates would
  // silently collapse members, so they fail closed instead.
  const seenIndexes = new Set()

  for (const target of targets) {
    if (seenIndexes.has(target.index)) {
      throw new Error(`Duplicate edit index ${target.index}.`)
    }

    seenIndexes.add(target.index)
  }

  const byIndex = new Map(targets.map((target) => [target.index, target]))
  const inSetPaths = new Map(
    targets.filter((target) => target.key).map((target) => [target.key, target.display])
  )
  const counters = { edges: 0 }
  const seeds = []
  const warnings = []
  const blockers = []

  const files = []

  for (const target of targets) {
    files.push(await analyzeTarget(root, target, inSetPaths, counters, seeds))
  }

  // In-set edges: resolved imports whose target is another member.
  const displayToIndex = new Map(targets.map((target) => [target.display, target.index]))
  const edges = []

  for (const file of files) {
    for (const item of file.imports) {
      if (item.status === 'resolved' && item.target && displayToIndex.has(item.target)) {
        const to = displayToIndex.get(item.target)

        if (to !== file.index && edges.length < MAX_EDGES) {
          edges.push({ from: file.index, to, via: item.specifier })
        }
      }
    }
  }

  const cycles = findCycles(
    targets.map((target) => target.index),
    edges
  )
  const { order, cyclicCount } = orderTargets(targets, edges, cycles)
  const groups = reviewGroups(targets, edges)

  const traversal = await traverseDependencies(root, seeds, inSetPaths, counters)

  // Conflicting edits to the same file block the whole set: the
  // user approves only one.
  for (const group of findConflicts(targets)) {
    blockers.push({
      kind: 'conflict',
      index: null,
      path: group[0].display,
      reason:
        `Conflicting edits: ${group.length} edits target the same file ` +
        `(edits ${group.map((target) => target.index).join(', ')}). Approve only one.`,
    })
  }

  // Freshness owns target validity: stale, missing, inaccessible,
  // and unverified targets block before any write. Freshness
  // findings use batch positions; map them back to edit indexes.
  const { checkEditFreshness } = require('./freshness.cjs')
  const freshness = await checkEditFreshness(edits)

  for (const entry of freshness.edits) {
    if (entry.status !== 'current') {
      const source = edits[entry.index]

      blockers.push({
        kind: 'freshness',
        index:
          source && typeof source.index === 'number'
            ? source.index
            : entry.index,
        path: entry.path,
        reason: `${entry.status}: ${entry.reason}`,
      })
    }
  }

  // Deleting a file that other change-set members import breaks the
  // set being built: block with the dependents named.
  const deletes = targets.filter((target) => target.action === 'delete')

  for (const target of deletes) {
    const dependents = edges
      .filter((edge) => edge.to === target.index)
      .map((edge) => byIndex.get(edge.from).display)

    if (dependents.length > 0) {
      blockers.push({
        kind: 'delete-dependent',
        index: target.index,
        path: target.display,
        reason:
          `Delete breaks change-set dependents: ${dependents.join(', ')}. ` +
          'Update or remove those edits first.',
      })
    }
  }

  // Deleting a file imported elsewhere in the project breaks code
  // outside the set: confirmed importers block. An incomplete scan
  // warns instead of blocking — unknown is never a verdict.
  if (deletes.length > 0) {
    const reverse = await findExternalImporters(root, deletes, inSetPaths)

    for (const { target, files: found } of reverse.importers) {
      const listed = found.slice(0, MAX_LISTED_IMPORTERS)
      const extra = found.length - listed.length

      blockers.push({
        kind: 'delete-dependent',
        index: target.index,
        path: target.display,
        reason:
          `Delete breaks ${found.length} external importer(s): ${listed.join(', ')}` +
          (extra > 0 ? ` (+${extra} more)` : '') +
          '. Update those files first.',
      })
    }

    if (!reverse.complete) {
      warnings.push({
        path: null,
        reason:
          'External importer check is incomplete (project too large); ' +
          'a delete target may have importers outside the change set.',
      })
    }
  }

  // Analysis honesty warnings: anything not fully understood is
  // named so review never assumes complete coverage.
  for (const file of files) {
    if (file.status === 'unsupported') {
      warnings.push({
        path: file.path,
        reason: `Unsupported language: ${file.statusReason}`,
      })
    } else if (file.status === 'too-large' || file.status === 'binary' || file.status === 'unreadable') {
      warnings.push({ path: file.path, reason: `${file.status}: ${file.statusReason}` })
    }

    if (file.specifiersTruncated) {
      warnings.push({
        path: file.path,
        reason: `Over ${MAX_SPECIFIERS_PER_FILE} imports; listing truncated.`,
      })
    }
  }

  if (traversal.truncated) {
    warnings.push({
      path: null,
      reason:
        `Dependency traversal hit its bounds (${MAX_GRAPH_FILES} files, ` +
        `depth ${MAX_DEPTH}); external dependencies past the bounds are unknown.`,
    })
  }

  if (counters.edges >= MAX_EDGES) {
    warnings.push({
      path: null,
      reason: `Over ${MAX_EDGES} dependency edges; ordering used the first ${MAX_EDGES}.`,
    })
  }

  if (cycles.length > 0) {
    warnings.push({
      path: null,
      reason:
        `${cycles.length} import cycle(s) in the change set; ` +
        'cyclic members keep plan order.',
    })
  }

  const unresolved = []
  const externals = new Set()
  let unknownCount = 0

  for (const file of files) {
    for (const item of file.imports) {
      if (item.status === 'unresolved') {
        unresolved.push({ from: file.path, specifier: item.specifier, reason: item.reason })
      } else if (item.status === 'unknown') {
        unknownCount += 1
      } else if (item.status === 'external') {
        externals.add(item.specifier)
      }
    }
  }

  // Unresolved and unknown dependencies warn; they never block and
  // never trigger partial application.
  if (unresolved.length > 0 || unknownCount > 0) {
    warnings.push({
      path: null,
      reason:
        `${unresolved.length} unresolved and ${unknownCount} unknown ` +
        'import(s); order falls back to plan order where facts are missing.',
    })
  }

  warnings.push(
    ...staleDependencyWarnings(
      traversal.nodes,
      options && typeof options === 'object' ? options.baseline : null
    )
  )

  const edgeCount = edges.length
  const parts = []

  if (edgeCount > 0) {
    parts.push(`dependencies first (${edgeCount} in-set edge(s))`)
  } else {
    parts.push('no in-set dependencies found; plan order kept')
  }

  if (cyclicCount > 0) {
    parts.push(`${cyclicCount} cyclic member(s) keep plan order`)
  }

  if (unresolved.length > 0 || unknownCount > 0) {
    parts.push('unresolved/unknown imports keep plan order')
  }

  const manifest = {
    version: CHANGESET_VERSION,
    at: nowIso(),
    projectName: path.basename(root),
    targets: files,
    externalDependencies: traversal.nodes,
    edges,
    order,
    orderReason: `Apply order: ${parts.join('; ')}.`,
    cycles: cycles.map((cycle) =>
      cycle.map((index) => byIndex.get(index).display)
    ),
    conflicts: findConflicts(targets).map((group) => ({
      path: group[0].display,
      indexes: group.map((target) => target.index),
    })),
    reviewGroups: groups,
    unresolved: unresolved.slice(0, MAX_LISTED_REFS),
    totalUnresolved: unresolved.length,
    externals: [...externals].slice(0, MAX_LISTED_REFS),
    totalExternals: externals.size,
    totalUnknown: unknownCount,
    validation: {
      ok: blockers.length === 0,
      blockers,
      warnings,
    },
    bounds: {
      targets: targets.length,
      filesParsed: traversal.nodes.length + files.length,
      edges: counters.edges,
      depthReached: traversal.depthReached,
      truncated: traversal.truncated || counters.edges >= MAX_EDGES,
    },
  }

  log.info(
    `Change set: ${targets.length} target(s), ${edges.length} in-set edge(s), ` +
      `${blockers.length} blocker(s), ${warnings.length} warning(s).`
  )

  return manifest
}

module.exports = {
  CHANGESET_VERSION,
  MAX_EDITS,
  MAX_GRAPH_FILES,
  MAX_DEPTH,
  MAX_ANALYSIS_BYTES,
  buildChangeSet,
  canonicalTargetKey,
}
