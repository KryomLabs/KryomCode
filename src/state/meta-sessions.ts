// Independent Meta AI sessions (Level 3C, Phases 3–5). Every Meta AI
// tab owns one session: its own conversation history, project
// association, model reference, linked task/research/orchestration
// records, changed-file manifest, and review state. Sessions persist
// in renderer localStorage (bounded, sanitized on load); the linked
// backend records (tracked plans, research sessions, orch runs) stay
// authoritative in `.kryom/` and are re-fetched by id. Closing a tab
// never deletes its session — deletion is an explicit separate
// action. API keys and secrets are never stored here.

export interface MetaMessage {
  role: 'user' | 'assistant'
  content: string
  model?: string
  at: string
}

export interface MetaChangedFile {
  path: string
  action: 'added' | 'modified' | 'deleted'
  source: string
  at: string
}

export type MetaReviewState =
  | 'none'
  | 'awaiting-review'
  | 'approved'
  | 'applied'

// A user-selected history attachment: a project chat excerpt, a
// research session, or a sibling agent session (same project root
// only — refs never cross project boundaries). Selected refs resolve
// to bounded text blocks at send time; nothing auto-injects.
export type HistoryRefKind = 'chat' | 'research' | 'agent'

export interface HistoryRef {
  kind: HistoryRefKind
  // Chat refs use the project-root key; research refs the research
  // session id; agent refs the sibling session id.
  id: string
  label: string
}

export interface MetaSession {
  version: 1
  id: string
  title: string
  root: string | null
  createdAt: string
  updatedAt: string
  messages: MetaMessage[]
  draft: string
  model: string
  providerId: string
  planId: string | null
  researchSessionId: string | null
  orchRunId: string | null
  changedFiles: MetaChangedFile[]
  reviewState: MetaReviewState
  statusNote: string
  historyRefs: HistoryRef[]
}

export interface SessionStorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const SESSIONS_KEY = 'kryom.meta-sessions.v1'
const MAX_SESSIONS_PER_ROOT = 20
const MAX_MESSAGES = 50
const MAX_MESSAGE_CHARS = 12000
const MAX_DRAFT_CHARS = 12000
const MAX_MODEL_CHARS = 100
const MAX_TITLE_CHARS = 80
const MAX_CHANGED_FILES = 200
const MAX_STATUS_CHARS = 300
const MAX_HISTORY_REFS = 12
const MAX_HISTORY_ID_CHARS = 2000
const MAX_HISTORY_LABEL_CHARS = 160

export function sessionRootKey(root: string | null): string {
  return root ?? '__global__'
}

function newSessionId(): string {
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')

  return `ms-${Date.now().toString(36)}-${rand}`
}

export function deriveSessionTitle(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim()

  if (!single) {
    return 'New Task'
  }

  return single.length > MAX_TITLE_CHARS
    ? `${single.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`
    : single
}

export function createMetaSession(
  root: string | null,
  model: string,
  providerId = 'meta'
): MetaSession {
  const now = new Date().toISOString()

  return {
    version: 1,
    id: newSessionId(),
    title: 'New Task',
    root,
    createdAt: now,
    updatedAt: now,
    messages: [],
    draft: '',
    model,
    providerId,
    planId: null,
    researchSessionId: null,
    orchRunId: null,
    changedFiles: [],
    reviewState: 'none',
    statusNote: '',
    historyRefs: [],
  }
}

export function touchSession(session: MetaSession): MetaSession {
  return { ...session, updatedAt: new Date().toISOString() }
}

