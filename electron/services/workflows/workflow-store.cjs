// Workflow definitions (Level 4A.3). Versioned, validated,
// composable development processes. Scopes mirror skills: builtin
// (shipped, read-only), user (user data), project
// (`.kryom/workflows/definitions/`). The engine executes these
// through existing services; definitions can only reference known
// step kinds with bounded retries, timeouts, and safe conditions.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  ensureStorageDir,
  writeStorageFile,
  resolveStoragePath,
} = require('../../security/storage-path.cjs')
const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')

const WORKFLOW_VERSION = 1
const WORKFLOW_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/
const STEP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/
const MAX_STEPS = 20
const MAX_RETRIES = 3
const MAX_TIMEOUT_MS = 300000
const MIN_TIMEOUT_MS = 1000

const STEP_KINDS = [
  'intelligence.search',
  'intelligence.architecture',
  'intelligence.impact',
  'planning.build',
  'skill.run',
  'specialist.run',
  'agent.propose',
  'agent.apply',
  'diagnostics.run',
  'quality.build',
  'approval.checkpoint',
  'report',
]

function userWorkflowsDir(baseDir) {
  const root = baseDir || (() => {
    const electron = require('electron')

    if (!electron || !electron.app || typeof electron.app.getPath !== 'function') {
      throw new Error('User workflow storage is unavailable outside Electron.')
    }

    return electron.app.getPath('userData')
  })()

  return path.join(root, 'kryomcode-workflows', 'definitions')
}

function builtinWorkflowsDir() {
  return path.join(__dirname, 'builtin')
}

