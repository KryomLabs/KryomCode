// Durable per-apply checkpoints (Level 2B.3). Every successful agent
// batch persists its pre-apply file bytes under
// `.kryom/checkpoints/<id>/`, so an apply can be undone in a later
// session. Undo never clobbers user work: a file changed since the
// apply is skipped with an honest reason, and snapshot bytes are
// digest-checked before any restore. Checkpoint records are
// untrusted data (user-editable files): ids, shapes, and paths are
// re-validated on every read, and all writes go through the
// containment layers.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  resolveWorkspacePath,
} = require('../../security/validate-path.cjs')
const {
  assertSafeSegments,
  resolveStoragePath,
  ensureStorageDir,
  writeStorageFile,
  readStorageFile,
} = require('../../security/storage-path.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('checkpoints')

const CHECKPOINT_SEGMENTS = ['.kryom', 'checkpoints']
const RECORD_NAME = 'record.json'
const MAX_CHECKPOINTS = 10
const ID_PATTERN = /^cp-[a-z0-9-]{1,64}$/
const MAX_TASK_CHARS = 4000

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function newCheckpointId() {
  return `cp-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function assertCheckpointId(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error('Invalid checkpoint id.')
  }

  return value
}

function sanitizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Checkpoint record is corrupt.')
  }

  if (raw.version !== 1) {
    throw new Error('Unsupported checkpoint version.')
  }

  assertCheckpointId(raw.id)

  if (typeof raw.createdAt !== 'string' || !raw.createdAt) {
    throw new Error('Checkpoint record is corrupt.')
  }

  if (
    raw.task !== null &&
    raw.task !== undefined &&
    typeof raw.task !== 'string'
  ) {
    throw new Error('Checkpoint record is corrupt.')
  }

  if (!Array.isArray(raw.edits) || raw.edits.length === 0) {
    throw new Error('Checkpoint record is corrupt.')
  }

  const edits = raw.edits.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.path !== 'string' ||
      !entry.path ||
      !['create', 'modify', 'delete'].includes(entry.action) ||
      (entry.snapshot !== null && typeof entry.snapshot !== 'string') ||
      (entry.preDigest !== null && typeof entry.preDigest !== 'string') ||
      (entry.postDigest !== null && typeof entry.postDigest !== 'string')
    ) {
      throw new Error('Checkpoint record is corrupt.')
    }

    if (entry.snapshot !== null && !/^[0-9]+\.bin$/.test(entry.snapshot)) {
      throw new Error('Checkpoint record is corrupt.')
    }

    return {
      path: entry.path,
      action: entry.action,
      snapshot: entry.snapshot,
      preDigest: entry.preDigest,
      postDigest: entry.postDigest,
    }
  })

  return {
    version: 1,
    id: raw.id,
    createdAt: raw.createdAt,
    task:
      typeof raw.task === 'string' ? raw.task.slice(0, MAX_TASK_CHARS) : null,
    edits,
  }
}

async function readRecord(root, id) {
  assertCheckpointId(id)

  const { found, data } = await readStorageFile(root, [
    ...CHECKPOINT_SEGMENTS,
    id,
    RECORD_NAME,
  ])

  if (!found) {
    throw new Error('Checkpoint not found.')
  }

  let parsed = null

  try {
    parsed = JSON.parse(data)
  } catch {
    throw new Error('Checkpoint record is corrupt.')
  }

  const record = sanitizeRecord(parsed)

  if (record.id !== id) {
    throw new Error('Checkpoint record is corrupt.')
  }

  return record
}

async function pruneCheckpoints(root) {
  const dir = await ensureStorageDir(root, CHECKPOINT_SEGMENTS)
  const entries = await fs.readdir(dir)
  const records = []

  for (const entry of entries) {
    if (!ID_PATTERN.test(entry)) {
      continue
    }

    try {
      records.push(await readRecord(root, entry))
    } catch {
      continue
    }
  }

  records.sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt < b.createdAt
        ? 1
        : -1
  )

  for (const stale of records.slice(MAX_CHECKPOINTS)) {
    try {
      const { path: staleDir } = await resolveStoragePath(root, [
        ...CHECKPOINT_SEGMENTS,
        stale.id,
      ])
      await fs.rm(staleDir, { recursive: true, force: false })
    } catch (error) {
      log.warn(`Checkpoint prune failed: ${error.message}`)
    }
  }
}

// Persists one checkpoint for an applied batch. `applied` parallels
// the rollback snapshots: [{ resolved, action, existedBefore,
// preBytes (Buffer|null), postBytes (Buffer|null) }]. Never throws
// for storage reasons: failures return { error } so the completed
// apply still reports its file writes honestly.
async function writeCheckpoint({ task = null, applied = [] } = {}) {
  const root = getWorkspaceRoot()

  if (!root) {
    return { error: 'No project is open.' }
  }

  if (!Array.isArray(applied) || applied.length === 0) {
    return { error: 'Nothing to checkpoint.' }
  }

  const id = newCheckpointId()

  try {
    const edits = []

    for (const [index, entry] of applied.entries()) {
      const relative = path.relative(root, entry.resolved)

      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        return { error: 'Checkpoint path escapes its root.' }
      }

      let snapshot = null
      let preDigest = null

      if (entry.preBytes) {
        snapshot = `${index}.bin`
        preDigest = digest(entry.preBytes)
        await writeStorageFile(
          root,
          [...CHECKPOINT_SEGMENTS, id, snapshot],
          entry.preBytes
        )
      }

      edits.push({
        path: relative.split(path.sep).join('/'),
        action: entry.action,
        snapshot,
        preDigest,
        postDigest: entry.postBytes ? digest(entry.postBytes) : null,
      })
    }

    await writeStorageFile(
      root,
      [...CHECKPOINT_SEGMENTS, id, RECORD_NAME],
      JSON.stringify({
        version: 1,
        id,
        createdAt: new Date().toISOString(),
        task: typeof task === 'string' ? task.slice(0, MAX_TASK_CHARS) : null,
        edits,
      })
    )

    await pruneCheckpoints(root)

    return { id, files: edits.length }
  } catch (error) {
    log.warn(`Checkpoint write failed: ${error.message}`)

    return { error: `Checkpoint was not saved: ${error.message}` }
  }
}

async function listCheckpoints() {
  const root = getWorkspaceRoot()

  if (!root) {
    return { checkpoints: [] }
  }

  const dir = await ensureStorageDir(root, CHECKPOINT_SEGMENTS)
  const entries = await fs.readdir(dir)
  const checkpoints = []

  for (const entry of entries) {
    if (!ID_PATTERN.test(entry)) {
      continue
    }

    try {
      const record = await readRecord(root, entry)

      checkpoints.push({
        id: record.id,
        createdAt: record.createdAt,
        task: record.task,
        files: record.edits.length,
      })
    } catch {
      continue
    }
  }

  checkpoints.sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt < b.createdAt
        ? 1
        : -1
  )

  return { checkpoints }
}

async function readCurrentBytes(resolved, exists, stat) {
  if (!exists || !stat.isFile()) {
    return null
  }

  return fs.readFile(resolved)
}

// Undoes one checkpoint (default: latest), in reverse edit order.
// Files the user touched since the apply are skipped, never
// overwritten; damaged snapshots fail loudly instead of writing
// suspect bytes.
async function undoCheckpoint(id = null) {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  let target = id

  if (target === null || target === undefined) {
    const { checkpoints } = await listCheckpoints()

    if (checkpoints.length === 0) {
      throw new Error('No checkpoints to undo.')
    }

    target = checkpoints[0].id
  }

  assertCheckpointId(target)
  const record = await readRecord(root, target)
  const restored = []
  const skipped = []
  const failures = []

  for (const entry of [...record.edits].reverse()) {
    let display = entry.path
    let resolved = null

    try {
      const located = await resolveWorkspacePath(entry.path, {
        allowMissing: true,
      })

      // Absolute results match applyEdits' applied[] so the renderer
      // can refresh the same tabs; the record keeps relative paths.
      resolved = located.path
      display = resolved

      if (entry.action === 'create') {
        if (!located.exists) {
          skipped.push({ path: display, reason: 'already removed' })
          continue
        }

        const current = await readCurrentBytes(
          resolved,
          located.exists,
          located.stat
        )
        const currentDigest = current ? digest(current) : null

        if (currentDigest !== entry.postDigest) {
          skipped.push({ path: display, reason: 'changed since apply' })
          continue
        }

        await fs.unlink(resolved)
        restored.push(display)
        continue
      }

      if (!entry.snapshot) {
        failures.push({
          path: display,
          reason: 'snapshot missing, refusing to restore',
        })
        continue
      }

      // modify / delete: verify the snapshot before touching the disk.
      const { found, data } = await readStorageFile(
        root,
        [...CHECKPOINT_SEGMENTS, record.id, entry.snapshot],
        null
      )

      if (!found || digest(data) !== entry.preDigest) {
        failures.push({
          path: display,
          reason: 'snapshot damaged, refusing to restore',
        })
        continue
      }

      if (entry.action === 'delete') {
        if (located.exists) {
          skipped.push({ path: display, reason: 'recreated since apply' })
          continue
        }

        await fs.mkdir(path.dirname(resolved), { recursive: true })
        await fs.writeFile(resolved, data)
        restored.push(display)
        continue
      }

      const current = await readCurrentBytes(
        resolved,
        located.exists,
        located.stat
      )
      const currentDigest = current ? digest(current) : null

      if (current !== null && currentDigest !== entry.postDigest) {
        skipped.push({ path: display, reason: 'changed since apply' })
        continue
      }

      await fs.mkdir(path.dirname(resolved), { recursive: true })
      await fs.writeFile(resolved, data)
      restored.push(display)
    } catch (error) {
      failures.push({
        path: display,
        reason: error.message || 'Undo failed.',
      })
    }
  }

  return {
    id: record.id,
    completed: failures.length === 0,
    restored,
    skipped,
    failures,
  }
}

module.exports = {
  MAX_CHECKPOINTS,
  writeCheckpoint,
  listCheckpoints,
  undoCheckpoint,
}
