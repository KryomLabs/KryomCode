// Skill store (Level 4A.3). Skills are reusable instruction packs
// with declared tools, permissions, and schemas — never bare
// prompts. Scopes: builtin (shipped, read-only), user (user data),
// project (`.kryom/skills/`), extension (active extensions'
// `skills/` dirs, read-only). Enable/disable is per skill id and
// enforced at execution.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  PERMISSIONS,
} = require('../permissions/permission.service.cjs')
const {
  ensureStorageDir,
  writeStorageFile,
  readStorageFile,
} = require('../../security/storage-path.cjs')
const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')

const SKILL_VERSION = 1
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/
const MAX_TEXT = 8000
const MAX_ITEMS = 30

// Every tool a skill may invoke, mapped to the real service behind
// it and the gates that apply. Tools outside this catalog cannot be
// invoked — skills declare from this list or fail validation.
const SKILL_TOOLS = {
  'intelligence.search': { permission: 'workspace.metadata', approval: false, kinds: ['readonly'] },
  'intelligence.architecture': { permission: 'workspace.metadata', approval: false, kinds: ['readonly'] },
  'intelligence.impact': { permission: 'workspace.metadata', approval: false, kinds: ['readonly'] },
  'planning.build': { permission: 'ai.tools', approval: false, kinds: ['propose'] },
  'specialist.research': { permission: 'ai.tools', approval: false, kinds: ['readonly'] },
  'specialist.coding': { permission: 'ai.tools', approval: false, kinds: ['propose'] },
  'specialist.testing': { permission: 'ai.tools', approval: false, kinds: ['readonly'] },
  'specialist.debugging': { permission: 'ai.tools', approval: false, kinds: ['readonly'] },
  'specialist.security': { permission: 'ai.tools', approval: false, kinds: ['readonly'] },
  'specialist.review': { permission: 'ai.tools', approval: false, kinds: ['readonly'] },
  'agent.propose': { permission: 'ai.tools', approval: false, kinds: ['propose'] },
  'agent.apply': { permission: 'workspace.write', approval: true, kinds: ['write'] },
  'diagnostics.run': { permission: 'terminal.execute', approval: true, kinds: ['execute'] },
  'quality.build': { permission: 'workspace.metadata', approval: false, kinds: ['readonly'] },
}

function userSkillsDir(baseDir) {
  const root = baseDir || (() => {
    const electron = require('electron')

    if (!electron || !electron.app || typeof electron.app.getPath !== 'function') {
      throw new Error('User skill storage is unavailable outside Electron.')
    }

    return electron.app.getPath('userData')
  })()

  return path.join(root, 'kryomcode-skills')
}

function builtinSkillsDir() {
  return path.join(__dirname, 'builtin')
}

