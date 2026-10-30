const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  SKILL_TOOLS,
  validateSkill,
  listSkills,
  getSkill,
  saveSkill,
  deleteSkill,
  setSkillEnabled,
} = require('./skill-store.cjs')
const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-skill-'))
}

function validSkill(overrides = {}) {
  return {
    skillVersion: 1,
    id: 'my-skill',
    name: 'My skill',
    description: 'test',
    version: '1.0.0',
    instructions: 'Do the thing carefully.',
    tools: ['intelligence.search'],
    entryTool: 'intelligence.search',
    permissions: ['workspace.metadata'],
    ...overrides,
  }
}

describe('skill-store', () => {
  it('validates skills strictly', () => {
    assert.equal(validateSkill(validSkill()).id, 'my-skill')
    assert.throws(() => validateSkill({ ...validSkill(), id: 'Bad!' }), /"id"/)
    assert.throws(() => validateSkill({ ...validSkill(), tools: ['nope.tool'] }), /unknown tool/)
    assert.throws(
      () => validateSkill({ ...validSkill(), entryTool: 'specialist.review' }),
      /entryTool/
    )
    assert.throws(
      () => validateSkill({ ...validSkill(), tools: ['specialist.review'], entryTool: 'specialist.review' }),
      /requires permission "ai.tools"/
    )
    assert.ok(SKILL_TOOLS['agent.apply'].approval)
  })

  it('ships builtin skills and manages user skills', async () => {
    const base = await tempBase()
    const listed = await listSkills({ baseDir: base })
    const ids = listed.skills.map((skill) => skill.id)

    assert.ok(ids.includes('project-analyst'))
    assert.ok(ids.includes('code-reviewer'))
    assert.ok(listed.skills.every((skill) => skill.enabled))

    const saved = await saveSkill(validSkill(), { scope: 'user', baseDir: base })

    assert.equal(saved.scope, 'user')
    assert.equal((await getSkill('my-skill', { baseDir: base })).scope, 'user')

    await setSkillEnabled('my-skill', false, { baseDir: base })
    assert.equal((await getSkill('my-skill', { baseDir: base })).enabled, false)

    await deleteSkill('my-skill', { scope: 'user', baseDir: base })
    await assert.rejects(() => getSkill('my-skill', { baseDir: base }), /not found/)
  })

  it('supports project skills with precedence over user skills', async () => {
    const base = await tempBase()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-skillws-'))

    await setWorkspaceRoot(root)
    await saveSkill(validSkill(), { scope: 'user', baseDir: base })
    await saveSkill(validSkill({ description: 'project copy' }), { scope: 'project', baseDir: base })

    const skill = await getSkill('my-skill', { baseDir: base })

    assert.equal(skill.scope, 'project')
    assert.equal(skill.description, 'project copy')

    await deleteSkill('my-skill', { scope: 'project', baseDir: base })
    assert.equal((await getSkill('my-skill', { baseDir: base })).scope, 'user')

    await assert.rejects(
      () => deleteSkill('my-skill', { scope: 'project', baseDir: base }),
      /not found/
    )

    await assert.rejects(
      () => saveSkill(validSkill({ id: 'x' }), { scope: 'builtin', baseDir: base }),
      /read-only/
    )
  })

  it('reports corrupt skill files instead of crashing', async () => {
    const base = await tempBase()

    await fs.mkdir(path.join(base, 'kryomcode-skills'), { recursive: true })
    await fs.writeFile(path.join(base, 'kryomcode-skills', 'bad.json'), '{nope')

    const listed = await listSkills({ baseDir: base })

    assert.ok(listed.corrupt.includes('bad.json'))
  })
})
