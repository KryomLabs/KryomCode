const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  grantPermission,
} = require('../permissions/permission.service.cjs')
const {
  saveSkill,
  setSkillEnabled,
} = require('./skill-store.cjs')
const {
  runSkill,
} = require('./skill-runner.cjs')

const SAVED_KEY = process.env.MODEL_API_KEY

afterEach(() => {
  if (SAVED_KEY === undefined) {
    delete process.env.MODEL_API_KEY
  } else {
    process.env.MODEL_API_KEY = SAVED_KEY
  }
})
async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-skillrun-'))
}

async function openFixture() {
  const base = await tempBase()
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-skillws-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'auth.ts'), 'export class Auth {}\n')
  await setWorkspaceRoot(root)

  return { base, root }
}

describe('skill-runner', () => {
  it('runs readonly skills through existing intelligence services', async () => {
    const { base } = await openFixture()

    await saveSkill(
      {
        skillVersion: 1,
        id: 'arch-skill',
        name: 'Arch',
        description: '',
        version: '1.0.0',
        instructions: 'Summarize.',
        tools: ['intelligence.architecture'],
        entryTool: 'intelligence.architecture',
        permissions: ['workspace.metadata'],
      },
      { scope: 'user', baseDir: base }
    )
    await grantPermission('skill:user:arch-skill', 'workspace.metadata', base)

    const result = await runSkill({ skillId: 'arch-skill', task: 'Summarize' }, { baseDir: base })

    assert.equal(result.kind, 'result')
    assert.equal(result.tool, 'intelligence.architecture')
    assert.ok(result.result.primaryLanguage)
  })

  it('denies ungranted permissions with a clear error', async () => {
    const { base } = await openFixture()

    await saveSkill(
      {
        skillVersion: 1,
        id: 'arch-skill',
        name: 'Arch',
        description: '',
        version: '1.0.0',
        instructions: 'Summarize.',
        tools: ['intelligence.architecture'],
        entryTool: 'intelligence.architecture',
        permissions: ['workspace.metadata'],
      },
      { scope: 'user', baseDir: base }
    )

    await assert.rejects(
      () => runSkill({ skillId: 'arch-skill', task: 'Summarize' }, { baseDir: base }),
      /Permission denied.*workspace\.metadata/
    )
  })

  it('refuses disabled skills and missing dependencies', async () => {
    const { base } = await openFixture()

    await saveSkill(
      {
        skillVersion: 1,
        id: 'needy',
        name: 'Needy',
        description: '',
        version: '1.0.0',
        instructions: 'x.',
        tools: ['intelligence.search'],
        entryTool: 'intelligence.search',
        permissions: ['workspace.metadata'],
        dependencies: ['ghost-skill'],
      },
      { scope: 'user', baseDir: base }
    )
    await grantPermission('skill:user:needy', 'workspace.metadata', base)

    await assert.rejects(
      () => runSkill({ skillId: 'needy', task: 'x' }, { baseDir: base }),
      /missing skill/
    )

    await setSkillEnabled('needy', false, { baseDir: base })
    await assert.rejects(
      () => runSkill({ skillId: 'needy', task: 'x' }, { baseDir: base }),
      /disabled/
    )
  })

  it('gates apply and diagnostics behind explicit approval', async () => {
    const { base } = await openFixture()

    await saveSkill(
      {
        skillVersion: 1,
        id: 'writer',
        name: 'Writer',
        description: '',
        version: '1.0.0',
        instructions: 'Write.',
        tools: ['agent.apply'],
        entryTool: 'agent.apply',
        permissions: ['workspace.write'],
      },
      { scope: 'user', baseDir: base }
    )
    await grantPermission('skill:user:writer', 'workspace.write', base)

    await assert.rejects(
      () => runSkill({ skillId: 'writer', task: 'x', params: { edits: [] } }, { baseDir: base }),
      /explicit approval/
    )
  })
})
