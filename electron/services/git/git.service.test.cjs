const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const { spawnSync } = require('node:child_process')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  runGit,
  getStatus,
  stageFiles,
  commitChanges,
  pushChanges,
} = require('./git.service.cjs')
const {
  getDiff,
  getChangedFiles,
} = require('./git-diff.service.cjs')

function hasGit() {
  try {
    return spawnSync('git', ['--version']).status === 0
  } catch {
    return false
  }
}

const GIT_AVAILABLE = hasGit()

async function openWorkspace(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  await setWorkspaceRoot(dir)

  return dir
}

describe('git.service', () => {
  it('reports folders without git access clearly', async () => {
    const root = await openWorkspace('kryom-nogit-')
    // Deterministic regardless of stray parent repos or GIT_* env vars.
    const savedEnv = {
      GIT_DIR: process.env.GIT_DIR,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE,
      GIT_CEILING_DIRECTORIES: process.env.GIT_CEILING_DIRECTORIES,
    }
    delete process.env.GIT_DIR
    delete process.env.GIT_WORK_TREE
    process.env.GIT_CEILING_DIRECTORIES = path
      .dirname(root)
      .replace(/\\/g, '/')

    try {
      if (GIT_AVAILABLE) {
        await assert.rejects(() => getStatus(), /not a Git repository/)
      } else {
        await assert.rejects(() => getStatus(), /not installed/)
      }
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  it('tracks status, stage, commit, and diff in a real repository', { skip: !GIT_AVAILABLE }, async () => {
    const root = await openWorkspace('kryom-git-')
    await runGit(['init'])
    await runGit(['config', 'user.email', 'test@example.com'])
    await runGit(['config', 'user.name', 'Test'])
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await stageFiles([path.join(root, 'a.txt')])
    await commitChanges('first')

    let status = await getStatus()

    assert.equal(status.clean, true)
    assert.ok(status.branch)

    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    status = await getStatus()

    assert.equal(status.unstaged.length, 1)

    const diff = await getDiff({})

    assert.match(diff.diff, /two/)

    const files = await getChangedFiles({})

    assert.deepEqual(files.files, ['a.txt'])
  })

  it('rejects unsafe push targets', { skip: !GIT_AVAILABLE }, async () => {
    await openWorkspace('kryom-push-')
    await runGit(['init'])

    await assert.rejects(
      () => pushChanges('origin; evil', 'main'),
      /unsafe/
    )
    await assert.rejects(
      () => pushChanges('origin', 'main..evil'),
      /unsafe/
    )
  })

  it('stages through the repository top level from a subfolder workspace', { skip: !GIT_AVAILABLE }, async () => {
    const root = await openWorkspace('kryom-subws-')
    await runGit(['init'])
    await runGit(['config', 'user.email', 'test@example.com'])
    await runGit(['config', 'user.name', 'Test'])
    await fs.mkdir(path.join(root, 'packages', 'a'), { recursive: true })
    await fs.writeFile(path.join(root, 'packages', 'a', 'f.txt'), 'x')
    await setWorkspaceRoot(path.join(root, 'packages', 'a'))

    const status = await getStatus()

    assert.ok(status.toplevel)

    // Same join the Git panel uses: toplevel + repo-relative name.
    await stageFiles([`${status.toplevel}/packages/a/f.txt`])

    const after = await getStatus()

    assert.deepEqual(after.staged, ['packages/a/f.txt'])
  })
})