function validateCondition(raw, stepId) {
  if (raw === undefined || raw === null) {
    return null
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid workflow: step "${stepId}" condition must be an object.`)
  }

  if (typeof raw.ref !== 'string' || !raw.ref) {
    throw new Error(`Invalid workflow: step "${stepId}" condition needs "ref".`)
  }

  const operators = ['equals', 'contains', 'exists'].filter((op) => raw[op] !== undefined)

  if (operators.length !== 1) {
    throw new Error(`Invalid workflow: step "${stepId}" condition needs exactly one of equals/contains/exists.`)
  }

  return { ref: raw.ref.slice(0, 300), [operators[0]]: raw[operators[0]] }
}

function validateStep(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid workflow: step ${index} must be an object.`)
  }

  if (typeof raw.id !== 'string' || !STEP_ID_PATTERN.test(raw.id)) {
    throw new Error(`Invalid workflow: step ${index} has a bad id.`)
  }

  if (!STEP_KINDS.includes(raw.kind)) {
    throw new Error(`Invalid workflow: step "${raw.id}" has unknown kind "${String(raw.kind).slice(0, 60)}".`)
  }

  const retries = raw.retries === undefined || raw.retries === null ? 0 : raw.retries

  if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) {
    throw new Error(`Invalid workflow: step "${raw.id}" retries must be 0-${MAX_RETRIES}.`)
  }

  const timeoutMs = raw.timeoutMs === undefined || raw.timeoutMs === null ? 120000 : raw.timeoutMs

  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid workflow: step "${raw.id}" timeout must be ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} ms.`)
  }

  if (raw.onFailure !== undefined && raw.onFailure !== null && raw.onFailure !== 'stop' && raw.onFailure !== 'continue') {
    throw new Error(`Invalid workflow: step "${raw.id}" onFailure must be stop or continue.`)
  }

  if (raw.kind === 'skill.run' && (typeof raw.uses !== 'string' || !raw.uses)) {
    throw new Error(`Invalid workflow: step "${raw.id}" (skill.run) needs "uses" with a skill id.`)
  }

  if (raw.kind === 'specialist.run') {
    if (!['research', 'coding', 'testing', 'debugging', 'security', 'review'].includes(raw.specialist)) {
      throw new Error(`Invalid workflow: step "${raw.id}" needs a valid "specialist".`)
    }

    if (typeof raw.task !== 'string' || !raw.task.trim()) {
      throw new Error(`Invalid workflow: step "${raw.id}" needs a "task".`)
    }
  }

  if (raw.kind === 'approval.checkpoint' && (typeof raw.message !== 'string' || !raw.message.trim())) {
    throw new Error(`Invalid workflow: step "${raw.id}" needs an approval "message".`)
  }

  if ((raw.kind === 'agent.apply' || raw.kind === 'diagnostics.run') && raw.params !== undefined && raw.params !== null && typeof raw.params !== 'object') {
    throw new Error(`Invalid workflow: step "${raw.id}" params must be an object.`)
  }

  return {
    id: raw.id,
    kind: raw.kind,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 200) : raw.id,
    uses: typeof raw.uses === 'string' ? raw.uses.slice(0, 80) : null,
    specialist: typeof raw.specialist === 'string' ? raw.specialist : null,
    task: typeof raw.task === 'string' ? raw.task.slice(0, 4000) : null,
    message: typeof raw.message === 'string' ? raw.message.slice(0, 2000) : null,
    params: raw.params && typeof raw.params === 'object' ? raw.params : {},
    retries,
    timeoutMs,
    onFailure: raw.onFailure === 'continue' ? 'continue' : 'stop',
    if: validateCondition(raw.if, raw.id),
  }
}

function validateWorkflow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid workflow: an object is required.')
  }

  if (raw.workflowVersion !== WORKFLOW_VERSION) {
    throw new Error('Invalid workflow: "workflowVersion" must be 1.')
  }

  if (typeof raw.id !== 'string' || !WORKFLOW_ID_PATTERN.test(raw.id)) {
    throw new Error('Invalid workflow: "id" must be 2-61 lowercase letters, digits, or dashes.')
  }

  if (typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(raw.version)) {
    throw new Error('Invalid workflow: "version" must be semver (x.y.z).')
  }

  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > MAX_STEPS) {
    throw new Error(`Invalid workflow: provide 1-${MAX_STEPS} steps.`)
  }

  const steps = raw.steps.map((entry, index) => validateStep(entry, index))
  const ids = new Set(steps.map((step) => step.id))

  if (ids.size !== steps.length) {
    throw new Error('Invalid workflow: duplicate step ids.')
  }

  const inputs = Array.isArray(raw.inputs) ? raw.inputs : []
  const normalizedInputs = inputs.slice(0, 20).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !/^[a-zA-Z0-9_]{1,60}$/.test(entry.name)) {
      throw new Error(`Invalid workflow: input ${index} needs a valid name.`)
    }

    return {
      name: entry.name,
      description: typeof entry.description === 'string' ? entry.description.slice(0, 500) : '',
      default: typeof entry.default === 'string' ? entry.default.slice(0, 2000) : '',
    }
  })

  return {
    workflowVersion: WORKFLOW_VERSION,
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : raw.id,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 2000) : '',
    version: raw.version,
    inputs: normalizedInputs,
    steps,
    owner: typeof raw.owner === 'string' ? raw.owner.slice(0, 200) : '',
  }
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

async function loadDirWorkflows(dir, scope) {
  let entries = []

  try {
    entries = await fs.readdir(dir)
  } catch {
    return { workflows: [], corrupt: [] }
  }

  const workflows = []
  const corrupt = []

  for (const entry of entries.filter((name) => name.endsWith('.json')).slice(0, 100)) {
    const parsed = await readJsonFile(path.join(dir, entry))

    if (!parsed) {
      corrupt.push(entry)
      continue
    }

    try {
      workflows.push({ ...validateWorkflow(parsed), scope })
    } catch {
      corrupt.push(entry)
    }
  }

  return { workflows, corrupt }
}

async function listWorkflows({ baseDir } = {}) {
  const builtin = await loadDirWorkflows(builtinWorkflowsDir(), 'builtin')
  const user = await loadDirWorkflows(userWorkflowsDir(baseDir), 'user')

  let project = { workflows: [], corrupt: [] }
  const root = getWorkspaceRoot()

  if (root) {
    try {
      const dir = await ensureStorageDir(root, ['.kryom', 'workflows', 'definitions'])

      project = await loadDirWorkflows(dir, 'project')
    } catch {
      project = { workflows: [], corrupt: [] }
    }
  }

  const byId = new Map()

  for (const workflow of [...builtin.workflows, ...user.workflows, ...project.workflows]) {
    byId.set(workflow.id, workflow)
  }

  return {
    workflows: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    corrupt: [...builtin.corrupt, ...user.corrupt, ...project.corrupt],
  }
}

async function getWorkflow(id, { baseDir } = {}) {
  if (typeof id !== 'string' || !WORKFLOW_ID_PATTERN.test(id)) {
    throw new Error('Invalid workflow id.')
  }

  const listed = await listWorkflows({ baseDir })
  const workflow = listed.workflows.find((entry) => entry.id === id)

  if (!workflow) {
    throw new Error(`Workflow "${id}" was not found.`)
  }

  return workflow
}

async function saveWorkflow(workflow, { scope = 'user', baseDir } = {}) {
  if (scope !== 'user' && scope !== 'project') {
    throw new Error(`Workflow scope "${scope}" is read-only.`)
  }

  const validated = validateWorkflow(workflow)

  if (scope === 'user') {
    const dir = userWorkflowsDir(baseDir)

    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, `${validated.id}.json`),
      JSON.stringify(validated, null, 2),
      'utf8'
    )

    return { ...validated, scope }
  }

  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  await ensureStorageDir(root, ['.kryom', 'workflows', 'definitions'])
  await writeStorageFile(
    root,
    ['.kryom', 'workflows', 'definitions', `${validated.id}.json`],
    JSON.stringify(validated, null, 2)
  )

  return { ...validated, scope }
}

async function deleteWorkflow(id, { scope = 'user', baseDir } = {}) {
  if (typeof id !== 'string' || !WORKFLOW_ID_PATTERN.test(id)) {
    throw new Error('Invalid workflow id.')
  }

  if (scope === 'user') {
    await fs.unlink(path.join(userWorkflowsDir(baseDir), `${id}.json`)).catch(() => {
      throw new Error(`Workflow "${id}" was not found.`)
    })

    return { id, deleted: true }
  }

  if (scope === 'project') {
    const root = getWorkspaceRoot()

    if (!root) {
      throw new Error('Open a project folder first.')
    }

    const { path: filePath } = await resolveStoragePath(root, ['.kryom', 'workflows', 'definitions', `${id}.json`])

    await fs.unlink(filePath).catch(() => {
      throw new Error(`Workflow "${id}" was not found.`)
    })

    return { id, deleted: true }
  }

  throw new Error(`Workflow scope "${scope}" is read-only.`)
}

module.exports = {
  STEP_KINDS,
  MAX_RETRIES,
  validateWorkflow,
  listWorkflows,
  getWorkflow,
  saveWorkflow,
  deleteWorkflow,
}
