// Renderer-independent UI state: auto-save flag plus the recent-project
// list. Paths and booleans only: secrets must never be written here.
// Stored in the Electron user-data folder, next to the settings file.
const fs = require('node:fs/promises')
const path = require('node:path')

const UI_STATE_FILE = 'kryomcode-ui.json'
const MAX_RECENT = 8

const DEFAULTS = {
  autoSave: false,
  recent: [],
}

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('UI state storage is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

function uiStatePath(baseDir) {
  return path.join(baseDir || defaultBaseDir(), UI_STATE_FILE)
}

function sanitizeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULTS, recent: [] }
  }

  const sanitized = {
    autoSave: value.autoSave === true,
    recent: [],
  }

  if (Array.isArray(value.recent)) {
    const seen = new Set()

    for (const entry of value.recent) {
      if (typeof entry !== 'string') {
        continue
      }

      const trimmed = entry.trim().slice(0, 2000)
      const key = trimmed.toLowerCase()

      if (!trimmed || seen.has(key)) {
        continue
      }

      seen.add(key)
      sanitized.recent.push(trimmed)

      if (sanitized.recent.length >= MAX_RECENT) {
        break
      }
    }
  }

  return sanitized
}

async function readUIState(baseDir) {
  try {
    const raw = await fs.readFile(uiStatePath(baseDir), 'utf8')

    return sanitizeState(JSON.parse(raw))
  } catch {
    return { ...DEFAULTS, recent: [] }
  }
}

async function writeUIState(state, baseDir) {
  const sanitized = sanitizeState(state)
  const filePath = uiStatePath(baseDir)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(sanitized, null, 2), 'utf8')

  return sanitized
}

async function addRecent(root, baseDir) {
  if (typeof root !== 'string' || !root.trim()) {
    throw new Error('Invalid recent path.')
  }

  const current = await readUIState(baseDir)
  const trimmed = root.trim().slice(0, 2000)
  const rest = current.recent.filter(
    (entry) => entry.toLowerCase() !== trimmed.toLowerCase()
  )

  return writeUIState(
    { ...current, recent: [trimmed, ...rest].slice(0, MAX_RECENT) },
    baseDir
  )
}

async function clearRecent(baseDir) {
  const current = await readUIState(baseDir)

  return writeUIState({ ...current, recent: [] }, baseDir)
}

async function removeRecent(root, baseDir) {
  if (typeof root !== 'string' || !root.trim()) {
    throw new Error('Invalid recent path.')
  }

  const current = await readUIState(baseDir)
  const trimmed = root.trim().toLowerCase()
  const recent = current.recent.filter(
    (entry) => entry.toLowerCase() !== trimmed
  )

  if (recent.length === current.recent.length) {
    return current
  }

  return writeUIState({ ...current, recent }, baseDir)
}

async function setAutoSave(value, baseDir) {
  if (typeof value !== 'boolean') {
    throw new Error('Invalid autoSave: expected a boolean.')
  }

  const current = await readUIState(baseDir)

  return writeUIState({ ...current, autoSave: value }, baseDir)
}

module.exports = {
  DEFAULTS,
  MAX_RECENT,
  sanitizeState,
  readUIState,
  writeUIState,
  addRecent,
  clearRecent,
  removeRecent,
  setAutoSave,
}
