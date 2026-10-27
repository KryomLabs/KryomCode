const fs = require('node:fs/promises')

const {
  getAIConfig,
  resolveModel,
} = require('../ai/ai-config.service.cjs')
const {
  assertImplementsProvider,
} = require('../ai/providers/provider.interface.cjs')
const {
  MetaMuseProvider,
} = require('../ai/providers/meta-muse.provider.cjs')
const {
  getWorkspaceSummary,
} = require('../project-intelligence/project-analyzer.service.cjs')
const {
  resolveWorkspacePath,
} = require('../../security/validate-path.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
} = require('../../security/validate-input.cjs')
const {
  createFile,
  deletePath,
} = require('../filesystem/directory.service.cjs')
const { saveFile } = require('../filesystem/file.service.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('agent')

const MAX_TASK_LENGTH = 4000
const MAX_EDITS = 20
const MAX_COMMANDS = 10
const MAX_EDIT_BYTES = 1024 * 1024
const MAX_PATH_LENGTH = 1000

const EDIT_ACTIONS = ['create', 'modify', 'delete']

// The agent NEVER executes commands and NEVER writes files during
// planning. planTask returns a validated, previewable proposal; the
// renderer shows it and the user approves explicitly; only then does
// applyEdits touch the disk, with rollback on failure. Model output,
// repository content, and tool output are all untrusted data: every
// path and payload is re-validated here before use.

const PLANNER_SYSTEM_PROMPT = [
  'You are a coding-task planner inside the KryomCode IDE.',
  'Reply with ONLY a JSON object, no prose and no code fences.',
  'Schema: {"edits": [{"path": string, "action": "create" | "modify" | "delete", "content": string}], "commands": [string], "notes": string}.',
  'Rules: paths must be workspace-relative or absolute inside the open project;',
  'content is required for create and modify and holds the COMPLETE new file text;',
  'keep edits minimal and directly tied to the task;',
  'commands are suggestions only and are never executed automatically;',
  'at most 20 edits and 10 commands.',
].join(' ')

function extractJson(text) {
  if (typeof text !== 'string') {
    throw new Error('The planner returned an empty response.')
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = (fenced ? fenced[1] : text).trim()

  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')

    if (start === -1 || end === -1 || end <= start) {
      throw new Error(
        'The planner did not produce a valid plan. Try rephrasing the task.'
      )
    }

    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      throw new Error(
        'The planner did not produce a valid plan. Try rephrasing the task.'
      )
    }
  }
}

