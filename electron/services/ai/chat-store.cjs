// Multi-session chat persistence. The renderer's chat histories
// is autosaved per project under `.kryom/chat.json` so it survives
// restarts; without an open project there is nothing to attach to
// and both operations report honestly instead of throwing. Stored
// messages are sanitized on read AND write: roles are restricted,
// content is capped, and malformed entries are dropped.
//
// Storage layout note: history stays per-project inside the workspace
// (callers, tests, and restart-restore rely on it) rather than moving
// to userData, which would orphan existing histories. Containment
// comes from the storage-path layer: symlinks and junctions in the
// chain are rejected and writes land atomically, so a hostile project
// cannot redirect reads or writes outside the workspace. Anyone with
// project access can still read `.kryom` like any project file, so it
// must never be shared or committed.
const {
  getWorkspaceRoot,
  getPreviousWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const {
  readStorageFile,
  writeStorageFile,
  listStorageFiles,
} = require('../../security/storage-path.cjs')

const CHAT_SEGMENTS = ['.kryom', 'chat.json']
const MAX_MESSAGES = 50
const MAX_MESSAGE_CHARS = 12000
const MAX_MODEL_CHARS = 100
const SESSIONS_DIR = ['.kryom', 'chat', 'sessions']
const ACTIVE_SEGMENTS = ['.kryom', 'chat', 'active.json']
const MAX_SESSIONS = 50
const MAX_TITLE_CHARS = 80
const GENERAL_SESSION_ID = 'general'
const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/

function sanitizeMessages(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (entry) =>
        entry &&
        (entry.role === 'user' || entry.role === 'assistant') &&
        typeof entry.content === 'string'
    )
    .slice(-MAX_MESSAGES)
    .map((entry) => ({
      role: entry.role,
      content: entry.content.slice(0, MAX_MESSAGE_CHARS),
      ...(typeof entry.model === 'string' && entry.model
        ? { model: entry.model.slice(0, MAX_MODEL_CHARS) }
        : {}),
    }))
}

async function saveChat(messages, { root } = {}) {
  const current = getWorkspaceRoot()
  const target = root ?? current

  if (!target) {
    return { saved: false, reason: 'No project is open.' }
  }

  // Generation guard: a save bound to a project that is neither open
  // nor the just-replaced one is stale (two rapid switches). Report
  // honestly instead of writing another project's history.
  if (target !== current && target !== getPreviousWorkspaceRoot()) {
    return { saved: false, reason: 'Project changed during save.' }
  }

  const activeId = await getActiveSessionId(target)
  const previous = await readSessionFile(target, activeId)
  const clean = sanitizeMessages(messages)

  const stored = await writeSessionFile(target, activeId, {
    title: (previous && previous.title) || 'Conversation',
    messages: clean,
  })

  return { saved: true, messages: stored.messages }
}

async function restoreChat() {
  const root = getWorkspaceRoot()

  if (!root) {
    return { messages: [], restored: false }
  }

  const activeId = await getActiveSessionId(root)
  const record = await readSessionFile(root, activeId)
  const messages = record ? record.messages : []

  return { messages, restored: messages.length > 0 }
}

// Named sessions (Level 4B): the legacy `.kryom/chat.json` file is
// the implicit `general` session, so existing histories keep working
// with no migration. Named sessions live beside it; the active
// pointer decides what saveChat/restoreChat read and write.
function assertSessionId(id) {
  if (
    typeof id !== 'string' ||
    (id !== GENERAL_SESSION_ID && !SESSION_ID_PATTERN.test(id))
  ) {
    throw new Error('Invalid chat session id.')
  }

  return id
}

function sanitizeTitle(value, fallback) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS)

  return text || fallback
}

function sessionSegments(id) {
  return [...SESSIONS_DIR, `${id}.json`]
}

