// Structured per-project memory (Level 3A.1). Each record is one JSON
// file under `.kryom/memory/<id>.json`, so an interrupted write can
// only affect the record being saved and readers never observe a torn
// file (temp-file + rename via the storage layer). Records are
// untrusted data (user-editable files): ids, shapes, and source refs
// are re-validated on every read, and source digests are always
// captured by the service — the renderer never supplies them.
//
// Staleness is checked per referenced source only (never a repo-wide
// hash): a changed or missing source marks its record stale instead
// of silently passing as current.
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
  resolveStoragePath,
  ensureStorageDir,
  writeStorageFile,
  readStorageFile,
  listStorageFiles,
} = require('../../security/storage-path.cjs')
const {
  readSession,
} = require('../research/session-store.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('memory')

const MEMORY_SEGMENTS = ['.kryom', 'memory']
const CHAT_SEGMENTS = ['.kryom', 'chat.json']
const RECORD_VERSION = 1
const ID_PATTERN = /^mem-[a-z0-9-]{1,64}$/
const HEX64_PATTERN = /^[0-9a-f]{64}$/
const SHA_PATTERN = /^[0-9a-f]{40}$/i
const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const TYPES = ['decision', 'convention', 'fact']
const SOURCE_KINDS = ['file', 'chat', 'research', 'commit']
const MAX_TITLE_CHARS = 200
const MAX_CONTENT_CHARS = 20000
const MAX_SOURCES = 20
const MAX_FINGERPRINT_BYTES = 1024 * 1024

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function nowIso() {
  return new Date().toISOString()
}

function newMemoryId() {
  return `mem-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function assertMemoryId(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error('Invalid memory id.')
  }

  return value
}

function recordSegments(id) {
  return [...MEMORY_SEGMENTS, `${assertMemoryId(id)}.json`]
}

function openRoot() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  return root
}

// Stored file refs are posix-style workspace-relative paths with no
// escapes. Rejects absolute paths, drive letters, and `..` segments
// (including encoded-looking variants — stored data is literal text).
function assertStoredFilePath(value) {
  if (typeof value !== 'string' || !value || value.length > 1000) {
    throw new Error('Memory record is corrupt.')
  }

  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    path.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value)
  ) {
    throw new Error('Memory record is corrupt.')
  }

  for (const segment of value.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error('Memory record is corrupt.')
    }
  }

  return value
}

function sanitizeSource(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Memory record is corrupt.')
  }

  if (raw.kind === 'file') {
    assertStoredFilePath(raw.path)

    if (typeof raw.digest !== 'string' || !HEX64_PATTERN.test(raw.digest)) {
      throw new Error('Memory record is corrupt.')
    }

    return { kind: 'file', path: raw.path, digest: raw.digest }
  }

  if (raw.kind === 'chat') {
    if (typeof raw.digest !== 'string' || !HEX64_PATTERN.test(raw.digest)) {
      throw new Error('Memory record is corrupt.')
    }

    return { kind: 'chat', digest: raw.digest }
  }

  if (raw.kind === 'research') {
    if (
      typeof raw.sessionId !== 'string' ||
      !SESSION_ID_PATTERN.test(raw.sessionId) ||
      typeof raw.briefVersion !== 'number' ||
      !Number.isInteger(raw.briefVersion) ||
      raw.briefVersion < 0
    ) {
      throw new Error('Memory record is corrupt.')
    }

    return {
      kind: 'research',
      sessionId: raw.sessionId,
      briefVersion: raw.briefVersion,
    }
  }

  if (raw.kind === 'commit') {
    if (typeof raw.sha !== 'string' || !SHA_PATTERN.test(raw.sha)) {
      throw new Error('Memory record is corrupt.')
    }

    return { kind: 'commit', sha: raw.sha.toLowerCase() }
  }

  throw new Error('Memory record is corrupt.')
}

function sanitizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Memory record is corrupt.')
  }

  if (raw.version !== RECORD_VERSION) {
    throw new Error('Unsupported memory version.')
  }

  assertMemoryId(raw.id)

  if (!TYPES.includes(raw.type)) {
    throw new Error('Memory record is corrupt.')
  }

  if (
    raw.title !== null &&
    raw.title !== undefined &&
    (typeof raw.title !== 'string' || raw.title.length > MAX_TITLE_CHARS)
  ) {
    throw new Error('Memory record is corrupt.')
  }

  if (
    typeof raw.content !== 'string' ||
    !raw.content.trim() ||
    raw.content.length > MAX_CONTENT_CHARS
  ) {
    throw new Error('Memory record is corrupt.')
  }

  if (
    typeof raw.createdAt !== 'string' ||
    !raw.createdAt ||
    typeof raw.updatedAt !== 'string' ||
    !raw.updatedAt
  ) {
    throw new Error('Memory record is corrupt.')
  }

  if (!Array.isArray(raw.sources) || raw.sources.length > MAX_SOURCES) {
    throw new Error('Memory record is corrupt.')
  }

  return {
    version: RECORD_VERSION,
    id: raw.id,
    type: raw.type,
    title: raw.title ?? null,
    content: raw.content,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sources: raw.sources.map(sanitizeSource),
  }
}

// Capture resolves a renderer-supplied source spec into a stored ref.
// Digests and versions are always read here so stored provenance is
// trustworthy: the renderer can name a source but never its fingerprint.
async function captureSource(root, spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('Invalid memory source.')
  }

  if (!SOURCE_KINDS.includes(spec.kind)) {
    throw new Error('Invalid memory source.')
  }

  if (spec.kind === 'file') {
    if (typeof spec.path !== 'string' || !spec.path.trim()) {
      throw new Error('Invalid memory source: a file path is required.')
    }

    const { path: resolved, stat } = await resolveWorkspacePath(
      spec.path.trim()
    )

    if (!stat.isFile()) {
      throw new Error('Memory sources must be regular files.')
    }

    if (stat.size > MAX_FINGERPRINT_BYTES) {
      throw new Error('Source file is too large to fingerprint.')
    }

    const bytes = await fs.readFile(resolved)
    const relative = path.relative(root, resolved)

    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('Memory source escapes its project.')
    }

    return {
      kind: 'file',
      path: relative.split(path.sep).join('/'),
      digest: digest(bytes),
    }
  }

  if (spec.kind === 'chat') {
    const { found, data } = await readStorageFile(root, CHAT_SEGMENTS)

    if (!found) {
      throw new Error('No chat history to reference yet.')
    }

    return { kind: 'chat', digest: digest(data) }
  }

  if (spec.kind === 'research') {
    if (
      typeof spec.sessionId !== 'string' ||
      !SESSION_ID_PATTERN.test(spec.sessionId)
    ) {
      throw new Error('Invalid research session id.')
    }

    const session = await readSession(spec.sessionId)
    const briefVersion =
      session.brief && typeof session.brief.version === 'number'
        ? session.brief.version
        : 0

    return { kind: 'research', sessionId: session.id, briefVersion }
  }

  if (typeof spec.sha !== 'string' || !SHA_PATTERN.test(spec.sha.trim())) {
    throw new Error('Invalid commit reference: a 40-character SHA is required.')
  }

  const sha = spec.sha.trim().toLowerCase()
  const { runGit } = require('../git/git.service.cjs')

  let result = null

  try {
    result = await runGit(['cat-file', '-e', sha])
  } catch (error) {
    if (error && /not installed|ENOENT/i.test(error.message || '')) {
      throw new Error('Cannot verify the commit without Git installed.')
    }

    throw error
  }

  if (result.exitCode !== 0) {
    throw new Error(`Commit ${sha.slice(0, 12)} was not found in this project.`)
  }

  return { kind: 'commit', sha }
}

async function captureSources(root, specs) {
  if (specs === undefined || specs === null) {
    return []
  }

  if (!Array.isArray(specs) || specs.length > MAX_SOURCES) {
    throw new Error(
      `Invalid memory sources: provide at most ${MAX_SOURCES}.`
    )
  }

  const captured = []

  for (const spec of specs) {
    captured.push(await captureSource(root, spec))
  }

  return captured
}

function current() {
  return { status: 'current', reason: '' }
}

function stale(reason) {
  return { status: 'stale', reason }
}

function unverified(reason) {
  return { status: 'unverified', reason }
}

// Per-source freshness. Only referenced files are read and hashed —
// listing memories never walks or hashes the repository.
async function checkSource(root, ref) {
  if (ref.kind === 'file') {
    let resolved = null

    try {
      const located = await resolveWorkspacePath(
        path.join(root, ...ref.path.split('/'))
      )

      resolved = located
    } catch (error) {
      if (error && /does not exist/i.test(error.message || '')) {
        return stale(`Source file "${ref.path}" was removed.`)
      }

      return unverified(
        `Source file "${ref.path}" could not be checked (${error.message}).`
      )
    }

    if (!resolved.stat.isFile()) {
      return stale(`Source file "${ref.path}" is no longer a file.`)
    }

    if (resolved.stat.size > MAX_FINGERPRINT_BYTES) {
      return unverified(
        `Source file "${ref.path}" is too large to fingerprint.`
      )
    }

    const bytes = await fs.readFile(resolved.path)

    if (digest(bytes) !== ref.digest) {
      return stale(`Source file "${ref.path}" changed since it was recorded.`)
    }

    return current()
  }

  if (ref.kind === 'chat') {
    const { found, data } = await readStorageFile(root, CHAT_SEGMENTS)

    if (!found) {
      return stale('Chat history was cleared since it was recorded.')
    }

    if (digest(data) !== ref.digest) {
      return stale('Chat history changed since it was recorded.')
    }

    return current()
  }

  if (ref.kind === 'research') {
    let session = null

    try {
      session = await readSession(ref.sessionId)
    } catch {
      return stale(`Research session ${ref.sessionId} is gone.`)
    }

    const briefVersion =
      session.brief && typeof session.brief.version === 'number'
        ? session.brief.version
        : 0

    if (briefVersion !== ref.briefVersion) {
      return stale(
        `Research brief v${ref.briefVersion} was superseded by v${briefVersion}.`
      )
    }

    return current()
  }

  const { runGit } = require('../git/git.service.cjs')

  try {
    const result = await runGit(['cat-file', '-e', ref.sha])

    if (result.exitCode !== 0) {
      return stale(`Commit ${ref.sha.slice(0, 12)} is not in this project.`)
    }
  } catch (error) {
    if (error && /not installed|ENOENT/i.test(error.message || '')) {
      return unverified('Git is not installed; the commit cannot be checked.')
    }

    return unverified(`Commit check failed (${error.message}).`)
  }

  return current()
}

async function withFreshness(root, record) {
  const sources = []
  const staleReasons = []

  for (const ref of record.sources) {
    const checked = await checkSource(root, ref)

    sources.push({ ...ref, ...checked })

    if (checked.status === 'stale') {
      staleReasons.push(checked.reason)
    }
  }

  return { ...record, sources, stale: staleReasons.length > 0, staleReasons }
}

async function readRecord(root, id) {
  const { found, data } = await readStorageFile(root, recordSegments(id))

  if (!found) {
    throw new Error('Memory not found.')
  }

  let parsed = null

  try {
    parsed = JSON.parse(data)
  } catch {
    throw new Error('Memory record is corrupt.')
  }

  return sanitizeRecord(parsed)
}

function assertInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid memory record.')
  }

  if (!TYPES.includes(input.type)) {
    throw new Error('Invalid memory type: use decision, convention, or fact.')
  }

  if (
    input.title !== undefined &&
    input.title !== null &&
    (typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > MAX_TITLE_CHARS)
  ) {
    throw new Error(
      `Invalid memory title: provide text up to ${MAX_TITLE_CHARS} characters.`
    )
  }

  if (
    typeof input.content !== 'string' ||
    !input.content.trim() ||
    input.content.length > MAX_CONTENT_CHARS
  ) {
    throw new Error(
      `Invalid memory content: provide text up to ${MAX_CONTENT_CHARS} characters.`
    )
  }

  return {
    type: input.type,
    title: input.title?.trim() || null,
    content: input.content,
  }
}

async function listMemories() {
  const root = openRoot()
  const files = await listStorageFiles(root, MEMORY_SEGMENTS)
  const records = []
  const corrupt = []

  for (const { name } of files) {
    if (!name.endsWith('.json')) {
      continue
    }

    const id = name.slice(0, -'.json'.length)

    if (!ID_PATTERN.test(id)) {
      continue
    }

    try {
      records.push(await withFreshness(root, await readRecord(root, id)))
    } catch (error) {
      log.warn(`Memory ${id} unreadable: ${error.message}`)
      corrupt.push(id)
    }
  }

  records.sort((a, b) =>
    a.updatedAt === b.updatedAt
      ? a.id.localeCompare(b.id)
      : b.updatedAt.localeCompare(a.updatedAt)
  )
  corrupt.sort()

  return { records, corrupt }
}

async function getMemory(id) {
  const root = openRoot()

  return withFreshness(root, await readRecord(root, assertMemoryId(id)))
}

async function createMemory(input) {
  const root = openRoot()
  const clean = assertInput(input)
  const sources = await captureSources(root, input.sources)
  const stamp = nowIso()
  const record = {
    version: RECORD_VERSION,
    id: newMemoryId(),
    type: clean.type,
    title: clean.title,
    content: clean.content,
    createdAt: stamp,
    updatedAt: stamp,
    sources,
  }

  await writeStorageFile(
    root,
    recordSegments(record.id),
    JSON.stringify(record)
  )

  return withFreshness(root, record)
}

async function updateMemory(id, patch) {
  const root = openRoot()
  const existing = await readRecord(root, assertMemoryId(id))

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Invalid memory update.')
  }

  const next = {
    type: existing.type,
    title: existing.title,
    content: existing.content,
  }

  if (patch.type !== undefined) {
    if (!TYPES.includes(patch.type)) {
      throw new Error('Invalid memory type: use decision, convention, or fact.')
    }

    next.type = patch.type
  }

  if (patch.title !== undefined) {
    if (
      patch.title !== null &&
      (typeof patch.title !== 'string' ||
        !patch.title.trim() ||
        patch.title.length > MAX_TITLE_CHARS)
    ) {
      throw new Error(
        `Invalid memory title: provide text up to ${MAX_TITLE_CHARS} characters.`
      )
    }

    next.title = patch.title?.trim() || null
  }

  if (patch.content !== undefined) {
    if (
      typeof patch.content !== 'string' ||
      !patch.content.trim() ||
      patch.content.length > MAX_CONTENT_CHARS
    ) {
      throw new Error(
        `Invalid memory content: provide text up to ${MAX_CONTENT_CHARS} characters.`
      )
    }

    next.content = patch.content
  }

  const sources =
    patch.sources === undefined
      ? existing.sources
      : await captureSources(root, patch.sources)

  const record = {
    ...existing,
    ...next,
    sources,
    updatedAt: nowIso(),
  }

  await writeStorageFile(
    root,
    recordSegments(record.id),
    JSON.stringify(record)
  )

  return withFreshness(root, record)
}

async function deleteMemory(id) {
  const root = openRoot()
  const { path: file, exists } = await resolveStoragePath(
    root,
    recordSegments(assertMemoryId(id))
  )

  if (!exists) {
    throw new Error('Memory not found.')
  }

  const stat = await fs.lstat(file)

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Memory record is corrupt.')
  }

  await fs.unlink(file)

  return { deleted: true, id }
}

// Bulk deletion removes validated memory record files only — regular
// files named `<mem-id>.json` inside the memory directory. Corrupt
// records go too (they are still memory records); anything else in
// `.kryom/` (chat, checkpoints, research, strays) is never touched.
// Failures are per-file: one planted directory does not stop the rest,
// and the result reports exactly what happened.
async function deleteAllMemories() {
  const root = openRoot()
  // Raw directory read (not listStorageFiles): a planted directory
  // must surface as an explicit failure, not vanish silently.
  const dir = await ensureStorageDir(root, MEMORY_SEGMENTS)
  const entries = await fs.readdir(dir)
  const deleted = []
  const failed = []

  for (const name of entries) {
    if (!name.endsWith('.json')) {
      continue
    }

    const id = name.slice(0, -'.json'.length)

    if (!ID_PATTERN.test(id)) {
      continue
    }

    try {
      const { path: file, exists } = await resolveStoragePath(
        root,
        recordSegments(id)
      )

      if (!exists) {
        continue
      }

      const stat = await fs.lstat(file)

      if (stat.isSymbolicLink() || !stat.isFile()) {
        failed.push({ id, reason: 'Not a regular file; left in place.' })
        continue
      }

      await fs.unlink(file)
      deleted.push(id)
    } catch (error) {
      failed.push({ id, reason: error.message || 'Delete failed.' })
    }
  }

  deleted.sort()

  return { deleted, failed }
}

// Portable export document. Only validated records, only relative
// source paths and fingerprints — no absolute paths, no API keys,
// no credentials, no environment, no unrelated project files.
// Freshness is intentionally excluded: it is recomputed on demand
// wherever the records live.
async function buildExportDocument() {
  const root = openRoot()
  const files = await listStorageFiles(root, MEMORY_SEGMENTS)
  const records = []
  const skipped = []

  for (const { name } of files) {
    if (!name.endsWith('.json')) {
      continue
    }

    const id = name.slice(0, -'.json'.length)

    if (!ID_PATTERN.test(id)) {
      continue
    }

    try {
      records.push(await readRecord(root, id))
    } catch (error) {
      log.warn(`Memory ${id} skipped from export: ${error.message}`)
      skipped.push(id)
    }
  }

  records.sort((a, b) =>
    a.updatedAt === b.updatedAt
      ? a.id.localeCompare(b.id)
      : b.updatedAt.localeCompare(a.updatedAt)
  )
  skipped.sort()

  return {
    version: 1,
    kind: 'kryom-memory-export',
    exportedAt: nowIso(),
    projectName: path.basename(root),
    records: records.map((record) => ({
      id: record.id,
      type: record.type,
      title: record.title,
      content: record.content,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      sources: record.sources,
    })),
    skipped,
  }
}

// Atomic write of an export document to a user-chosen destination.
// The path comes from the native save dialog (user-picked, not
// renderer text), so it may live anywhere; the `.json` extension is
// still enforced and the write lands via temp-file + rename.
async function exportMemoriesToFile(destination) {
  if (typeof destination !== 'string' || !destination.trim()) {
    throw new Error('Invalid export destination.')
  }

  const target = destination.trim()

  if (!path.isAbsolute(target)) {
    throw new Error('Invalid export destination: an absolute path is required.')
  }

  if (path.extname(target).toLowerCase() !== '.json') {
    throw new Error('Destination must be a .json file.')
  }

  const document = await buildExportDocument()
  const data = JSON.stringify(document, null, 2)
  const dir = path.dirname(target)
  const tmp = path.join(
    dir,
    `.tmp-export-${process.pid}-${crypto.randomBytes(8).toString('hex')}.json`
  )

  let handle = null

  try {
    handle = await fs.open(tmp, 'wx')
    await handle.writeFile(data, 'utf8')
    await handle.close()
    handle = null
    await fs.rename(tmp, target)
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined)
    }

    await fs.unlink(tmp).catch(() => undefined)

    if (error && error.code === 'ENOENT') {
      throw new Error('Export destination folder does not exist.')
    }

    throw new Error(`Export failed: ${error.message}`)
  }

  return {
    path: target,
    bytes: Buffer.byteLength(data, 'utf8'),
    exported: document.records.length,
    skipped: document.skipped,
  }
}

module.exports = {
  MEMORY_SEGMENTS,
  TYPES,
  SOURCE_KINDS,
  MAX_SOURCES,
  newMemoryId,
  assertMemoryId,
  sanitizeRecord,
  listMemories,
  getMemory,
  createMemory,
  updateMemory,
  deleteMemory,
  deleteAllMemories,
  buildExportDocument,
  exportMemoriesToFile,
}