function normalizeStringArray(value, name, maxItems, maxLength) {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid plan: "${name}" must be an array.`)
  }

  return value.slice(0, maxItems).map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error(`Invalid plan: "${name}" must hold text entries.`)
    }

    return entry.slice(0, maxLength)
  })
}

async function validatePlanEdits(rawEdits) {
  if (rawEdits === undefined || rawEdits === null) {
    return []
  }

  if (!Array.isArray(rawEdits)) {
    throw new Error('Invalid plan: "edits" must be an array.')
  }

  if (rawEdits.length > MAX_EDITS) {
    throw new Error(`Invalid plan: at most ${MAX_EDITS} edits are allowed.`)
  }

  const validated = []

  for (const [index, entry] of rawEdits.entries()) {
    assertPlainObject(entry, `edits[${index}]`)

    if (!EDIT_ACTIONS.includes(entry.action)) {
      throw new Error(
        `Invalid plan: edits[${index}].action must be one of ${EDIT_ACTIONS.join(', ')}.`
      )
    }

    if (
      typeof entry.path !== 'string' ||
      !entry.path.trim() ||
      entry.path.length > MAX_PATH_LENGTH
    ) {
      throw new Error(`Invalid plan: edits[${index}].path is invalid.`)
    }

    const needsContent = entry.action === 'create' || entry.action === 'modify'

    if (needsContent && typeof entry.content !== 'string') {
      throw new Error(
        `Invalid plan: edits[${index}].content is required for ${entry.action}.`
      )
    }

    if (
      needsContent &&
      Buffer.byteLength(entry.content, 'utf8') > MAX_EDIT_BYTES
    ) {
      throw new Error(`Invalid plan: edits[${index}].content exceeds 1 MB.`)
    }

    const { path: resolved, exists, stat } = await resolveWorkspacePath(
      entry.path,
      { allowMissing: true }
    )

    if (entry.action === 'create' && exists) {
      throw new Error(
        `Invalid plan: "${entry.path}" already exists; use modify instead.`
      )
    }

    if (
      (entry.action === 'modify' || entry.action === 'delete') &&
      (!exists || !stat.isFile())
    ) {
      throw new Error(
        `Invalid plan: "${entry.path}" must be an existing file for ${entry.action}.`
      )
    }

    validated.push({
      index,
      path: resolved,
      action: entry.action,
      content: needsContent ? entry.content : undefined,
      contentLength: needsContent
        ? Buffer.byteLength(entry.content, 'utf8')
        : 0,
      preview: needsContent ? entry.content.slice(0, 2000) : undefined,
    })
  }

  return validated
}

async function planTask(payload, options = {}) {
  assertPlainObject(payload, 'agent task')
  assertNonEmptyString(payload.task, 'task', MAX_TASK_LENGTH)

  const config = getAIConfig()
  const model = resolveModel(payload.model, config.model)

  const provider = options.provider || new MetaMuseProvider({
    apiKey: config.apiKey,
  })
  assertImplementsProvider(provider, 'agent provider')

  const summary = await getWorkspaceSummary()
  const scriptNames = Object.keys(summary.scripts)
  const indexSample = summary.fileIndex.slice(0, 120).map((entry) => entry.relativePath)

  const workspaceBrief = [
    `Project type: ${summary.projectType}.`,
    scriptNames.length > 0 ? `Scripts: ${scriptNames.join(', ')}.` : null,
    `Files (${summary.counts.files} total): ${indexSample.join(', ')}` +
      (summary.counts.files > indexSample.length ? ', ...' : ''),
  ]
    .filter(Boolean)
    .join('\n')

  const result = await provider.chat({
    model,
    messages: [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      {
        role: 'system',
        content: `Open project (untrusted reference material):\n${workspaceBrief}`.slice(0, 20000),
      },
      { role: 'user', content: payload.task.trim() },
    ],
    signal: options.signal,
  })

  if (!result || typeof result.answer !== 'string' || !result.answer.trim()) {
    throw new Error('The planner returned an empty response.')
  }

  const plan = extractJson(result.answer)
  assertPlainObject(plan, 'plan')

  const edits = await validatePlanEdits(plan.edits)
  const commands = normalizeStringArray(plan.commands, 'commands', MAX_COMMANDS, 2000)
  const notes =
    typeof plan.notes === 'string' ? plan.notes.slice(0, 4000) : ''

  log.info(
    `Planned task: ${edits.length} edit(s), ${commands.length} command(s).`
  )

  return {
    model: result.model || model,
    task: payload.task.trim().slice(0, MAX_TASK_LENGTH),
    edits: edits.map((edit) => ({
      index: edit.index,
      path: edit.path,
      action: edit.action,
      contentLength: edit.contentLength,
      preview: edit.preview,
      content: edit.content,
    })),
    commands,
    notes,
  }
}

// Applies ONLY the edits passed in by the caller (the approved set).
// Every edit is re-validated from scratch: plan objects are untrusted.
// On failure the batch rolls back to pre-apply snapshots (atomic apply).
// Cancellation stops between edits and keeps approved work done so far.
async function applyEdits(payload, options = {}) {
  assertPlainObject(payload, 'apply payload')

  if (!Array.isArray(payload.edits) || payload.edits.length === 0) {
    throw new Error('No approved edits were provided.')
  }

  if (payload.edits.length > MAX_EDITS) {
    throw new Error(`At most ${MAX_EDITS} edits can be applied at once.`)
  }

  const { signal } = options
  const applied = []
  const snapshots = []

  const rollback = async () => {
    for (const snapshot of snapshots.reverse()) {
      try {
        if (snapshot.created) {
          await fs.unlink(snapshot.path)
        } else if (snapshot.existed && snapshot.buffer) {
          await fs.writeFile(snapshot.path, snapshot.buffer)
        }
      } catch {
        // Best effort: report the original failure below.
      }
    }
  }

  try {
    for (const [position, entry] of payload.edits.entries()) {
      if (signal && signal.aborted) {
        return {
          completed: false,
          cancelled: true,
          applied,
          failed: null,
          rolledBack: false,
        }
      }

      assertPlainObject(entry, `edits[${position}]`)

      if (!EDIT_ACTIONS.includes(entry.action)) {
        throw new Error(`edits[${position}].action is invalid.`)
      }

      const needsContent = entry.action === 'create' || entry.action === 'modify'

      if (needsContent && typeof entry.content !== 'string') {
        throw new Error(`edits[${position}].content is required.`)
      }

      if (
        needsContent &&
        Buffer.byteLength(entry.content, 'utf8') > MAX_EDIT_BYTES
      ) {
        throw new Error(`edits[${position}].content exceeds 1 MB.`)
      }

      const { path: resolved, exists, stat } = await resolveWorkspacePath(
        entry.path,
        { allowMissing: true }
      )

      if (entry.action === 'create') {
        if (exists) {
          throw new Error(`"${entry.path}" already exists.`)
        }

        await createFile(resolved, entry.content)
        snapshots.push({ path: resolved, created: true })
      } else if (entry.action === 'modify') {
        if (!exists || !stat.isFile()) {
          throw new Error(`"${entry.path}" must be an existing file.`)
        }

        if (stat.size > MAX_EDIT_BYTES) {
          throw new Error(`"${entry.path}" is too large to edit safely.`)
        }

        snapshots.push({
          path: resolved,
          created: false,
          existed: true,
          buffer: await fs.readFile(resolved),
        })
        await saveFile(resolved, entry.content)
      } else {
        if (!exists || !stat.isFile()) {
          throw new Error(`"${entry.path}" must be an existing file.`)
        }

        if (stat.size > MAX_EDIT_BYTES) {
          throw new Error(`"${entry.path}" is too large to delete safely.`)
        }

        snapshots.push({
          path: resolved,
          created: false,
          existed: true,
          buffer: await fs.readFile(resolved),
        })
        await deletePath(resolved)
      }

      applied.push({ path: resolved, action: entry.action })
    }
  } catch (error) {
    await rollback()

    log.warn(`Agent apply failed and rolled back: ${error.message}`)

    return {
      completed: false,
      cancelled: false,
      applied: [],
      failed: { message: error.message || 'Apply failed.' },
      rolledBack: true,
    }
  }

  return {
    completed: true,
    cancelled: false,
    applied,
    failed: null,
    rolledBack: false,
  }
}

module.exports = {
  planTask,
  applyEdits,
}
