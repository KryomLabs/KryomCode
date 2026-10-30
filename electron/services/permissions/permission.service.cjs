// Central capability and permission system (Level 4A.7 core).
// Shared by extensions, skills, workflows, integrations, and the
// developer API: every privileged operation checks here at the
// actual execution boundary. Renderer checks alone are never
// sufficient, and trust levels never auto-grant anything.
//
// Grants persist in user-data JSON (no secrets — grants name
// capabilities, never credentials). Denials throw clear errors so
// callers fail safely with an explanation.
const fs = require('node:fs/promises')
const path = require('node:path')

const PERMISSIONS_FILE = 'kryomcode-permissions.json'
const PERMISSIONS_VERSION = 1

// Granular, narrowly-scoped capabilities. There is intentionally no
// wildcard or admin permission: callers declare exactly what they
// need, and each grant names one capability.
const PERMISSIONS = {
  'workspace.metadata': {
    label: 'Workspace metadata',
    description: 'Read project name, file listing, and index status.',
    risk: 'low',
  },
  'workspace.read': {
    label: 'Read workspace files',
    description: 'Read file contents inside the open project.',
    risk: 'medium',
  },
  'workspace.write': {
    label: 'Write workspace files',
    description: 'Create or modify files inside the open project (approvals still apply).',
    risk: 'high',
  },
  'terminal.execute': {
    label: 'Execute terminal commands',
    description: 'Run commands through the guarded terminal service.',
    risk: 'high',
  },
  'network.access': {
    label: 'Network access',
    description: 'Make outbound network requests to declared hosts.',
    risk: 'high',
  },
  'ai.provider': {
    label: 'AI provider access',
    description: 'Send prompts to the configured AI provider.',
    risk: 'medium',
  },
  'ai.tools': {
    label: 'AI tool invocation',
    description: 'Invoke analysis, planning, and specialist tools.',
    risk: 'medium',
  },
  'git.read': {
    label: 'Read git state',
    description: 'Read status, history, remotes, and diffs.',
    risk: 'low',
  },
  'git.write': {
    label: 'Write git operations',
    description: 'Stage, commit, push, and pull (approvals still apply).',
    risk: 'high',
  },
  'integrations.external': {
    label: 'External service access',
    description: 'Use connected third-party integrations.',
    risk: 'high',
  },
  'templates.generate': {
    label: 'Generate projects',
    description: 'Create new projects from templates.',
    risk: 'medium',
  },
  'workflows.execute': {
    label: 'Execute workflows',
    description: 'Run multi-step workflows (approvals still apply).',
    risk: 'medium',
  },
}

const TRUST_LEVELS = ['builtin', 'user', 'third-party', 'untrusted']

const SUBJECT_PATTERN = /^(extension|skill|workflow|integration):[a-z0-9][a-z0-9._:-]{0,120}$/

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('Permission storage is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

function permissionsPath(baseDir) {
  return path.join(baseDir || defaultBaseDir(), PERMISSIONS_FILE)
}

function validatePermission(permission) {
  if (typeof permission !== 'string' || !PERMISSIONS[permission]) {
    throw new Error(`Unknown permission "${String(permission).slice(0, 80)}".`)
  }

  return permission
}

function validateSubject(subject) {
  if (typeof subject !== 'string' || !SUBJECT_PATTERN.test(subject)) {
    throw new Error(`Invalid permission subject "${String(subject).slice(0, 80)}".`)
  }

  return subject
}

function validateTrustLevel(level) {
  if (!TRUST_LEVELS.includes(level)) {
    throw new Error(`Invalid trust level "${String(level).slice(0, 40)}".`)
  }

  return level
}

function sanitizeStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: PERMISSIONS_VERSION, grants: {}, trust: {} }
  }

  const grants = {}

  if (value.grants && typeof value.grants === 'object' && !Array.isArray(value.grants)) {
    for (const [subject, entry] of Object.entries(value.grants)) {
      if (!SUBJECT_PATTERN.test(subject) || !entry || typeof entry !== 'object') {
        continue
      }

      const permissions = {}

      for (const [permission, grant] of Object.entries(entry)) {
        if (
          PERMISSIONS[permission] &&
          grant &&
          typeof grant === 'object' &&
          typeof grant.grantedAt === 'string'
        ) {
          permissions[permission] = { grantedAt: grant.grantedAt.slice(0, 40) }
        }
      }

      grants[subject] = permissions
    }
  }

  const trust = {}

  if (value.trust && typeof value.trust === 'object' && !Array.isArray(value.trust)) {
    for (const [subject, level] of Object.entries(value.trust)) {
      if (SUBJECT_PATTERN.test(subject) && TRUST_LEVELS.includes(level)) {
        trust[subject] = level
      }
    }
  }

  return { version: PERMISSIONS_VERSION, grants, trust }
}

