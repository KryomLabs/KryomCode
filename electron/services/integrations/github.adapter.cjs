// GitHub adapter (Level 4A.4). Honest local-git integration:
// repository metadata, branch info, remotes, and commit history
// through the existing git service. No tokens, no API calls, no
// invented PR/issue data — capabilities name exactly what works.
// Write operations stay on the existing git channels with their
// approvals; this adapter only reads.
const {
  ensureRepository,
  getStatus,
  getRemotes,
  verifyRemote,
  runGit,
} = require('../git/git.service.cjs')
const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  connectionState,
  recordConnection,
  clearConnection,
} = require('./registry.cjs')
const { boundDetail } = require('../../utils/errors.cjs')

const MAX_HISTORY = 50

function parseGitHubRepo(url) {
  if (typeof url !== 'string') {
    return null
  }

  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(\.git)?$/i)

  if (!match) {
    return null
  }

  return { owner: match[1], repo: match[2] }
}

async function currentRepository() {
  await ensureRepository()

  const root = getWorkspaceRoot()
  const [status, remotes] = await Promise.all([getStatus(), getRemotes()])
  const origin = remotes.remotes.find((entry) => entry.name === 'origin') || remotes.remotes[0] || null
  const github = origin ? parseGitHubRepo(origin.fetchUrl || origin.pushUrl) : null

  return {
    root,
    branch: status.branch,
    upstream: status.upstream,
    clean: status.clean,
    remotes: remotes.remotes,
    github,
  }
}

async function status({ baseDir } = {}) {
  const stored = await connectionState('github', baseDir)

  try {
    const repo = await currentRepository()

    return {
      connected: true,
      ...stored,
      state: 'connected',
      repository: repo,
      detail: repo.github
        ? `Local git repository tracking ${repo.github.owner}/${repo.github.repo}.`
        : 'Local git repository (no GitHub remote detected).',
    }
  } catch (error) {
    return {
      connected: false,
      ...stored,
      state: 'disconnected',
      repository: null,
      detail: boundDetail(error.message, 300),
    }
  }
}

async function connect({ baseDir } = {}) {
  const repo = await currentRepository().catch((error) => {
    throw new Error(`Cannot connect: ${error.message}`)
  })

  // Verification reuses the existing safe remote check (https-only,
  // github allowlist, timeouts, redaction) against the origin URL.
  const origin = repo.remotes.find((entry) => entry.name === 'origin') || repo.remotes[0] || null
  const url = origin ? origin.fetchUrl || origin.pushUrl : null
  let verified = false

  if (url) {
    try {
      const result = await verifyRemote(url)

      verified = result.ok === true
    } catch {
      verified = false
    }
  }

  return recordConnection(
    'github',
    {
      state: verified ? 'connected' : 'local-only',
      account: repo.github ? `${repo.github.owner}/${repo.github.repo}` : null,
      detail: verified
        ? 'Remote verified over the existing git channel.'
        : 'Local repository only; remote verification did not succeed.',
    },
    baseDir
  )
}

async function disconnect({ baseDir } = {}) {
  // Tokenless adapter: nothing to revoke — clear the recorded state.
  return clearConnection('github', baseDir)
}

async function repositories() {
  try {
    const repo = await currentRepository()

    return {
      repositories: [
        {
          name: repo.github ? `${repo.github.owner}/${repo.github.repo}` : 'local repository',
          branch: repo.branch,
          local: true,
          github: repo.github,
        },
      ],
      source: 'local',
    }
  } catch {
    return { repositories: [], source: 'local' }
  }
}

async function history({ limit = 20 } = {}) {
  await ensureRepository()

  const bounded = Math.min(Math.max(1, limit), MAX_HISTORY)
  const result = await runGit([
    'log',
    `--max-count=${bounded}`,
    '--format=%H%x00%an%x00%ad%x00%s',
    '--date=short',
  ])

  if (result.exitCode !== 0) {
    throw new Error(boundDetail(result.stderr, 2000) || 'Git history failed.')
  }

  const commits = []

  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) {
      continue
    }

    const [hash, author, date, subject] = line.split('\x00')

    if (hash && subject !== undefined) {
      commits.push({
        hash: hash.slice(0, 40),
        author: (author || '').slice(0, 200),
        date: (date || '').slice(0, 40),
        subject: (subject || '').slice(0, 500),
      })
    }
  }

  return { commits: commits.slice(0, MAX_HISTORY) }
}

const githubAdapter = {
  id: 'github',
  displayName: 'GitHub (local git)',
  description: 'Repository, branch, remote, and history insight through local git. No tokens; PRs and issues are not supported.',
  auth: { kind: 'none' },
  capabilities: ['repositories.local', 'branches', 'remotes', 'history'],
  status,
  connect,
  disconnect,
  repositories,
  history,
}

module.exports = {
  githubAdapter,
  parseGitHubRepo,
}