function validateSchemaLite(value, name) {
  if (value === undefined || value === null) {
    return null
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid skill: "${name}" must be an object.`)
  }

  if (value.type !== undefined && typeof value.type !== 'string') {
    throw new Error(`Invalid skill: "${name}.type" must be a string.`)
  }

  if (value.properties !== undefined && (typeof value.properties !== 'object' || Array.isArray(value.properties))) {
    throw new Error(`Invalid skill: "${name}.properties" must be an object.`)
  }

  if (value.required !== undefined && !Array.isArray(value.required)) {
    throw new Error(`Invalid skill: "${name}.required" must be an array.`)
  }

  return {
    type: typeof value.type === 'string' ? value.type.slice(0, 60) : 'object',
    properties: value.properties || {},
    required: (value.required || []).filter((entry) => typeof entry === 'string').slice(0, MAX_ITEMS),
  }
}

function validateSkill(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid skill: an object is required.')
  }

  if (raw.skillVersion !== SKILL_VERSION) {
    throw new Error('Invalid skill: "skillVersion" must be 1.')
  }

  if (typeof raw.id !== 'string' || !SKILL_ID_PATTERN.test(raw.id)) {
    throw new Error('Invalid skill: "id" must be 2-61 lowercase letters, digits, or dashes.')
  }

  if (typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(raw.version)) {
    throw new Error('Invalid skill: "version" must be semver (x.y.z).')
  }

  if (typeof raw.instructions !== 'string' || !raw.instructions.trim() || raw.instructions.length > MAX_TEXT) {
    throw new Error(`Invalid skill: "instructions" must be 1-${MAX_TEXT} characters.`)
  }

  const tools = Array.isArray(raw.tools) ? raw.tools : []

  if (tools.length === 0 || tools.length > MAX_ITEMS) {
    throw new Error(`Invalid skill: declare 1-${MAX_ITEMS} tools.`)
  }

  for (const tool of tools) {
    if (typeof tool !== 'string' || !SKILL_TOOLS[tool]) {
      throw new Error(`Invalid skill: unknown tool "${String(tool).slice(0, 80)}".`)
    }
  }

  if (!tools.includes(raw.entryTool) || !SKILL_TOOLS[raw.entryTool]) {
    throw new Error('Invalid skill: "entryTool" must name one of the declared tools.')
  }

  const permissions = Array.isArray(raw.permissions) ? raw.permissions : []

  for (const permission of permissions) {
    if (typeof permission !== 'string' || !PERMISSIONS[permission]) {
      throw new Error(`Invalid skill: unknown permission "${String(permission).slice(0, 80)}".`)
    }
  }

  // The skill must declare every permission its tools need.
  for (const tool of new Set(tools)) {
    const needed = SKILL_TOOLS[tool].permission

    if (!permissions.includes(needed)) {
      throw new Error(`Invalid skill: tool "${tool}" requires permission "${needed}".`)
    }
  }

  const dependencies = Array.isArray(raw.dependencies) ? raw.dependencies : []

  for (const dep of dependencies) {
    if (typeof dep !== 'string' || !SKILL_ID_PATTERN.test(dep)) {
      throw new Error(`Invalid skill: bad dependency id "${String(dep).slice(0, 80)}".`)
    }
  }

  return {
    skillVersion: SKILL_VERSION,
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : raw.id,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 2000) : '',
    version: raw.version,
    instructions: raw.instructions,
    tasks: Array.isArray(raw.tasks)
      ? raw.tasks.filter((entry) => typeof entry === 'string').slice(0, MAX_ITEMS).map((entry) => entry.slice(0, 500))
      : [],
    inputSchema: validateSchemaLite(raw.inputSchema, 'inputSchema'),
    outputSchema: validateSchemaLite(raw.outputSchema, 'outputSchema'),
    tools: [...new Set(tools)],
    entryTool: raw.entryTool,
    permissions: [...new Set(permissions)],
    models: raw.models && typeof raw.models === 'object' && !Array.isArray(raw.models)
      ? {
          provider: typeof raw.models.provider === 'string' ? raw.models.provider.slice(0, 100) : null,
          model: typeof raw.models.model === 'string' ? raw.models.model.slice(0, 100) : null,
        }
      : { provider: null, model: null },
    dependencies: [...new Set(dependencies)],
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

async function loadDirSkills(dir, scope) {
  let entries = []

  try {
    entries = await fs.readdir(dir)
  } catch {
    return { skills: [], corrupt: [] }
  }

  const skills = []
  const corrupt = []

  for (const entry of entries.filter((name) => name.endsWith('.json')).slice(0, 100)) {
    const parsed = await readJsonFile(path.join(dir, entry))

    if (!parsed) {
      corrupt.push(entry)
      continue
    }

    try {
      skills.push({ ...validateSkill(parsed), scope })
    } catch {
      corrupt.push(entry)
    }
  }

  return { skills, corrupt }
}

async function readDisabled(baseDir) {
  try {
    const raw = await fs.readFile(path.join(userSkillsDir(baseDir), 'disabled.json'), 'utf8')
    const parsed = JSON.parse(raw)

    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((entry) => typeof entry === 'string'))
    }
  } catch {
    // No disabled list yet.
  }

  return new Set()
}

async function writeDisabled(disabled, baseDir) {
  const dir = userSkillsDir(baseDir)

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, 'disabled.json'),
    JSON.stringify([...disabled].sort(), null, 2),
    'utf8'
  )
}

// Extension-provided skills: validated JSON docs under each ACTIVE
// extension's `skills/` directory. Read-only; the extension owns
// the files.
async function loadExtensionSkills({ baseDir } = {}) {
  const { listExtensions } = require('../extensions/registry.cjs')
  const { isExtensionActive } = require('../extensions/runtime.cjs')
  const skills = []
  const corrupt = []

  let registry = null

  try {
    registry = await listExtensions({ baseDir })
  } catch {
    return { skills, corrupt }
  }

  for (const entry of registry.extensions) {
    if (!isExtensionActive(entry.id)) {
      continue
    }

    const loaded = await loadDirSkills(path.join(entry.path, 'skills'), `extension:${entry.id}`)

    skills.push(...loaded.skills)

    for (const name of loaded.corrupt) {
      corrupt.push(`${entry.id}/${name}`)
    }
  }

  return { skills, corrupt }
}

async function listSkills({ baseDir } = {}) {
  const disabled = await readDisabled(baseDir)
  const builtin = await loadDirSkills(builtinSkillsDir(), 'builtin')
  const user = await loadDirSkills(userSkillsDir(baseDir), 'user')

  let project = { skills: [], corrupt: [] }
  const root = getWorkspaceRoot()

  if (root) {
    try {
      const dir = await ensureStorageDir(root, ['.kryom', 'skills'])
      project = await loadDirSkills(dir, 'project')
    } catch {
      project = { skills: [], corrupt: [] }
    }
  }

  const extension = await loadExtensionSkills({ baseDir })
  const byId = new Map()

  // Precedence: project > user > extension > builtin. Same id in a
  // higher scope shadows the lower one (reported, not merged).
  for (const skill of [...builtin.skills, ...extension.skills, ...user.skills, ...project.skills]) {
    byId.set(skill.id, skill)
  }

  const skills = [...byId.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((skill) => ({ ...skill, enabled: !disabled.has(skill.id) }))

  return {
    skills,
    disabled: [...disabled].sort(),
    corrupt: [...builtin.corrupt, ...user.corrupt, ...project.corrupt, ...extension.corrupt],
  }
}

async function getSkill(id, { baseDir } = {}) {
  if (typeof id !== 'string' || !SKILL_ID_PATTERN.test(id)) {
    throw new Error('Invalid skill id.')
  }

  const listed = await listSkills({ baseDir })
  const skill = listed.skills.find((entry) => entry.id === id)

  if (!skill) {
    throw new Error(`Skill "${id}" was not found.`)
  }

  return skill
}

async function saveSkill(skill, { scope = 'user', baseDir } = {}) {
  if (scope !== 'user' && scope !== 'project') {
    throw new Error(`Skill scope "${scope}" is read-only.`)
  }

  const validated = validateSkill(skill)

  if (scope === 'user') {
    const dir = userSkillsDir(baseDir)

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

  await ensureStorageDir(root, ['.kryom', 'skills'])
  await writeStorageFile(
    root,
    ['.kryom', 'skills', `${validated.id}.json`],
    JSON.stringify(validated, null, 2)
  )

  return { ...validated, scope }
}

async function deleteSkill(id, { scope = 'user', baseDir } = {}) {
  if (typeof id !== 'string' || !SKILL_ID_PATTERN.test(id)) {
    throw new Error('Invalid skill id.')
  }

  if (scope === 'user') {
    await fs.unlink(path.join(userSkillsDir(baseDir), `${id}.json`)).catch(() => {
      throw new Error(`Skill "${id}" was not found.`)
    })

    const disabled = await readDisabled(baseDir)

    disabled.delete(id)
    await writeDisabled(disabled, baseDir)

    return { id, deleted: true }
  }

  if (scope === 'project') {
    const root = getWorkspaceRoot()

    if (!root) {
      throw new Error('Open a project folder first.')
    }

    const { resolveStoragePath } = require('../../security/storage-path.cjs')
    const { path: filePath } = await resolveStoragePath(root, ['.kryom', 'skills', `${id}.json`])

    await fs.unlink(filePath).catch(() => {
      throw new Error(`Skill "${id}" was not found.`)
    })

    return { id, deleted: true }
  }

  throw new Error(`Skill scope "${scope}" is read-only.`)
}

async function setSkillEnabled(id, enabled, { baseDir } = {}) {
  if (typeof id !== 'string' || !SKILL_ID_PATTERN.test(id)) {
    throw new Error('Invalid skill id.')
  }

  // Enabling a nonexistent skill is a typo worth catching.
  await getSkill(id, { baseDir })

  const disabled = await readDisabled(baseDir)

  if (enabled) {
    disabled.delete(id)
  } else {
    disabled.add(id)
  }

  await writeDisabled(disabled, baseDir)

  return { id, enabled: enabled === true }
}

module.exports = {
  SKILL_TOOLS,
  validateSkill,
  listSkills,
  getSkill,
  saveSkill,
  deleteSkill,
  setSkillEnabled,
}
