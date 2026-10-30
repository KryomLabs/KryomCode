const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  runGit,
} = require('../git/git.service.cjs')
const {
  githubAdapter,
  parseGitHubRepo,
} = require('./github.adapter.cjs')

async function tempBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kryom-github-'))
}

async function openRepo() {
  const base = await tempBase()
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-ghws-'))

  await setWorkspaceRoot(root)
  await runGit(['init'])
  await fs.writeFile(path.join(root, 'README.md'), '# test\n')
  await runGit(['add', 'README.md'])
  await runGit(['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'first'])

  return { base, root }
}

describe('github-adapter', () => {
  it('parses GitHub remotes and rejects others', () => {
    assert.deepEqual(parseGitHubRepo('https://github.com/octo/repo.git'), { owner: 'octo', repo: 'repo' })
    assert.deepEqual(parseGitHubRepo('git@github.com:octo/repo.git'), { owner: 'octo', repo: 'repo' })
    assert.equal(parseGitHubRepo('https://gitlab.com/octo/repo.git'), null)
    assert.equal(parseGitHubRepo(null), null)
  })

  it('reports disconnected state outside repositories', async () => {
    const base = await tempBase()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-ghplain-'))

    await setWorkspaceRoot(root)

    // Deterministic regardless of stray parent repos or GIT_* env vars
    // (same hardening as git.service.test.cjs): stop git's parent
    // traversal at the temp dir so a fresh folder reads as repo-less.
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
      const status = await githubAdapter.status({ baseDir: base })

      assert.equal(status.connected, false)
      assert.equal(status.state, 'disconnected')

      const repos = await githubAdapter.repositories()

      assert.deepEqual(repos.repositories, [])

      await githubAdapter.disconnect({ baseDir: base })
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

  it('reads local repository metadata, branches, and history', async () => {
    const { base } = await openRepo()

    const status = await githubAdapter.status({ baseDir: base })

    assert.equal(status.connected, true)
    assert.equal(status.repository.clean, true)
    assert.ok(Array.isArray(status.repository.remotes))

    const repos = await githubAdapter.repositories()

    assert.equal(repos.repositories.length, 1)
    assert.equal(repos.repositories[0].local, true)
    assert.equal(repos.source, 'local')

    const history = await githubAdapter.history({ limit: 5 })

    assert.equal(history.commits.length, 1)
    assert.equal(history.commits[0].subject, 'first')
    assert.equal(history.commits[0].hash.length, 40)
  })

  it('connects locally without network and clears on disconnect', async () => {
    const { base } = await openRepo()

    const connected = await githubAdapter.connect({ baseDir: base })

    assert.ok(['connected', 'local-only'].includes(connected.state))

    const stored = await githubAdapter.status({ baseDir: base })

    assert.equal(stored.connected, true)

    await githubAdapter.disconnect({ baseDir: base })

    const cleared = await githubAdapter.status({ baseDir: base })

    assert.equal(cleared.account, null)
  })
})