function getWindowStorage(): SessionStorageLike {
  return window.localStorage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

function asNullableString(value: unknown, max: number): string | null {
  if (value === null) {
    return null
  }

  return asString(value, max)
}

function sanitizeMessage(value: unknown): MetaMessage | null {
  if (!isRecord(value)) {
    return null
  }

  if (value.role !== 'user' && value.role !== 'assistant') {
    return null
  }

  const content = asString(value.content, MAX_MESSAGE_CHARS)

  if (content === null) {
    return null
  }

  const at = asString(value.at, 40) ?? new Date(0).toISOString()
  const model =
    value.model === undefined
      ? undefined
      : asString(value.model, MAX_MODEL_CHARS) ?? undefined

  return {
    role: value.role,
    content,
    ...(model === undefined ? {} : { model }),
    at,
  }
}

function sanitizeChangedFile(value: unknown): MetaChangedFile | null {
  if (!isRecord(value)) {
    return null
  }

  const path = asString(value.path, 2000)
  const source = asString(value.source, 120) ?? 'unknown'
  const at = asString(value.at, 40) ?? new Date(0).toISOString()

  if (
    path === null ||
    (value.action !== 'added' &&
      value.action !== 'modified' &&
      value.action !== 'deleted')
  ) {
    return null
  }

  return { path, action: value.action, source, at }
}

function sanitizeHistoryRef(value: unknown): HistoryRef | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    value.kind !== 'chat' &&
    value.kind !== 'research' &&
    value.kind !== 'agent'
  ) {
    return null
  }

  const id = asString(value.id, MAX_HISTORY_ID_CHARS)
  const label = asString(value.label, MAX_HISTORY_LABEL_CHARS)

  if (id === null || label === null) {
    return null
  }

  return { kind: value.kind, id, label }
}

function sanitizeSession(value: unknown): MetaSession | null {
  if (!isRecord(value) || value.version !== 1) {
    return null
  }

  const id = asString(value.id, 64)
  const title = asString(value.title, MAX_TITLE_CHARS) ?? 'New Task'
  const createdAt = asString(value.createdAt, 40)
  const updatedAt = asString(value.updatedAt, 40)
  const draft = asString(value.draft, MAX_DRAFT_CHARS) ?? ''
  const model = asString(value.model, MAX_MODEL_CHARS) ?? ''
  const providerId = asString(value.providerId, 60) ?? 'meta'
  const statusNote = asString(value.statusNote, MAX_STATUS_CHARS) ?? ''

  if (id === null || createdAt === null || updatedAt === null) {
    return null
  }

  const root =
    typeof value.root === 'string' && value.root.length <= 2000
      ? value.root
      : value.root === null
        ? null
        : undefined

  if (root === undefined) {
    return null
  }

  if (!Array.isArray(value.messages)) {
    return null
  }

  const messages: MetaMessage[] = []

  for (const entry of value.messages.slice(-MAX_MESSAGES)) {
    const clean = sanitizeMessage(entry)

    if (clean) {
      messages.push(clean)
    }
  }

  const changedFiles: MetaChangedFile[] = []

  if (Array.isArray(value.changedFiles)) {
    for (const entry of value.changedFiles.slice(-MAX_CHANGED_FILES)) {
      const clean = sanitizeChangedFile(entry)

      if (clean) {
        changedFiles.push(clean)
      }
    }
  }

  const reviewState =
    value.reviewState === 'awaiting-review' ||
    value.reviewState === 'approved' ||
    value.reviewState === 'applied'
      ? value.reviewState
      : 'none'

  const planId = asNullableString(value.planId, 80)
  const researchSessionId = asNullableString(value.researchSessionId, 80)
  const orchRunId = asNullableString(value.orchRunId, 80)

  // Missing on pre-history records: defaults to unattached.
  const historyRefs: HistoryRef[] = []

  if (Array.isArray(value.historyRefs)) {
    for (const entry of value.historyRefs.slice(0, MAX_HISTORY_REFS)) {
      const clean = sanitizeHistoryRef(entry)

      if (clean) {
        historyRefs.push(clean)
      }
    }
  }

  return {
    version: 1,
    id,
    title,
    root,
    createdAt,
    updatedAt,
    messages,
    draft,
    model,
    providerId,
    planId,
    researchSessionId,
    orchRunId,
    changedFiles,
    reviewState,
    statusNote,
    historyRefs,
  }
}

