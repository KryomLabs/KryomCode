// Research session persistence. Sessions live inside the open
// workspace under `.kryom/research/` so they travel with the project,
// survive restarts, and reuse existing workspace containment rules.
// No new database: one JSON file per session plus a markdown brief.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')

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
  await fs.mkdir(sessionsRoot(), { recursive: true })
}

async function createSession(objective) {
  await ensureDir()

  const session = createSessionRecord(objective)

  await fs.writeFile(sessionFile(session.id), JSON.stringify(session, null, 2), 'utf8')
  await setActiveSession(session.id)

  return session
}

async function readSession(id) {
  assertValidSessionId(id)

  try {
    const raw = await fs.readFile(sessionFile(id), 'utf8')

    return sanitizeSession(JSON.parse(raw))
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Research session was not found.')
    }

    throw error
  }
}

async function writeSession(session) {
  if (!session || !session.id) {
    throw new Error('Invalid research session.')
  }

  assertValidSessionId(session.id)
  await ensureDir()

  session.updatedAt = nowIso()

  await fs.writeFile(sessionFile(session.id), JSON.stringify(session, null, 2), 'utf8')

  return session
}

async function writeBrief(id, markdown) {
  assertValidSessionId(id)
  await ensureDir()
  await fs.writeFile(briefFile(id), markdown, 'utf8')

  return briefFile(id)
}

async function readBrief(id) {
  assertValidSessionId(id)

  try {
    return await fs.readFile(briefFile(id), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Research brief was not found.')
    }

    throw error
  }
}

async function listSessions() {
  await ensureDir()

  let entries = []

  try {
    entries = await fs.readdir(sessionsRoot())
  } catch {
    return []
  }

  const sessions = []

  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry === 'active.json') {
      continue
    }

    try {
      const raw = await fs.readFile(path.join(sessionsRoot(), entry), 'utf8')
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
  await ensureDir()
  await fs.writeFile(activeFile(), JSON.stringify({ id }), 'utf8')

  return { id }
}

async function getActiveSessionId() {
  try {
    const raw = await fs.readFile(activeFile(), 'utf8')
    const parsed = JSON.parse(raw)

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
