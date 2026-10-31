// Research session persistence. Sessions live inside the open
// workspace under `.kryom/research/` so they travel with the project,
// survive restarts, and reuse existing workspace containment rules.
// No new database: one JSON file per session plus a markdown brief.
// All reads and writes go through the storage-path layer, which
// rejects symlinks and junctions in the chain and writes atomically.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  ensureStorageDir,
  listStorageFiles,
  readStorageFile,
  writeStorageFile,
  resolveStoragePath,
} = require('../../security/storage-path.cjs')
const { resolveDepth, DEFAULT_DEPTH } = require('./depth-profiles.cjs')

const RESEARCH_DIR = '.kryom'
const SESSIONS_DIR = 'research'
const SESSION_VERSION = 2
const MAX_OBJECTIVE_LENGTH = 2000
const MAX_SESSIONS_LISTED = 50
const MAX_NAME_LENGTH = 120
const MAX_SEARCH_RESULTS = 20

function assertValidSessionId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
    throw new Error('Invalid research session id.')
  }

  return id
}

function sessionsRoot() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  return path.join(root, RESEARCH_DIR, SESSIONS_DIR)
}

// Logical segments below the workspace root. Every helper resolves
// them through the storage-path layer; never join them by hand for
// filesystem access.
function sessionSegments(name) {
  return [RESEARCH_DIR, SESSIONS_DIR, name]
}

function openRoot() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  return root
}

function sessionFile(id) {
  return path.join(sessionsRoot(), `${assertValidSessionId(id)}.json`)
}

function briefFile(id) {
  return path.join(sessionsRoot(), `brief-${assertValidSessionId(id)}.md`)
}

function activeFile() {
  return path.join(sessionsRoot(), 'active.json')
}

function nowIso() {
  return new Date().toISOString()
}

function generateSessionId() {
  const stamp = Date.now().toString(36)
  const random = crypto.randomBytes(3).toString('hex')

  return `rs-${stamp}-${random}`
}

function blankSteps() {
  const labels = [
    ['planning', 'Planning research'],
    ['searching', 'Searching the web'],
    ['papers', 'Finding scientific papers'],
    ['reading', 'Reading available sources'],
    ['comparing', 'Comparing evidence'],
    ['synthesizing', 'Synthesizing findings'],
    ['brief', 'Preparing the research brief'],
  ]

  return labels.map(([id, label]) => ({
    id,
    label,
    status: 'pending',
    detail: '',
    error: '',
    startedAt: null,
    finishedAt: null,
  }))
}

function blankPlan() {
  return {
    subQuestions: [],
    searchTerms: [],
    evidenceNeeds: [],
    ambiguityNotes: [],
    via: '',
  }
}

function createSessionRecord(objective, options = {}) {
  if (typeof objective !== 'string' || !objective.trim() || objective.length > MAX_OBJECTIVE_LENGTH) {
    throw new Error(`Invalid objective: provide text up to ${MAX_OBJECTIVE_LENGTH} characters.`)
  }

  const stamp = nowIso()
  const name = typeof options.name === 'string' ? options.name.trim().slice(0, MAX_NAME_LENGTH) : ''

  return {
    id: generateSessionId(),
    version: SESSION_VERSION,
    objective: objective.trim(),
    name,
    depth: resolveDepth(options.depth),
    questions: [],
    queries: [],
    steps: blankSteps(),
    plan: blankPlan(),
    sources: [],
    evidence: [],
    findings: [],
    claims: [],
    conflicts: [],
    decisions: [],
    brief: { version: 0, markdown: '', generatedAt: null, via: '' },
    implementationTasks: [],
    verification: [],
    errors: [],
    status: 'running',
    statusDetail: 'Research started.',
    createdAt: stamp,
    updatedAt: stamp,
  }
}

function sanitizeSession(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Research session file is corrupt.')
  }

  const session = { ...raw }

  if (!Array.isArray(session.steps)) {
    session.steps = blankSteps()
  }

  for (const key of ['questions', 'queries', 'sources', 'evidence', 'findings', 'claims', 'conflicts', 'decisions', 'implementationTasks', 'verification', 'errors']) {
    if (!Array.isArray(session[key])) {
      session[key] = []
    }
  }

  if (!session.brief || typeof session.brief !== 'object') {
    session.brief = { version: 0, markdown: '', generatedAt: null, via: '' }
  }

  // v1 → v2 migration: default every deep-research field so old
  // sessions reopen safely, and backfill stable source ids.
  if (typeof session.name !== 'string') {
    session.name = ''
  }

  try {
    session.depth = resolveDepth(session.depth)
  } catch {
    session.depth = DEFAULT_DEPTH
  }

  if (!session.plan || typeof session.plan !== 'object' || Array.isArray(session.plan)) {
    session.plan = blankPlan()
  } else {
    const plan = session.plan

    for (const key of ['subQuestions', 'searchTerms', 'evidenceNeeds', 'ambiguityNotes']) {
      if (!Array.isArray(plan[key])) {
        plan[key] = []
      }
    }

    if (typeof plan.via !== 'string') {
      plan.via = ''
    }
  }

  session.sources = session.sources.filter((entry) => entry && typeof entry === 'object')

  for (const source of session.sources) {
    if (typeof source.id !== 'string' || !source.id) {
      source.id = backfillSourceId(source)
    }

    if (!Array.isArray(source.supports)) {
      source.supports = []
    }

    if (typeof source.retrievedAt !== 'string') {
      source.retrievedAt = null
    }

    if (!source.quality || typeof source.quality !== 'object') {
      source.quality = null
    }
  }

  session.version = SESSION_VERSION

  return session
}

