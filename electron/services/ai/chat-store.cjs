// Single-conversation chat persistence. The renderer's chat history
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
const {
  readStorageFile,
  writeStorageFile,
} = require('../../security/storage-path.cjs')

const CHAT_SEGMENTS = ['.kryom', 'chat.json']
const MAX_MESSAGES = 50
const MAX_MESSAGE_CHARS = 12000
const MAX_MODEL_CHARS = 100

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

  const clean = sanitizeMessages(messages)

  await writeStorageFile(
    target,
    CHAT_SEGMENTS,
    JSON.stringify({ version: 1, savedAt: new Date().toISOString(), messages: clean })
  )

  return { saved: true, messages: clean.length }
}

async function restoreChat() {
  const root = getWorkspaceRoot()

  if (!root) {
    return { messages: [], restored: false }
  }

  const { found, data } = await readStorageFile(root, CHAT_SEGMENTS)

  if (!found) {
    return { messages: [], restored: false }
  }

  let parsed = null

  try {
    parsed = JSON.parse(data)
  } catch {
    // Corrupted history starts empty rather than crashing chat.
    return { messages: [], restored: false }
  }

  const messages = sanitizeMessages(parsed && parsed.messages)

  return { messages, restored: messages.length > 0 }
}

module.exports = {
  saveChat,
  restoreChat,
  sanitizeMessages,
}
