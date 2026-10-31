const fs = require('node:fs/promises')
const path = require('node:path')

const {
  assertPlainObject,
  assertEnum,
  assertBoolean,
} = require('../../security/validate-input.cjs')

// Validated user-preference store. Preferences only: secrets must never
// be written here. The renderer will read settings and pass explicit
// per-request options (such as the model override) to backend channels.
const SETTINGS_FILE = 'kryomcode-settings.json'
// Model ids come from the registered Meta provider descriptor, the
// single source of truth — never a second hardcoded copy.
const { metaDescriptor } = require('../ai/providers/meta-muse.provider.cjs')
const SUPPORTED_DEFAULT_MODELS = metaDescriptor.models.map((model) => model.id)
const DEFAULT_MODEL = (
  metaDescriptor.models.find((model) => model.isDefault) ||
  metaDescriptor.models[0]
).id

// Panel dimensions in pixels. The backend guards only sanity bounds;
// the renderer enforces tighter UX limits and window-relative clamps.
const PANEL_KEYS = ['panelLeftWidth', 'panelRightWidth', 'panelBottomHeight']
const PANEL_MIN = 80
const PANEL_MAX = 2000

const DEFAULTS = {
  defaultModel: DEFAULT_MODEL,
  aiContextEnabled: true,
  confirmAllCommands: false,
  panelLeftWidth: 260,
  panelRightWidth: 360,
  panelBottomHeight: 264,
}

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('Settings storage is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

function settingsPath(baseDir) {
  return path.join(baseDir || defaultBaseDir(), SETTINGS_FILE)
}

function sanitizePanelSize(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(value)))
}

function sanitizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULTS }
  }

  const sanitized = {
    defaultModel: SUPPORTED_DEFAULT_MODELS.includes(value.defaultModel)
      ? value.defaultModel
      : DEFAULTS.defaultModel,
    aiContextEnabled: typeof value.aiContextEnabled === 'boolean'
      ? value.aiContextEnabled
      : DEFAULTS.aiContextEnabled,
    confirmAllCommands: typeof value.confirmAllCommands === 'boolean'
      ? value.confirmAllCommands
      : DEFAULTS.confirmAllCommands,
  }

  for (const key of PANEL_KEYS) {
    sanitized[key] = sanitizePanelSize(value[key], DEFAULTS[key])
  }

  return sanitized
}

async function readSettings(baseDir) {
  try {
    const raw = await fs.readFile(settingsPath(baseDir), 'utf8')

    return sanitizeSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULTS }
  }
}

function validatePatch(patch) {
  assertPlainObject(patch, 'settings patch')

  const validated = {}

  if (patch.defaultModel !== undefined) {
    validated.defaultModel = assertEnum(
      patch.defaultModel,
      'defaultModel',
      SUPPORTED_DEFAULT_MODELS
    )
  }

  if (patch.aiContextEnabled !== undefined) {
    validated.aiContextEnabled = assertBoolean(
      patch.aiContextEnabled,
      'aiContextEnabled'
    )
  }

  if (patch.confirmAllCommands !== undefined) {
    validated.confirmAllCommands = assertBoolean(
      patch.confirmAllCommands,
      'confirmAllCommands'
    )
  }

  for (const key of PANEL_KEYS) {
    if (patch[key] !== undefined) {
      validated[key] = assertPanelSize(patch[key], key)
    }
  }

  return validated
}

function assertPanelSize(value, name) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < PANEL_MIN ||
    value > PANEL_MAX
  ) {
    throw new Error(
      `Invalid ${name}: expected a number between ${PANEL_MIN} and ${PANEL_MAX}.`
    )
  }

  return Math.round(value)
}

async function updateSettings(patch, baseDir) {
  const validated = validatePatch(patch)
  const current = await readSettings(baseDir)
  const next = { ...current, ...validated }
  const filePath = settingsPath(baseDir)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf8')

  return next
}

module.exports = {
  DEFAULTS,
  SUPPORTED_DEFAULT_MODELS,
  readSettings,
  updateSettings,
}
