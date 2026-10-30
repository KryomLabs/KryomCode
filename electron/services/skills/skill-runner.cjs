// Skill execution (Level 4A.3). Runs a validated, enabled skill
// through the existing controlled services — never around them.
// Approval-gated tools (apply, diagnostics) refuse unless the call
// carries an explicit approval from a workflow checkpoint or a
// user-confirmed UI action; the underlying services enforce their
// own gates regardless.
const {
  getSkill,
} = require('./skill-store.cjs')
const {
  requirePermission,
} = require('../permissions/permission.service.cjs')
const {
  assertPlainObject,
  assertNonEmptyString,
  assertStringArray,
  assertOptionalString,
} = require('../../security/validate-input.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('skill-runner')

const MAX_TASK_CHARS = 4000

function skillSubject(skill) {
  return `skill:${skill.scope}:${skill.id}`
}

async function ensureDependencies(skill, baseDir) {
  for (const dep of skill.dependencies) {
    const dependency = await getSkill(dep, { baseDir }).catch(() => null)

    if (!dependency) {
      throw new Error(`Skill "${skill.id}" needs missing skill "${dep}".`)
    }

    if (!dependency.enabled) {
      throw new Error(`Skill "${skill.id}" needs "${dep}", which is disabled.`)
    }
  }
}

async function runSpecialistTool(specialist, task, { contextPaths, planId, provider }) {
  const { runSpecialist } = require('../specialists/specialist.service.cjs')

  return {
    kind: 'specialist-run',
    run: await runSpecialist(
      { specialist, task, contextPaths, planId },
      provider ? { provider } : {}
    ),
  }
}

async function runSkill(payload, options = {}) {
  assertPlainObject(payload, 'skill run')

  const baseDir = options.baseDir
  const skillId = assertNonEmptyString(payload.skillId, 'skill id', 80)
  const task = assertNonEmptyString(payload.task, 'task', MAX_TASK_CHARS).trim()
  const contextPaths = payload.contextPaths === undefined || payload.contextPaths === null
    ? undefined
    : assertStringArray(payload.contextPaths, 'context paths', { maxItems: 32, maxLength: 1000 })
  const planId = assertOptionalString(payload.planId, 'plan id', 80) ?? undefined
  const params = payload.params !== undefined && payload.params !== null
    ? payload.params
    : {}
  const approved = payload.approved === true

  if (params && typeof params !== 'object') {
    throw new Error('Invalid skill params: an object is required.')
  }

  const skill = await getSkill(skillId, { baseDir })

  if (!skill.enabled) {
    throw new Error(`Skill "${skillId}" is disabled.`)
  }

  await ensureDependencies(skill, baseDir)

  const subject = skillSubject(skill)

  for (const permission of skill.permissions) {
    await requirePermission(subject, permission, baseDir)
  }

  const enriched = `${skill.instructions}\n\nTask: ${task}`.slice(0, MAX_TASK_CHARS + 8000)
  const entry = skill.entryTool
  const provider = options.provider

  log.info(`Skill ${skillId} runs tool ${entry}.`)

  if (entry.startsWith('intelligence.')) {
    const { getIndexStatus, refreshIndex } = require('../project-intelligence/code-index.service.cjs')
    const status = await getIndexStatus()

    if (!status.indexed) {
      await refreshIndex()
    }
  }

  if (entry === 'intelligence.search') {
    const { searchProject } = require('../project-intelligence/semantic-search.service.cjs')

    return { kind: 'result', skill: skillId, tool: entry, result: await searchProject(task) }
  }

  if (entry === 'intelligence.architecture') {
    const { analyzeArchitecture } = require('../project-intelligence/architecture.service.cjs')

    return { kind: 'result', skill: skillId, tool: entry, result: await analyzeArchitecture() }
  }

  if (entry === 'intelligence.impact') {
    const { analyzeImpact } = require('../project-intelligence/impact-analysis.service.cjs')

    if (!contextPaths || contextPaths.length === 0) {
      throw new Error('Skill needs context paths for impact analysis.')
    }

    return {
      kind: 'result',
      skill: skillId,
      tool: entry,
      result: await analyzeImpact({ paths: contextPaths }),
    }
  }

  if (entry === 'planning.build') {
    const { buildImplementationPlan } = require('../planning/plan-builder.cjs')

    return {
      kind: 'plan',
      skill: skillId,
      tool: entry,
      result: await buildImplementationPlan(
        { requirement: enriched, contextPaths },
        provider ? { provider } : {}
      ),
    }
  }

  if (entry === 'agent.propose') {
    const { planTask } = require('../agent/agent.service.cjs')

    return {
      kind: 'proposal',
      skill: skillId,
      tool: entry,
      result: await planTask({ task: enriched, contextPaths }, provider ? { provider } : {}),
    }
  }

  if (entry === 'agent.apply') {
    if (!approved) {
      throw new Error('Skill apply needs an explicit approval first.')
    }

    if (!Array.isArray(params.edits)) {
      throw new Error('Skill apply needs params.edits.')
    }

    const { applyEdits } = require('../agent/agent.service.cjs')

    return {
      kind: 'applied',
      skill: skillId,
      tool: entry,
      result: await applyEdits({ task: enriched.slice(0, 4000), edits: params.edits }),
    }
  }

  if (entry === 'diagnostics.run') {
    if (!approved) {
      throw new Error('Skill diagnostics need an explicit approval first.')
    }

    if (typeof params.command !== 'string' || !params.command) {
      throw new Error('Skill diagnostics need params.command.')
    }

    const { runDiagnostics } = require('../diagnostics/diagnostics.service.cjs')

    return {
      kind: 'diagnostics',
      skill: skillId,
      tool: entry,
      result: await runDiagnostics(params.command),
    }
  }

  if (entry === 'quality.build') {
    const { buildQualityReport } = require('../quality/quality.service.cjs')

    return {
      kind: 'result',
      skill: skillId,
      tool: entry,
      result: await buildQualityReport({ planId, paths: contextPaths }),
    }
  }

  if (entry.startsWith('specialist.')) {
    const specialist = entry.slice('specialist.'.length)
    const started = await runSpecialistTool(specialist, enriched, { contextPaths, planId, provider })

    return { kind: started.kind, skill: skillId, tool: entry, run: started.run }
  }

  throw new Error(`Skill entry tool "${entry}" is not executable.`)
}

module.exports = {
  runSkill,
}