// Backfills a stable id for v1 sources. Same derivation as
// normalizeSource (DOI-first canonical key) so ids stay consistent.
function backfillSourceId(source) {
  try {
    const { canonicalKey } = require('./search-providers.cjs')
    const key = canonicalKey({
      url: typeof source.url === 'string' ? source.url : '',
      doi: typeof source.doi === 'string' ? source.doi : null,
    })

    return `src-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`
  } catch {
    return `src-${crypto.randomBytes(6).toString('hex')}`
  }
}

async function ensureDir() {
  await ensureStorageDir(openRoot(), [RESEARCH_DIR, SESSIONS_DIR])
}

async function createSession(objective, options = {}) {
  const session = createSessionRecord(objective, options)

  await writeStorageFile(
    openRoot(),
    sessionSegments(`${session.id}.json`),
    JSON.stringify(session, null, 2)
  )
  await setActiveSession(session.id)

  return session
}

async function readSession(id) {
  assertValidSessionId(id)

  const { found, data } = await readStorageFile(
    openRoot(),
    sessionSegments(`${id}.json`)
  )

  if (!found) {
    throw new Error('Research session was not found.')
  }

  return sanitizeSession(JSON.parse(data))
}

async function writeSession(session) {
  if (!session || !session.id) {
    throw new Error('Invalid research session.')
  }

  assertValidSessionId(session.id)

  session.updatedAt = nowIso()

  await writeStorageFile(
    openRoot(),
    sessionSegments(`${session.id}.json`),
    JSON.stringify(session, null, 2)
  )

  return session
}

async function writeBrief(id, markdown) {
  assertValidSessionId(id)

  await writeStorageFile(
    openRoot(),
    sessionSegments(`brief-${id}.md`),
    markdown
  )

  return briefFile(id)
}

async function readBrief(id) {
  assertValidSessionId(id)

  const { found, data } = await readStorageFile(
    openRoot(),
    sessionSegments(`brief-${id}.md`)
  )

  if (!found) {
    throw new Error('Research brief was not found.')
  }

  return data
}

async function listSessions() {
  const files = await listStorageFiles(openRoot(), [RESEARCH_DIR, SESSIONS_DIR])
  const sessions = []

  for (const { name, path: file } of files) {
    if (!name.endsWith('.json') || name === 'active.json') {
      continue
    }

    try {
      const raw = await fs.readFile(file, 'utf8')
      const session = sanitizeSession(JSON.parse(raw))

      sessions.push({
        id: session.id,
        objective: session.objective,
        name: typeof session.name === 'string' ? session.name : '',
        depth: session.depth || DEFAULT_DEPTH,
        status: session.status,
        sources: session.sources.length,
        briefVersion: session.brief.version,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
      })
    } catch {
      // Skip unreadable files; list stays honest about what loaded.
    }
  }

  sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))

  return sessions.slice(0, MAX_SESSIONS_LISTED)
}

async function setActiveSession(id) {
  assertValidSessionId(id)

  await writeStorageFile(
    openRoot(),
    sessionSegments('active.json'),
    JSON.stringify({ id })
  )

  return { id }
}

async function getActiveSessionId() {
  try {
    const { found, data } = await readStorageFile(
      openRoot(),
      sessionSegments('active.json')
    )

    if (!found) {
      return null
    }

    const parsed = JSON.parse(data)

    if (parsed && typeof parsed.id === 'string') {
      return assertValidSessionId(parsed.id)
    }

    return null
  } catch {
    return null
  }
}

async function getActiveSession() {
  const id = await getActiveSessionId()

  if (!id) {
    return null
  }

  try {
    return await readSession(id)
  } catch {
    return null
  }
}

async function renameSession(id, name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME_LENGTH) {
    throw new Error(`Invalid name: provide text up to ${MAX_NAME_LENGTH} characters.`)
  }

  const session = await readSession(id)

  session.name = name.trim()
  await writeSession(session)

  return session
}

async function deleteSessionFile(root, segments) {
  const { path: file, exists } = await resolveStoragePath(root, segments)

  if (!exists) {
    return false
  }

  const stat = await fs.lstat(file)

  // Mirrors the storage layer: links are never followed, and only
  // regular files inside the validated research dir are removed.
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Refusing to delete a non-file research entry.')
  }

  await fs.unlink(file)

  return true
}

async function deleteSession(id) {
  assertValidSessionId(id)

  const root = openRoot()
  const removed = await deleteSessionFile(root, sessionSegments(`${id}.json`))

  if (!removed) {
    throw new Error('Research session was not found.')
  }

  await deleteSessionFile(root, sessionSegments(`brief-${id}.md`)).catch(() => false)

  const activeId = await getActiveSessionId().catch(() => null)

  if (activeId === id) {
    const remaining = await listSessions()

    if (remaining.length > 0) {
      await setActiveSession(remaining[0].id)
    } else {
      await deleteSessionFile(root, sessionSegments('active.json')).catch(() => false)
    }
  }

  return { id, deleted: true }
}

async function searchSessions(query) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('A search query is required.')
  }

  const needle = query.trim().toLowerCase().slice(0, 200)
  const sessions = await listSessions()

  return sessions
    .filter((entry) => (
      String(entry.objective || '').toLowerCase().includes(needle)
      || String(entry.name || '').toLowerCase().includes(needle)
      || String(entry.id || '').toLowerCase().includes(needle)
    ))
    .slice(0, MAX_SEARCH_RESULTS)
}

module.exports = {
  createSession,
  readSession,
  writeSession,
  writeBrief,
  readBrief,
  listSessions,
  searchSessions,
  renameSession,
  deleteSession,
  setActiveSession,
  getActiveSessionId,
  getActiveSession,
  blankSteps,
  blankPlan,
  sessionsRoot,
  MAX_OBJECTIVE_LENGTH,
  MAX_NAME_LENGTH,
}