async function readStore(baseDir) {
  try {
    const raw = await fs.readFile(permissionsPath(baseDir), 'utf8')

    return sanitizeStore(JSON.parse(raw))
  } catch {
    return sanitizeStore(null)
  }
}

async function writeStore(store, baseDir) {
  const sanitized = sanitizeStore(store)
  const filePath = permissionsPath(baseDir)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(sanitized, null, 2), 'utf8')

  return sanitized
}

function nowIso() {
  return new Date().toISOString()
}

// Non-throwing check for UI state and pre-flight messaging. The
// execution boundary must use requirePermission instead.
async function checkPermission(subject, permission, baseDir) {
  validateSubject(subject)
  validatePermission(permission)

  const store = await readStore(baseDir)
  const grant = store.grants[subject] && store.grants[subject][permission]

  return {
    subject,
    permission,
    granted: Boolean(grant),
    grantedAt: grant ? grant.grantedAt : null,
    trust: store.trust[subject] || 'untrusted',
  }
}

// Enforcement point: throws a clear denial unless the grant exists.
async function requirePermission(subject, permission, baseDir) {
  const checked = await checkPermission(subject, permission, baseDir)

  if (!checked.granted) {
    throw new Error(
      `Permission denied: "${subject}" lacks "${permission}" (${PERMISSIONS[permission].label}).`
    )
  }

  return checked
}

// Explicit grant — called only from user-confirmed IPC flows.
async function grantPermission(subject, permission, baseDir) {
  validateSubject(subject)
  validatePermission(permission)

  const store = await readStore(baseDir)

  if (!store.grants[subject]) {
    store.grants[subject] = {}
  }

  store.grants[subject][permission] = { grantedAt: nowIso() }

  await writeStore(store, baseDir)

  return checkPermission(subject, permission, baseDir)
}

async function revokePermission(subject, permission = null, baseDir) {
  validateSubject(subject)

  if (permission !== null) {
    validatePermission(permission)
  }

  const store = await readStore(baseDir)

  if (!store.grants[subject]) {
    return { subject, revoked: [] }
  }

  if (permission === null) {
    const revoked = Object.keys(store.grants[subject])

    delete store.grants[subject]
    await writeStore(store, baseDir)

    return { subject, revoked }
  }

  const had = Boolean(store.grants[subject][permission])

  delete store.grants[subject][permission]
  await writeStore(store, baseDir)

  return { subject, revoked: had ? [permission] : [] }
}

async function listGrants(subject = null, baseDir) {
  if (subject !== null) {
    validateSubject(subject)
  }

  const store = await readStore(baseDir)
  const subjects = subject === null ? Object.keys(store.grants).sort() : [subject]

  return {
    grants: subjects.map((entry) => ({
      subject: entry,
      trust: store.trust[entry] || 'untrusted',
      permissions: Object.entries(store.grants[entry] || {}).map(([permission, grant]) => ({
        permission,
        label: PERMISSIONS[permission].label,
        risk: PERMISSIONS[permission].risk,
        grantedAt: grant.grantedAt,
      })),
    })),
  }
}

async function setTrustLevel(subject, level, baseDir) {
  validateSubject(subject)
  validateTrustLevel(level)

  const store = await readStore(baseDir)

  store.trust[subject] = level

  await writeStore(store, baseDir)

  return { subject, trust: level }
}

function describePermissions() {
  return Object.entries(PERMISSIONS).map(([id, entry]) => ({ id, ...entry }))
}

module.exports = {
  PERMISSIONS,
  TRUST_LEVELS,
  validatePermission,
  validateSubject,
  validateTrustLevel,
  checkPermission,
  requirePermission,
  grantPermission,
  revokePermission,
  listGrants,
  setTrustLevel,
  describePermissions,
}
