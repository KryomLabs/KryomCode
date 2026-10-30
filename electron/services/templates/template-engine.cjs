// Project template engine (Level 4A.5). Generates new projects
// from validated templates with variable substitution. Safety
// first: traversal-proof paths, existing-directory protection
// (collisions preview before any confirmed overwrite), file
// count/size caps, atomic creation for new directories, and no
// script execution — setup commands return as instructions for
// the user to run through the normal terminal approval flow.
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const TEMPLATE_VERSION = 1
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/
const VARIABLE_PATTERN = /^[a-zA-Z0-9_]{1,60}$/
const MAX_FILES = 100
const MAX_FILE_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 10 * 1024 * 1024

function userTemplatesDir(baseDir) {
  const root = baseDir || (() => {
    const electron = require('electron')

    if (!electron || !electron.app || typeof electron.app.getPath !== 'function') {
      throw new Error('User template storage is unavailable outside Electron.')
    }

    return electron.app.getPath('userData')
  })()

  return path.join(root, 'kryomcode-templates')
}

function builtinTemplatesDir() {
  return path.join(__dirname, 'builtin')
}

function validateVariable(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid template: variable ${index} must be an object.`)
  }

  if (typeof raw.name !== 'string' || !VARIABLE_PATTERN.test(raw.name)) {
    throw new Error(`Invalid template: variable ${index} has a bad name.`)
  }

  if (raw.pattern !== undefined && raw.pattern !== null) {
    if (typeof raw.pattern !== 'string' || raw.pattern.length > 200) {
      throw new Error(`Invalid template: variable "${raw.name}" has a bad pattern.`)
    }

    try {
       
      new RegExp(`^(?:${raw.pattern})$`)
    } catch {
      throw new Error(`Invalid template: variable "${raw.name}" has an invalid pattern.`)
    }
  }

  return {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 500) : '',
    default: typeof raw.default === 'string' ? raw.default.slice(0, 500) : '',
    required: raw.required === true,
    pattern: typeof raw.pattern === 'string' ? raw.pattern : null,
  }
}

function validateTemplateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid template: an object is required.')
  }

  if (raw.templateVersion !== TEMPLATE_VERSION) {
    throw new Error('Invalid template: "templateVersion" must be 1.')
  }

  if (typeof raw.id !== 'string' || !TEMPLATE_ID_PATTERN.test(raw.id)) {
    throw new Error('Invalid template: "id" must be 2-61 lowercase letters, digits, or dashes.')
  }

  if (typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(raw.version)) {
    throw new Error('Invalid template: "version" must be semver (x.y.z).')
  }

  const variables = Array.isArray(raw.variables) ? raw.variables : []

  if (variables.length > 30) {
    throw new Error('Invalid template: at most 30 variables.')
  }

  const seen = new Set()

  for (const entry of variables.map((item, index) => validateVariable(item, index))) {
    if (seen.has(entry.name)) {
      throw new Error(`Invalid template: duplicate variable "${entry.name}".`)
    }

    seen.add(entry.name)
  }

  const setup = raw.setup && typeof raw.setup === 'object' && !Array.isArray(raw.setup) ? raw.setup : {}

  return {
    templateVersion: TEMPLATE_VERSION,
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : raw.id,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 2000) : '',
    version: raw.version,
    category: typeof raw.category === 'string' ? raw.category.slice(0, 100) : 'general',
    language: typeof raw.language === 'string' ? raw.language.slice(0, 100) : '',
    framework: typeof raw.framework === 'string' ? raw.framework.slice(0, 100) : '',
    runtime: typeof raw.runtime === 'string' ? raw.runtime.slice(0, 200) : '',
    variables: variables.map((item, index) => validateVariable(item, index)),
    setup: {
      instructions: typeof setup.instructions === 'string' ? setup.instructions.slice(0, 4000) : '',
      commands: Array.isArray(setup.commands)
        ? setup.commands.filter((entry) => typeof entry === 'string').slice(0, 20).map((entry) => entry.slice(0, 500))
        : [],
    },
  }
}

async function collectTemplateFiles(filesDir) {
  const out = []
  const total = { bytes: 0 }

  const walk = async (dir, base) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (out.length >= MAX_FILES) {
        throw new Error(`Invalid template: exceeds ${MAX_FILES} files.`)
      }

      const full = path.join(dir, entry.name)
      const rel = base ? `${base}/${entry.name}` : entry.name

      if (entry.isSymbolicLink()) {
        throw new Error('Invalid template: symlinks are rejected.')
      }

      if (entry.isDirectory()) {
        await walk(full, rel)
      } else if (entry.isFile()) {
        const stat = await fs.stat(full)

        if (stat.size > MAX_FILE_BYTES) {
          throw new Error(`Invalid template: ${rel} exceeds the 1 MB cap.`)
        }

        total.bytes += stat.size

        if (total.bytes > MAX_TOTAL_BYTES) {
          throw new Error('Invalid template: exceeds the 10 MB cap.')
        }

        out.push(rel)
      }
    }
  }

  await walk(filesDir, '')

  return out
}

async function loadTemplateDir(dir, scope) {
  let manifest = null

  try {
    manifest = validateTemplateManifest(JSON.parse(await fs.readFile(path.join(dir, 'template.json'), 'utf8')))
  } catch (error) {
    return { template: null, corrupt: dir, error: error.message }
  }

  try {
    const files = await collectTemplateFiles(path.join(dir, 'files'))

    if (files.length === 0) {
      return { template: null, corrupt: dir, error: 'Template holds no files.' }
    }

    return { template: { ...manifest, scope, files }, corrupt: null }
  } catch (error) {
    return { template: null, corrupt: dir, error: error.message }
  }
}

async function scanTemplates(rootDir, scope) {
  let entries = []

  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true })
  } catch {
    return { templates: [], corrupt: [] }
  }

  const templates = []
  const corrupt = []

  for (const entry of entries.filter((item) => item.isDirectory()).slice(0, 100)) {
    const loaded = await loadTemplateDir(path.join(rootDir, entry.name), scope)

    if (loaded.template) {
      templates.push(loaded.template)
    } else {
      corrupt.push({ dir: entry.name, error: loaded.error })
    }
  }

  return { templates, corrupt }
}

async function listTemplates({ baseDir } = {}) {
  const builtin = await scanTemplates(builtinTemplatesDir(), 'builtin')
  const user = await scanTemplates(userTemplatesDir(baseDir), 'user')
  const byId = new Map()

  for (const template of [...builtin.templates, ...user.templates]) {
    byId.set(template.id, template)
  }

  return {
    templates: [...byId.values()]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(({ files, ...meta }) => ({ ...meta, fileCount: files.length })),
    corrupt: [...builtin.corrupt, ...user.corrupt],
  }
}

async function getTemplate(id, { baseDir } = {}) {
  if (typeof id !== 'string' || !TEMPLATE_ID_PATTERN.test(id)) {
    throw new Error('Invalid template id.')
  }

  const builtin = await scanTemplates(builtinTemplatesDir(), 'builtin')
  const user = await scanTemplates(userTemplatesDir(baseDir), 'user')
  const found = [...user.templates, ...builtin.templates].find((entry) => entry.id === id)

  if (!found) {
    throw new Error(`Template "${id}" was not found.`)
  }

  const rootDir = found.scope === 'user' ? userTemplatesDir(baseDir) : builtinTemplatesDir()

  return { ...found, dir: path.join(rootDir, found.id) }
}

function resolveVariables(manifest, provided) {
  const values = {}
  const source = provided && typeof provided === 'object' ? provided : {}

  for (const variable of manifest.variables) {
    const raw = source[variable.name]

    if ((raw === undefined || raw === null || raw === '') && variable.default) {
      values[variable.name] = variable.default
      continue
    }

    if (typeof raw !== 'string' || !raw) {
      if (variable.required) {
        throw new Error(`Missing required variable "${variable.name}".`)
      }

      values[variable.name] = variable.default || ''
      continue
    }

    if (raw.length > 500) {
      throw new Error(`Variable "${variable.name}" exceeds 500 characters.`)
    }

    if (variable.pattern && !new RegExp(`^(?:${variable.pattern})$`).test(raw)) {
      throw new Error(`Variable "${variable.name}" does not match the required format.`)
    }

    values[variable.name] = raw
  }

  return values
}

// Substitutes {{name}} placeholders. `\{{` escapes to a literal;
// unresolved placeholders fail loudly with their names.
function substitute(text, values) {
  const ESCAPE = 'KRYOM-LBRACE-9f3c1d'
  const staged = text.split('\\{{').join(ESCAPE)
  const missing = new Set()

  const replaced = staged.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      missing.add(name)

      return match
    }

    return values[name]
  })

  if (missing.size > 0) {
    throw new Error(`Unresolved template variables: ${[...missing].join(', ')}.`)
  }

  return replaced.split(ESCAPE).join('{{')
}

function assertSafeRelative(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/')

  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..') ||
    /[<>:"|?*\x00-\x1f]/.test(normalized)
  ) {
    throw new Error(`Unsafe template path "${relativePath.slice(0, 200)}".`)
  }

  return normalized
}

async function renderTemplate(template, values) {
  const rendered = []
  let total = 0

  for (const relative of template.files) {
    const targetPath = assertSafeRelative(substitute(relative, values))
    const raw = await fs.readFile(path.join(template.dir, 'files', relative), 'utf8')
    const content = substitute(raw, values)
    const bytes = Buffer.byteLength(content, 'utf8')

    if (bytes > MAX_FILE_BYTES * 2) {
      throw new Error(`Rendered file ${targetPath} exceeds the size cap.`)
    }

    total += bytes

    if (total > MAX_TOTAL_BYTES * 2) {
      throw new Error('Rendered template exceeds the size cap.')
    }

    rendered.push({ path: targetPath, content, bytes })
  }

  return rendered
}

async function destinationState(destination) {
  const stat = await fs.stat(destination).catch(() => null)

  if (!stat) {
    return { exists: false, empty: true, entries: [] }
  }

  if (!stat.isDirectory()) {
    throw new Error('Destination exists and is not a directory.')
  }

  const entries = await fs.readdir(destination)

  return { exists: true, empty: entries.length === 0, entries }
}

// Dry run: renders everything and reports collisions without
// writing. The UI shows this before asking for overwrite
// confirmation.
async function previewGeneration({ templateId, destination, variables, baseDir } = {}) {
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) {
    throw new Error('Destination must be an absolute path.')
  }

  const template = await getTemplate(templateId, { baseDir })
  const values = resolveVariables(template, variables)
  const rendered = await renderTemplate(template, values)
  const state = await destinationState(destination)

  const parent = path.dirname(destination)
  const parentStat = await fs.stat(parent).catch(() => null)

  if (!parentStat || !parentStat.isDirectory()) {
    throw new Error('Destination parent directory does not exist.')
  }

  const collisions = []

  if (state.exists) {
    for (const file of rendered) {
      const exists = await fs.stat(path.join(destination, file.path)).then(
        () => true,
        () => false
      )

      if (exists) {
        collisions.push(file.path)
      }
    }
  }

  return {
    templateId: template.id,
    destination,
    files: rendered.map((file) => ({ path: file.path, bytes: file.bytes })),
    collisions,
    empty: state.empty,
    setup: template.setup,
  }
}

async function generateTemplate({ templateId, destination, variables, confirmed = false, baseDir } = {}) {
  const preview = await previewGeneration({ templateId, destination, variables, baseDir })

  if (preview.collisions.length > 0 && confirmed !== true) {
    throw new Error(
      `Destination holds ${preview.collisions.length} conflicting file(s): ` +
        `${preview.collisions.slice(0, 5).join(', ')}. Confirm to overwrite.`
    )
  }

  // Fresh directories write through a staging dir + rename (atomic);
  // confirmed overwrites write directly with an honest written list.
  const useStaging = preview.empty || !(await destinationState(destination)).exists

  if (useStaging) {
    const staging = `${destination}.staging-${crypto.randomBytes(4).toString('hex')}`
    const template = await getTemplate(templateId, { baseDir })
    const values = resolveVariables(template, variables)
    const rendered = await renderTemplate(template, values)

    try {
      await fs.mkdir(staging, { recursive: true })

      for (const file of rendered) {
        const target = path.join(staging, file.path)
        const resolved = path.resolve(target)

        if (resolved !== path.resolve(staging) && !resolved.startsWith(`${path.resolve(staging)}${path.sep}`)) {
          throw new Error(`Unsafe template path "${file.path}".`)
        }

        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, file.content, 'utf8')
      }

      // Renaming onto an existing (empty) directory fails on
      // Windows: remove the empty shell first.
      await fs.rmdir(destination).catch(() => undefined)
      await fs.rename(staging, destination)
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)

      throw error
    }

    return {
      destination,
      files: preview.files,
      overwritten: [],
      setup: preview.setup,
    }
  }

  const template = await getTemplate(templateId, { baseDir })
  const values = resolveVariables(template, variables)
  const rendered = await renderTemplate(template, values)
  const written = []

  for (const file of rendered) {
    const target = path.join(destination, file.path)
    const resolved = path.resolve(target)

    if (resolved !== path.resolve(destination) && !resolved.startsWith(`${path.resolve(destination)}${path.sep}`)) {
      throw new Error(`Unsafe template path "${file.path}".`)
    }

    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, file.content, 'utf8')
    written.push(file.path)
  }

  return {
    destination,
    files: preview.files,
    overwritten: preview.collisions,
    written,
    setup: preview.setup,
  }
}

module.exports = {
  validateTemplateManifest,
  listTemplates,
  getTemplate,
  previewGeneration,
  generateTemplate,
}