function generateSessionId() {
  return `ch-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

async function readSessionFile(root, id) {
  const segments = id === GENERAL_SESSION_ID ? CHAT_SEGMENTS : sessionSegments(id)
  const { found, data } = await readStorageFile(root, segments)

  if (!found) {
    return null
  }

  try {
    const parsed = JSON.parse(data)

    return {
      messages: sanitizeMessages(parsed && parsed.messages),
      title: typeof parsed.title === 'string' ? parsed.title : null,
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : typeof parsed.savedAt === 'string'
            ? parsed.savedAt
            : null,
    }
  } catch {
    // Corrupted sessions read empty rather than crashing chat.
    return { messages: [], title: null, updatedAt: null }
  }
}

async function getActiveSessionId(root) {
  const { found, data } = await readStorageFile(root, ACTIVE_SEGMENTS)

  if (!found) {
    return GENERAL_SESSION_ID
  }

  try {
    const parsed = JSON.parse(data)

    if (
      parsed &&
      (parsed.id === GENERAL_SESSION_ID ||
        (typeof parsed.id === 'string' && SESSION_ID_PATTERN.test(parsed.id)))
    ) {
      return parsed.id
    }
  } catch {
    // Corrupted pointer falls back to the general conversation.
  }

  return GENERAL_SESSION_ID
}

async function writeSessionFile(root, id, { title, messages }) {
  const cleaned = sanitizeMessages(messages)
  const now = new Date().toISOString()

  if (id === GENERAL_SESSION_ID) {
    // Legacy shape, byte-stable for existing readers.
    await writeStorageFile(
      root,
      CHAT_SEGMENTS,
      JSON.stringify({ version: 1, savedAt: now, messages: cleaned })
    )
  } else {
    await writeStorageFile(
      root,
      sessionSegments(id),
      JSON.stringify({ version: 1, id, title, updatedAt: now, messages: cleaned })
    )
  }

  return { messages: cleaned.length, updatedAt: now }
}

async function listChatSessions() {
  const root = getWorkspaceRoot()

  if (!root) {
    return { sessions: [], activeId: GENERAL_SESSION_ID }
  }

  const activeId = await getActiveSessionId(root)
  const sessions = []
  const general = await readSessionFile(root, GENERAL_SESSION_ID)

  sessions.push({
    id: GENERAL_SESSION_ID,
    title: 'General',
    messageCount: general ? general.messages.length : 0,
    updatedAt: general ? general.updatedAt : null,
  })

  let files = []

  try {
    files = await listStorageFiles(root, SESSIONS_DIR)
  } catch {
    files = []
  }

  for (const file of files.slice(0, MAX_SESSIONS * 2)) {
    if (!file || typeof file.name !== 'string' || !file.name.endsWith('.json')) {
      continue
    }

    const id = file.name.slice(0, -'.json'.length)

    if (!SESSION_ID_PATTERN.test(id)) {
      continue
    }

    const record = await readSessionFile(root, id)

    if (!record) {
      continue
    }

    sessions.push({
      id,
      title: record.title || 'Conversation',
      messageCount: record.messages.length,
      updatedAt: record.updatedAt,
    })

    if (sessions.length >= MAX_SESSIONS + 1) {
      break
    }
  }

  sessions.sort((a, b) => {
    if (a.id === GENERAL_SESSION_ID) {
      return -1
    }

    if (b.id === GENERAL_SESSION_ID) {
      return 1
    }

    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  })

  const active =
    sessions.some((entry) => entry.id === activeId) ? activeId : GENERAL_SESSION_ID

  return { sessions, activeId: active }
}

async function createChatSession(title) {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  const { sessions } = await listChatSessions()

  if (sessions.length >= MAX_SESSIONS + 1) {
    throw new Error(`Conversation limit reached (${MAX_SESSIONS + 1}). Delete one first.`)
  }

  const id = generateSessionId()
  const cleanTitle = sanitizeTitle(title, `Conversation ${sessions.length}`)

  await writeSessionFile(root, id, { title: cleanTitle, messages: [] })
  await writeStorageFile(root, ACTIVE_SEGMENTS, JSON.stringify({ version: 1, id }))

  return { id, title: cleanTitle, messageCount: 0, updatedAt: new Date().toISOString() }
}

async function switchChatSession(id) {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  assertSessionId(id)

  const record = await readSessionFile(root, id)

  if (!record && id !== GENERAL_SESSION_ID) {
    throw new Error('Conversation was not found.')
  }

  await writeStorageFile(root, ACTIVE_SEGMENTS, JSON.stringify({ version: 1, id }))

  return {
    id,
    title: id === GENERAL_SESSION_ID ? 'General' : (record && record.title) || 'Conversation',
    messages: record ? record.messages : [],
  }
}

async function renameChatSession(id, title) {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  assertSessionId(id)

  if (id === GENERAL_SESSION_ID) {
    throw new Error('The General conversation cannot be renamed.')
  }

  const record = await readSessionFile(root, id)

  if (!record) {
    throw new Error('Conversation was not found.')
  }

  const cleanTitle = sanitizeTitle(title, 'Conversation')
  const stored = await writeSessionFile(root, id, { title: cleanTitle, messages: record.messages })

  return { id, title: cleanTitle, messageCount: stored.messages, updatedAt: stored.updatedAt }
}

async function deleteChatSession(id) {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  assertSessionId(id)

  if (id === GENERAL_SESSION_ID) {
    throw new Error('The General conversation cannot be deleted. Clear it instead.')
  }

  const { resolveStoragePath } = require('../../security/storage-path.cjs')
  const located = await resolveStoragePath(root, sessionSegments(id))

  if (!located.exists) {
    throw new Error('Conversation was not found.')
  }

  await fs.unlink(located.path).catch((error) => {
    if (!error || error.code !== 'ENOENT') {
      throw error
    }
  })

  const activeId = await getActiveSessionId(root)

  if (activeId === id) {
    await writeStorageFile(
      root,
      ACTIVE_SEGMENTS,
      JSON.stringify({ version: 1, id: GENERAL_SESSION_ID })
    )
  }

  return { id, deleted: true }
}

module.exports = {
  saveChat,
  restoreChat,
  sanitizeMessages,
  listChatSessions,
  createChatSession,
  switchChatSession,
  renameChatSession,
  deleteChatSession,
}
