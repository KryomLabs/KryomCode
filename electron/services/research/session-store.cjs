// Research session persistence. Sessions live inside the open
// workspace under `.kryom/research/` so they travel with the project,
// survive restarts, and reuse existing workspace containment rules.
// No new database: one JSON file per session plus a markdown brief.
// All reads and writes go through the storage-path layer, which
// rejects symlinks and junctions in the chain and writes atomically.
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
} = require('../../security/storage-path.cjs')

const RESEARCH_DIR = '.kryom'
const SESSIONS_DIR = 'research'
const SESSION_VERSION = 1
const MAX_OBJECTIVE_LENGTH = 2000
const MAX_SESSIONS_LISTED = 50

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
  const random = Math.random().toString(36).slice(2, 8)

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

function createSessionRecord(objective) {
  if (typeof objective !== 'string' || !objective.trim() || objective.length > MAX_OBJECTIVE_LENGTH) {
    throw new Error(`Invalid objective: provide text up to ${MAX_OBJECTIVE_LENGTH} characters.`)
  }

  const stamp = nowIso()

  return {
    id: generateSessionId(),
    version: SESSION_VERSION,
    objective: objective.trim(),
    questions: [],
    queries: [],
    steps: blankSteps(),
    sources: [],
    evidence: [],
    findings: [],
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

  for (const key of ['questions', 'queries', 'sources', 'evidence', 'findings', 'decisions', 'implementationTasks', 'verification', 'errors']) {
    if (!Array.isArray(session[key])) {
      session[key] = []
    }
  }

  if (!session.brief || typeof session.brief !== 'object') {
    session.brief = { version: 0, markdown: '', generatedAt: null, via: '' }
  }

  return session
}

async function ensureDir() {
  await ensureStorageDir(openRoot(), [RESEARCH_DIR, SESSIONS_DIR])
}

async function createSession(objective) {
  const session = createSessionRecord(objective)

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

module.exports = {
  createSession,
  readSession,
  writeSession,
  writeBrief,
  readBrief,
  listSessions,
  setActiveSession,
  getActiveSessionId,
  getActiveSession,
  blankSteps,
  sessionsRoot,
  MAX_OBJECTIVE_LENGTH,
}