function readStore(
  storage: SessionStorageLike
): Record<string, Record<string, unknown>> {
  try {
    const raw = storage.getItem(SESSIONS_KEY)

    if (!raw) {
      return {}
    }

    const parsed: unknown = JSON.parse(raw)

    if (!isRecord(parsed)) {
      return {}
    }

    const store: Record<string, Record<string, unknown>> = {}

    for (const [key, value] of Object.entries(parsed)) {
      if (isRecord(value)) {
        store[key] = value
      }
    }

    return store
  } catch {
    return {}
  }
}

function writeStore(
  storage: SessionStorageLike,
  store: Record<string, Record<string, unknown>>
): void {
  try {
    storage.setItem(SESSIONS_KEY, JSON.stringify(store))
  } catch {
    // Quota or access errors drop the write; the app keeps running.
  }
}

export function loadMetaSessions(
  root: string | null,
  storage?: SessionStorageLike
): MetaSession[] {
  const store = readStore(storage ?? getWindowStorage())
  const bucket = store[sessionRootKey(root)] ?? {}
  const sessions: MetaSession[] = []

  for (const value of Object.values(bucket)) {
    const clean = sanitizeSession(value)

    if (clean) {
      sessions.push(clean)
    }
  }

  sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))

  return sessions
}

export function saveMetaSession(
  session: MetaSession,
  storage?: SessionStorageLike
): void {
  const store = readStore(storage ?? getWindowStorage())
  const key = sessionRootKey(session.root)
  const bucket = store[key] ?? {}

  bucket[session.id] = {
    ...session,
    messages: session.messages.slice(-MAX_MESSAGES),
    changedFiles: session.changedFiles.slice(-MAX_CHANGED_FILES),
  }

  const ids = Object.keys(bucket)

  // Oldest-out eviction keeps the bucket bounded; deletion of the
  // evicted sessions is honest LRU behavior, documented here.
  if (ids.length > MAX_SESSIONS_PER_ROOT) {
    const ranked = ids
      .map((id) => bucket[id])
      .filter(isRecord)
      .sort((a, b) =>
        String(a.updatedAt ?? '') < String(b.updatedAt ?? '') ? -1 : 1
      )
      .slice(0, ids.length - MAX_SESSIONS_PER_ROOT)

    for (const victim of ranked) {
      if (typeof victim.id === 'string') {
        delete bucket[victim.id]
      }
    }
  }

  store[key] = bucket
  writeStore(storage ?? getWindowStorage(), store)
}

export function deleteMetaSession(
  root: string | null,
  sessionId: string,
  storage?: SessionStorageLike
): void {
  const resolved = storage ?? getWindowStorage()
  const store = readStore(resolved)
  const key = sessionRootKey(root)

  if (store[key] && sessionId in store[key]) {
    delete store[key][sessionId]
    writeStore(resolved, store)
  }
}

// Records applied-file outcomes on the session manifest. Entries are
// keyed by path so re-applies update the action instead of doubling
// the count; counts always derive from this array's length.
export function recordChangedFiles(
  session: MetaSession,
  applied: Array<{ path: string; action: string }>,
  source: string
): MetaSession {
  const at = new Date().toISOString()
  const byPath = new Map<string, MetaChangedFile>()

  for (const entry of session.changedFiles) {
    byPath.set(entry.path, entry)
  }

  for (const entry of applied) {
    const action =
      entry.action === 'create'
        ? 'added'
        : entry.action === 'delete'
          ? 'deleted'
          : 'modified'

    byPath.set(entry.path, {
      path: entry.path,
      action,
      source: source.slice(0, 120),
      at,
    })
  }

  return touchSession({
    ...session,
    changedFiles: [...byPath.values()].slice(-MAX_CHANGED_FILES),
  })
}
