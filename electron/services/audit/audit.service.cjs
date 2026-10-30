// Security audit log (Level 4A.7). Bounded, append-only JSONL in
// user data recording security-relevant platform events. Details
// are redacted and length-bounded: audit records must never hold
// secrets, credentials, or file contents.
const fs = require('node:fs/promises')
const path = require('node:path')

const { redactText } = require('../../utils/logger.cjs')

const AUDIT_FILE = 'kryomcode-audit.jsonl'
const MAX_EVENTS = 500
const MAX_DETAIL_CHARS = 500

const AUDIT_TYPES = [
  'extension.installed',
  'extension.activated',
  'extension.deactivated',
  'extension.uninstalled',
  'extension.activation-failed',
  'permission.granted',
  'permission.denied',
  'permission.revoked',
  'integration.connected',
  'integration.disconnected',
  'workflow.started',
  'workflow.finished',
  'workflow.approved',
  'provider.fallback-used',
  'provider.key-saved',
  'provider.key-removed',
  'security.denial',
]

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('Audit storage is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

function auditPath(baseDir) {
  return path.join(baseDir || defaultBaseDir(), AUDIT_FILE)
}

function validateType(type) {
  if (typeof type !== 'string' || !AUDIT_TYPES.includes(type)) {
    throw new Error(`Unknown audit event "${String(type).slice(0, 80)}".`)
  }

  return type
}

async function readEvents(baseDir) {
  try {
    const raw = await fs.readFile(auditPath(baseDir), 'utf8')
    const events = []

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()

      if (!trimmed) {
        continue
      }

      try {
        const parsed = JSON.parse(trimmed)

        if (parsed && typeof parsed === 'object' && AUDIT_TYPES.includes(parsed.type)) {
          events.push(parsed)
        }
      } catch {
        // Corrupt lines are skipped; the log stays readable.
      }
    }

    return events
  } catch {
    return []
  }
}

async function appendAudit(type, { subject = null, detail = '', outcome = null } = {}, baseDir) {
  validateType(type)

  const event = {
    at: new Date().toISOString(),
    type,
    subject: typeof subject === 'string' ? subject.slice(0, 200) : null,
    detail: redactText(String(detail || '')).slice(0, MAX_DETAIL_CHARS),
    outcome: typeof outcome === 'string' ? outcome.slice(0, 60) : null,
  }

  const filePath = auditPath(baseDir)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8')

  // Bounded retention: Trim oldest past the cap. Best-effort — the
  // event itself is already stored.
  try {
    const events = await readEvents(baseDir)

    if (events.length > MAX_EVENTS) {
      const kept = events.slice(-MAX_EVENTS)

      await fs.writeFile(filePath, `${kept.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
    }
  } catch {
    // Retention failure never fails the audited operation.
  }

  return event
}

async function listAudit({ limit = 100, baseDir } = {}) {
  const bounded = Math.min(Math.max(1, limit), MAX_EVENTS)
  const events = await readEvents(baseDir)

  return {
    events: events.slice(-bounded).reverse(),
    total: events.length,
  }
}

module.exports = {
  AUDIT_TYPES,
  MAX_EVENTS,
  appendAudit,
  listAudit,
}
