// Single-conversation chat persistence. The renderer's chat history
// is autosaved per project under `.kryom/chat.json` so it survives
// restarts; without an open project there is nothing to attach to
// and both operations report honestly instead of throwing. Stored
// messages are sanitized on read AND write: roles are restricted,
// content is capped, and malformed entries are dropped.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')

const CHAT_FILE = 'chat.json'
const MAX_MESSAGES = 50
const MAX_MESSAGE_CHARS = 12000
const MAX_MODEL_CHARS = 100

function chatFile() {
  const root = getWorkspaceRoot()

  if (!root) {
    return null
  }

  return path.join(root, '.kryom', CHAT_FILE)
}

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

async function saveChat(messages) {
  const file = chatFile()

  if (!file) {
    return { saved: false, reason: 'No project is open.' }
  }

  const clean = sanitizeMessages(messages)

  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    JSON.stringify({ version: 1, savedAt: new Date().toISOString(), messages: clean }),
    'utf8'
  )

  return { saved: true, messages: clean.length }
}

async function restoreChat() {
  const file = chatFile()

  if (!file) {
    return { messages: [], restored: false }
  }

  let raw = null

  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { messages: [], restored: false }
    }

    throw error
  }

  let parsed = null

  try {
    parsed = JSON.parse(raw)
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
