// Pre-apply file freshness (Level 3B.1). Compares each planned edit
// against the workspace as it is right now, so the agent never
// overwrites files that changed since planning or approval. Read-only:
// referenced files only, size short-circuits before any hashing, and
// malformed entries throw fail-closed while environment problems
// (missing, moved, unreadable) return as per-file findings.
//
// Freshness states:
// - current: the planned baseline still holds (or the file is still
//   absent for a create).
// - stale: content or existence changed since planning.
// - missing: a modify/delete target is gone.
// - inaccessible: symlink, non-file, outside the project, or unreadable.
// - unverified: no valid digest to compare against (baseline unknown).
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  resolveWorkspacePath,
} = require('../../security/validate-path.cjs')

const EDIT_ACTIONS = ['create', 'modify', 'delete']
const HEX64_PATTERN = /^[0-9a-f]{64}$/
const MAX_EDITS = 20

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function displayPath(root, resolved) {
  return path.relative(root, resolved).split(path.sep).join('/')
}

function currentFinding(index, action, shown, reason) {
  return { index, action, path: shown, status: 'current', reason }
}

function finding(index, action, shown, status, reason) {
  return { index, action, path: shown, status, reason }
}

function outsideReason(message) {
  if (/outside/i.test(message || '')) {
    return 'Outside the open project.'
  }

  if (/[Ss]ymbolic link/.test(message || '')) {
    return 'Symbolic links are not followed.'
  }

  if (/workspace root/.test(message || '')) {
    return 'Cannot target the workspace root.'
  }

  return 'File cannot be accessed.'
}

async function checkOne(root, entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`edits[${index}] is invalid.`)
  }

  if (!EDIT_ACTIONS.includes(entry.action)) {
    throw new Error(`edits[${index}].action is invalid.`)
  }

  if (typeof entry.path !== 'string' || !entry.path.trim()) {
    throw new Error(`edits[${index}].path is invalid.`)
  }

  let resolved = null

  try {
    resolved = await resolveWorkspacePath(entry.path.trim(), {
      allowMissing: true,
    })
  } catch (error) {
    return finding(
      index,
      entry.action,
      entry.path.trim(),
      'inaccessible',
      outsideReason(error.message)
    )
  }

  const shown = displayPath(root, resolved.path)

  if (entry.action === 'create') {
    if (resolved.exists) {
      return finding(index, 'create', shown, 'stale', 'File already exists.')
    }

    return currentFinding(index, 'create', shown, 'Will be created.')
  }

  if (!resolved.exists) {
    return finding(
      index,
      entry.action,
      shown,
      'missing',
      'Removed since the plan was made.'
    )
  }

  if (!resolved.stat.isFile()) {
    return finding(
      index,
      entry.action,
      shown,
      'inaccessible',
      'No longer a regular file.'
    )
  }

  if (
    typeof entry.originalDigest !== 'string' ||
    !HEX64_PATTERN.test(entry.originalDigest)
  ) {
    return finding(
      index,
      entry.action,
      shown,
      'unverified',
      'No recorded baseline to compare against.'
    )
  }

  // Size mismatch decides without reading: the recorded length is
  // bounded, so an equal-size read below is bounded too.
  if (
    typeof entry.originalLength === 'number' &&
    Number.isInteger(entry.originalLength) &&
    resolved.stat.size !== entry.originalLength
  ) {
    return finding(
      index,
      entry.action,
      shown,
      'stale',
      'Changed since the plan was made.'
    )
  }

  let current = null

  try {
    current = await fs.readFile(resolved.path)
  } catch {
    return finding(
      index,
      entry.action,
      shown,
      'inaccessible',
      'File cannot be read.'
    )
  }

  if (sha256Hex(current) !== entry.originalDigest) {
    return finding(
      index,
      entry.action,
      shown,
      'stale',
      'Changed since the plan was made.'
    )
  }

  return currentFinding(index, entry.action, shown, 'Baseline unchanged.')
}

async function checkEditFreshness(edits) {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error('No edits were provided.')
  }

  if (edits.length > MAX_EDITS) {
    throw new Error(`At most ${MAX_EDITS} edits can be checked at once.`)
  }

  const findings = []

  for (const [index, entry] of edits.entries()) {
    findings.push(await checkOne(root, entry, index))
  }

  return {
    edits: findings,
    allCurrent: findings.every((entry) => entry.status === 'current'),
  }
}

module.exports = {
  MAX_EDITS,
  checkEditFreshness,
}
