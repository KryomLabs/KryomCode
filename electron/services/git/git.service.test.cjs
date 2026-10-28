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
  getRemotes,
  verifyRemote,
  cloneRepository,
  stageFiles,
  unstageFiles,
  discardChanges,
  commitChanges,
  pushChanges,
  pullChanges,
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

  it('unstages without touching worktree contents', { skip: !GIT_AVAILABLE }, async () => {
    const root = await openWorkspace('kryom-unstage-')
    await runGit(['init'])
    await runGit(['config', 'user.email', 'test@example.com'])
    await runGit(['config', 'user.name', 'Test'])
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await stageFiles([path.join(root, 'a.txt')])
    await commitChanges('first')
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    await stageFiles([path.join(root, 'a.txt')])

    let status = await getStatus()

    assert.deepEqual(status.staged, ['a.txt'])

    const result = await unstageFiles([path.join(root, 'a.txt')])

    assert.equal(result.success, true)
    assert.equal(result.unstaged, 1)

    status = await getStatus()

    assert.deepEqual(status.staged, [])
    assert.deepEqual(status.unstaged, ['a.txt'])

    const kept = await fs.readFile(path.join(root, 'a.txt'), 'utf8')

    assert.equal(kept.replace(/\r\n/g, '\n'), 'two\n')

    await assert.rejects(() => unstageFiles([]), /at least one/)
  })

  it('discards tracked modifications and refuses untracked paths', { skip: !GIT_AVAILABLE }, async () => {
    const root = await openWorkspace('kryom-discard-')
    await runGit(['init'])
    await runGit(['config', 'user.email', 'test@example.com'])
    await runGit(['config', 'user.name', 'Test'])
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await stageFiles([path.join(root, 'a.txt')])
    await commitChanges('first')
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    await fs.writeFile(path.join(root, 'new.txt'), 'untracked\n')

    const result = await discardChanges([path.join(root, 'a.txt')])

    assert.equal(result.success, true)
    assert.equal(result.discarded, 1)

    const restored = await fs.readFile(path.join(root, 'a.txt'), 'utf8')

    assert.equal(restored.replace(/\r\n/g, '\n'), 'one\n')

    const status = await getStatus()

    assert.deepEqual(status.unstaged, [])
    assert.deepEqual(status.untracked, ['new.txt'])

    await assert.rejects(
      () => discardChanges([path.join(root, 'new.txt')]),
      /did not match|failed/
    )
    await assert.rejects(() => discardChanges([]), /at least one/)
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

  it('lists remotes with fetch and push URLs', { skip: !GIT_AVAILABLE }, async () => {
    const root = await openWorkspace('kryom-remotes-')
    await runGit(['init'])

    let empty = await getRemotes()

    assert.deepEqual(empty.remotes, [])

    await runGit(['remote', 'add', 'origin', 'https://github.com/octo/repo.git'])

    const listed = await getRemotes()

    assert.equal(listed.remotes.length, 1)
    assert.equal(listed.remotes[0].name, 'origin')
    assert.equal(listed.remotes[0].fetchUrl, 'https://github.com/octo/repo.git')
    assert.equal(listed.remotes[0].pushUrl, 'https://github.com/octo/repo.git')
    assert.ok(root)
  })

  it('verifies read access against a local repository without network', { skip: !GIT_AVAILABLE }, async () => {
    const root = await openWorkspace('kryom-verify-')
    await runGit(['init'])
    await runGit(['config', 'user.email', 'test@example.com'])
    await runGit(['config', 'user.name', 'Test'])
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await stageFiles([path.join(root, 'a.txt')])
    await commitChanges('first')

    const verified = await verifyRemote(root)

    assert.equal(verified.ok, true)
    assert.equal(verified.kind, 'local')
    assert.ok(verified.refs.length >= 1)

    await assert.rejects(
      () => verifyRemote(path.join(root, 'missing')),
      /does not exist/
    )
  })

  it('rejects dangerous clone and verify targets', { skip: !GIT_AVAILABLE }, async () => {
    await openWorkspace('kryom-clonetarget-')

    await assert.rejects(() => verifyRemote('ext::sh -c id'), /Invalid repository/)
    await assert.rejects(
      () => verifyRemote('file:///etc/passwd'),
      /Invalid repository/
    )
    await assert.rejects(
      () => verifyRemote('https://token123@github.com/octo/repo.git'),
      /Invalid repository/
    )
    await assert.rejects(
      () => verifyRemote('git@evil.com:octo/repo.git'),
      /Invalid repository/
    )
    await assert.rejects(
      () => verifyRemote('https://gitlab.com/octo/repo.git'),
      /Invalid repository/
    )
    await assert.rejects(() => verifyRemote('relative/path'), /Invalid repository/)
    await assert.rejects(() => verifyRemote(''), /Invalid repository/)
  })

  it('clones a local repository into a validated destination', { skip: !GIT_AVAILABLE }, async () => {
    const root = await openWorkspace('kryom-clonesrc-')
    await runGit(['init'])
    await runGit(['config', 'user.email', 'test@example.com'])
    await runGit(['config', 'user.name', 'Test'])
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await stageFiles([path.join(root, 'a.txt')])
    await commitChanges('first')

    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-cloneparent-'))
    const cloned = await cloneRepository(root, parent, 'copy')

    assert.equal(cloned.success, true)

    const clonedFile = await fs.readFile(path.join(cloned.path, 'a.txt'), 'utf8')

    assert.equal(clonedFile.replace(/\r\n/g, '\n'), 'one\n')

    await assert.rejects(
      () => cloneRepository(root, parent, 'copy'),
      /already exists/
    )
    await assert.rejects(
      () => cloneRepository(root, parent, '../evil'),
      /Invalid folder name/
    )
    await assert.rejects(
      () => cloneRepository(root, path.join(parent, 'missing'), 'x'),
      /does not exist/
    )
  })

  it('pulls fast-forward changes from a local remote', { skip: !GIT_AVAILABLE }, async () => {
    const origin = await openWorkspace('kryom-pullorigin-')
    await runGit(['init'])
    await runGit(['config', 'user.email', 'test@example.com'])
    await runGit(['config', 'user.name', 'Test'])
    await fs.writeFile(path.join(origin, 'a.txt'), 'one\n')
    await stageFiles([path.join(origin, 'a.txt')])
    await commitChanges('first')
    const branch = (await getStatus()).branch

    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-pullparent-'))
    const cloned = await cloneRepository(origin, parent, 'work')
    await setWorkspaceRoot(cloned.path)

    await fs.writeFile(path.join(origin, 'b.txt'), 'two\n')
    await setWorkspaceRoot(origin)
    await stageFiles([path.join(origin, 'b.txt')])
    await commitChanges('second')

    await setWorkspaceRoot(cloned.path)
    const pulled = await pullChanges('origin', branch)

    assert.equal(pulled.success, true)

    const fetched = await fs.readFile(path.join(cloned.path, 'b.txt'), 'utf8')

    assert.equal(fetched.replace(/\r\n/g, '\n'), 'two\n')

    await assert.rejects(
      () => pullChanges('origin; evil', branch),
      /unsafe/
    )
  })
})
