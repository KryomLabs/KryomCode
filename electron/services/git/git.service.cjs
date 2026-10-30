const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  buildChildEnv,
} = require('../terminal/terminal.service.cjs')
const {
  killProcessTree,
  markKilled,
  consumeKillMark,
  markDetachedProcess,
} = require('../terminal/process-manager.cjs')
const { shouldDetach } = require('../../utils/platform.cjs')
const {
  assertNonEmptyString,
  assertStringArray,
  assertOptionalString,
} = require('../../security/validate-input.cjs')
const {
  resolveWorkspacePath,
} = require('../../security/validate-path.cjs')
const { createLogger } = require('../../utils/logger.cjs')
const { boundDetail } = require('../../utils/errors.cjs')

const log = createLogger('git')
const TIMEOUT_MS = 30000
const MAX_OUTPUT_LENGTH = 200_000
const MAX_ERROR_DETAIL = 2000
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/

const activeChildren = new Set()

function cancelGitProcesses() {
  let killed = 0

  for (const child of activeChildren) {
    markKilled(child)

    if (killProcessTree(child)) {
      killed += 1
    }
  }

  activeChildren.clear()

  return { killed }
}

function killAllActiveProcesses() {
  cancelGitProcesses()
}

function spawnGit(cwd, args, { timeoutMs = TIMEOUT_MS, extraEnv = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    let child = null

    const childEnv = { ...buildChildEnv(), ...extraEnv }
    delete childEnv.GIT_DIR
    delete childEnv.GIT_WORK_TREE
    delete childEnv.GIT_PREFIX
    delete childEnv.GIT_INDEX_FILE

    try {
      const detached = shouldDetach()

      child = spawn('git', args, {
        cwd,
        shell: false,
        windowsHide: true,
        ...(detached ? { detached: true } : {}),
        env: childEnv,
      })

      if (detached) {
        markDetachedProcess(child)
      }
    } catch (error) {
      reject(error)
      return
    }

    activeChildren.add(child)

    let outputLimited = false

    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child)
    }, timeoutMs)

    const onAbort = () => {
      markKilled(child)
      killProcessTree(child)
    }

    if (signal) {
      if (signal.aborted) {
        markKilled(child)
        killProcessTree(child)
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    const cleanup = () => {
      clearTimeout(timer)
      activeChildren.delete(child)

      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      const remaining = MAX_OUTPUT_LENGTH - stdout.length

      if (remaining <= 0) {
        outputLimited = true
        return
      }

      stdout += text.slice(0, remaining)

      if (text.length > remaining) {
        outputLimited = true
      }
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      const remaining = MAX_OUTPUT_LENGTH - stderr.length

      if (remaining <= 0) {
        outputLimited = true
        return
      }

      stderr += text.slice(0, remaining)

      if (text.length > remaining) {
        outputLimited = true
      }
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()

      if (error.code === 'ENOENT') {
        reject(new Error('Git is not installed or not on PATH.'))
        return
      }

      reject(new Error(`Git failed to start: ${error.message}`))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      cleanup()

      const cancelled = consumeKillMark(child) && !timedOut

      if (cancelled) {
        reject(new Error('Git operation was cancelled.'))
        return
      }

      if (timedOut) {
        reject(
          new Error(
            `Git operation timed out after ${Math.round(timeoutMs / 1000)} seconds.`
          )
        )
        return
      }

      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
        outputLimited,
      })
    })
  })
}

function runGit(args, options = {}) {
  const workspaceRoot = getWorkspaceRoot()

  if (!workspaceRoot) {
    throw new Error('Open a project folder first.')
  }

  return spawnGit(workspaceRoot, args, options)
}

async function ensureRepository() {
  let result = null

  try {
    result = await runGit(['rev-parse', '--is-inside-work-tree'])
  } catch (error) {
    throw error
  }

  if (result.exitCode !== 0 || result.stdout.trim() !== 'true') {
    throw new Error('The selected folder is not a Git repository.')
  }
}

async function getStatus() {
  await ensureRepository()

  const branchResult = await runGit(['branch', '--show-current'])
  const statusResult = await runGit(['status', '--porcelain=v1', '-b'])

  if (statusResult.exitCode !== 0) {
    throw new Error(
      boundDetail(statusResult.stderr, MAX_ERROR_DETAIL) || 'Git status failed.'
    )
  }

  const staged = []
  const unstaged = []
  const untracked = []
  let branch = branchResult.stdout.trim()
  let upstream = null

  for (const line of statusResult.stdout.split('\n')) {
    if (!line) {
      continue
    }

    if (line.startsWith('## ')) {
      const header = line.slice(3).split('...')[0]
      if (!branch || branch === 'HEAD') {
        branch = header
      }
      const upstreamMatch = line.match(/\.\.\.(\S+)/)
      if (upstreamMatch) {
        upstream = upstreamMatch[1]
      }
      continue
    }

    const index = line[0]
    const worktree = line[1]
    const filePath = line.slice(3)

    if (index === '?' && worktree === '?') {
      untracked.push(filePath)
    } else {
      if (index !== ' ' && index !== '?') {
        staged.push(filePath)
      }
      if (worktree !== ' ' && worktree !== '?') {
        unstaged.push(filePath)
      }
    }
  }

  const toplevelResult = await runGit(['rev-parse', '--show-toplevel'])
  const toplevel =
    toplevelResult.exitCode === 0 ? toplevelResult.stdout.trim() : ''

  return {
    branch: branch || null,
    upstream,
    toplevel,
    staged,
    unstaged,
    untracked,
    clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
  }
}

async function stageFiles(paths) {
  assertStringArray(paths, 'paths', { maxItems: 200 })
  await ensureRepository()

  const { getWorkspaceRoot: getRoot } = require('../workspace/workspace.service.cjs')
  const path = require('node:path')
  const root = getRoot()
  const relative = []

  for (const entry of paths) {
    const { path: resolved } = await resolveWorkspacePath(entry)
    relative.push(path.relative(root, resolved))
  }

  const result = await runGit(['add', '--', ...relative])

  if (result.exitCode !== 0) {
    throw new Error(boundDetail(result.stderr, MAX_ERROR_DETAIL) || 'Git stage failed.')
  }

  log.info(`Staged ${relative.length} path(s).`)

  return { success: true, staged: relative.length }
}

// Moves staged entries back to unstaged without touching worktree
// contents. Never defaults to "everything": an empty selection is an
// error, because bare `git reset` would unstage the whole index.
async function unstageFiles(paths) {
  assertStringArray(paths, 'paths', { maxItems: 200 })

  if (paths.length === 0) {
    throw new Error('Select at least one staged file to unstage.')
  }

  await ensureRepository()

  const root = getWorkspaceRoot()
  const relative = []

  for (const entry of paths) {
    const { path: resolved } = await resolveWorkspacePath(entry)
    relative.push(path.relative(root, resolved))
  }

  const result = await runGit(['reset', 'HEAD', '--', ...relative])

  if (result.exitCode !== 0) {
    throw new Error(boundDetail(result.stderr, MAX_ERROR_DETAIL) || 'Git unstage failed.')
  }

  log.info(`Unstaged ${relative.length} path(s).`)

  return { success: true, unstaged: relative.length }
}

// Restores tracked worktree files to their HEAD contents. Untracked
// files are refused (they have nothing to restore to); the renderer
// deletes those through the normal file flow with confirmation.
async function discardChanges(paths) {
  assertStringArray(paths, 'paths', { maxItems: 200 })

  if (paths.length === 0) {
    throw new Error('Select at least one changed file to discard.')
  }

  await ensureRepository()

  const root = getWorkspaceRoot()
  const relative = []

  for (const entry of paths) {
    const { path: resolved } = await resolveWorkspacePath(entry)
    relative.push(path.relative(root, resolved))
  }

  const result = await runGit(['checkout', '--', ...relative])

  if (result.exitCode !== 0) {
    throw new Error(boundDetail(result.stderr, MAX_ERROR_DETAIL) || 'Git discard failed.')
  }

  log.info(`Discarded changes in ${relative.length} path(s).`)

  return { success: true, discarded: relative.length }
}

async function commitChanges(message) {
  assertNonEmptyString(message, 'commit message', 2000)
  await ensureRepository()

  const result = await runGit(['commit', '-m', message])

  if (result.exitCode !== 0) {
    const detail = (result.stdout + '\n' + result.stderr).trim()

    if (/nothing to commit/i.test(detail)) {
      throw new Error('Nothing to commit. Stage changes first.')
    }

    throw new Error(boundDetail(detail, MAX_ERROR_DETAIL) || 'Git commit failed.')
  }

  log.info('Created a commit.')

  return { success: true }
}

function assertRef(value, name) {
  assertNonEmptyString(value, name, 200)

  if (!REF_PATTERN.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${name}: unsafe characters rejected.`)
  }

  // Refs travel positionally into `git push/pull`, where a leading
  // dash would parse as an option (e.g. remote `--tags`).
  if (value.startsWith('-')) {
    throw new Error(`Invalid ${name}: must not start with '-'.`)
  }

  return value
}

async function pushChanges(remote, branch) {
  const safeRemote = assertRef(
    assertOptionalString(remote, 'remote', 200) || 'origin',
    'remote'
  )
  await ensureRepository()

  let safeBranch = assertOptionalString(branch, 'branch', 200)

  if (!safeBranch) {
    const branchResult = await runGit(['branch', '--show-current'])
    safeBranch = branchResult.stdout.trim()

    if (!safeBranch) {
      throw new Error('Cannot determine the current branch.')
    }
  }

  assertRef(safeBranch, 'branch')

  const result = await runGit(['push', safeRemote, safeBranch], {
    timeoutMs: 120000,
  })

  if (result.exitCode !== 0) {
    const detail = (result.stdout + '\n' + result.stderr).trim()
    throw new Error(boundDetail(detail, MAX_ERROR_DETAIL) || 'Git push failed.')
  }

  log.info(`Pushed ${safeBranch} to ${safeRemote}.`)

  return { success: true, remote: safeRemote, branch: safeBranch }
}

// Strips userinfo (a classic embedded-token shape) from remote URLs
// before they reach the renderer. SCP-style SSH (git@host:...) has
// no secretable password and passes through untouched.
function redactRemoteUrl(url) {
  const schemeEnd = url.indexOf('://')

  if (schemeEnd === -1) {
    return url
  }

  const afterScheme = url.slice(schemeEnd + 3)
  const at = afterScheme.indexOf('@')
  const slash = afterScheme.indexOf('/')

  if (at === -1 || (slash !== -1 && slash < at)) {
    return url
  }

  return `${url.slice(0, schemeEnd + 3)}[REDACTED]@${afterScheme.slice(at + 1)}`
}

async function getRemotes() {
  await ensureRepository()

  const result = await runGit(['remote', '-v'])

  if (result.exitCode !== 0) {
    throw new Error(boundDetail(result.stderr, MAX_ERROR_DETAIL) || 'Git remote lookup failed.')
  }

  const byName = new Map()

  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)

    if (!match) {
      continue
    }

    const [, name, url, kind] = match
    const entry = byName.get(name) || { name, fetchUrl: null, pushUrl: null }

    if (kind === 'fetch') {
      entry.fetchUrl = redactRemoteUrl(url)
    } else {
      entry.pushUrl = redactRemoteUrl(url)
    }

    byName.set(name, entry)
  }

  return { remotes: [...byName.values()] }
}

const GITHUB_HTTPS_PATTERN =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?$/
const GITHUB_SSH_PATTERN =
  /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?$/
const CLONE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/

function assertSegment(value) {
  return (
    typeof value === 'string' &&
    CLONE_NAME_PATTERN.test(value) &&
    !value.includes('..') &&
    value !== '.' &&
    value !== '..'
  )
}

// Single choke point for clone/verify targets. Only GitHub HTTPS/SSH
// repository URLs and existing local directories are accepted. In
// particular, ext::, file::, ssh:// with options, and URLs carrying
// userinfo (a classic token-leak shape) are all rejected.
async function assertCloneTarget(rawUrl) {
  assertNonEmptyString(rawUrl, 'repository URL', 2000)

  const url = rawUrl.trim()

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>|&;$`]/.test(url)) {
    throw new Error('Invalid repository URL: unsafe characters rejected.')
  }

  const https = url.match(GITHUB_HTTPS_PATTERN)
  const ssh = url.match(GITHUB_SSH_PATTERN)

  if (https || ssh) {
    const [, owner, repo] = https || ssh

    if (!assertSegment(owner) || !assertSegment(repo)) {
      throw new Error('Invalid repository URL.')
    }

    return { kind: 'github', url, name: repo }
  }

  // Anything with a scheme or scp-like syntax that is not an accepted
  // GitHub form is rejected here (ext::, file://, ssh://, userinfo).
  // Single-letter prefixes are drive letters (C:\...), not schemes.
  if (
    /^[A-Za-z][A-Za-z0-9+.-]{1,}:/.test(url) ||
    /^[^@\s]+@[^:\s]+:/.test(url)
  ) {
    throw new Error(
      'Invalid repository URL: only GitHub HTTPS/SSH or a local folder.'
    )
  }

  if (!path.isAbsolute(url)) {
    throw new Error(
      'Invalid repository URL: expected a GitHub repository or a local folder.'
    )
  }

  let stat = null

  try {
    stat = await fs.stat(url)
  } catch {
    throw new Error('Local clone source does not exist.')
  }

  if (!stat.isDirectory()) {
    throw new Error('Local clone source is not a folder.')
  }

  return { kind: 'local', url: await fs.realpath(url), name: path.basename(url) }
}

function assertCloneName(rawName) {
  assertNonEmptyString(rawName, 'folder name', 100)

  const name = rawName.trim()

  if (!assertSegment(name)) {
    throw new Error('Invalid folder name.')
  }

  return name
}

// Verifies read access without cloning: lists remote branch heads.
// Prompts are disabled so missing credentials fail fast with git's
// own error instead of hanging. Nothing is stored.
async function verifyRemote(rawUrl) {
  const target = await assertCloneTarget(rawUrl)

  const result = await spawnGit(os.tmpdir(), ['ls-remote', '--heads', '--', target.url], {
    timeoutMs: 60000,
    extraEnv: { GIT_TERMINAL_PROMPT: '0' },
  })

  if (result.exitCode !== 0) {
    const detail = (result.stdout + '\n' + result.stderr).trim()

    throw new Error(boundDetail(detail, MAX_ERROR_DETAIL) || 'Remote verification failed.')
  }

  const refs = []

  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^[0-9a-f]+\s+refs\/heads\/(.+)$/)

    if (match) {
      refs.push(match[1])
    }
  }

  return { ok: true, kind: target.kind, url: target.url, refs: refs.slice(0, 50) }
}

async function cloneRepository(rawUrl, parentDir, rawName) {
  const target = await assertCloneTarget(rawUrl)

  if (typeof parentDir !== 'string' || !path.isAbsolute(parentDir)) {
    throw new Error('Invalid destination: an absolute folder is required.')
  }

  let parentStat = null

  try {
    parentStat = await fs.stat(parentDir)
  } catch {
    throw new Error('Destination folder does not exist.')
  }

  if (!parentStat.isDirectory()) {
    throw new Error('Destination is not a folder.')
  }

  const name = assertCloneName(rawName ?? target.name)
  const destination = path.join(await fs.realpath(parentDir), name)

  try {
    await fs.lstat(destination)
    throw new Error(
      `"${name}" already exists in the destination folder. Remove it or pick another location.`
    )
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  let result = null

  try {
    result = await spawnGit(
      parentDir,
      ['clone', '--', target.url, destination],
      {
        timeoutMs: 300000,
        extraEnv: { GIT_TERMINAL_PROMPT: '0' },
      }
    )
  } catch (error) {
    // A cancelled clone leaves a partial directory behind; remove it
    // so the next attempt does not fail on "already exists".
    if (/cancelled/i.test(error.message)) {
      await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined)
    }

    throw error
  }

  if (result.exitCode !== 0) {
    // A failed clone leaves a partial directory behind; remove it so
    // the next attempt does not fail on "already exists". The
    // destination provably did not exist before the clone ran.
    await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined)

    const detail = (result.stdout + '\n' + result.stderr).trim()

    throw new Error(boundDetail(detail, MAX_ERROR_DETAIL) || 'Git clone failed.')
  }

  return { success: true, path: destination }
}

async function pullChanges(remote, branch) {
  const safeRemote = assertRef(
    assertOptionalString(remote, 'remote', 200) || 'origin',
    'remote'
  )
  await ensureRepository()

  let safeBranch = assertOptionalString(branch, 'branch', 200)

  if (!safeBranch) {
    const branchResult = await runGit(['branch', '--show-current'])
    safeBranch = branchResult.stdout.trim()

    if (!safeBranch) {
      throw new Error('Cannot determine the current branch.')
    }
  }

  assertRef(safeBranch, 'branch')

  const result = await runGit(
    ['pull', '--ff-only', safeRemote, safeBranch],
    { timeoutMs: 120000 }
  )

  if (result.exitCode !== 0) {
    const detail = (result.stdout + '\n' + result.stderr).trim()

    throw new Error(boundDetail(detail, MAX_ERROR_DETAIL) || 'Git pull failed.')
  }

  log.info(`Pulled ${safeBranch} from ${safeRemote}.`)

  return {
    success: true,
    remote: safeRemote,
    branch: safeBranch,
    summary: result.stdout.trim().slice(0, 500),
  }
}

module.exports = {
  runGit,
  ensureRepository,
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
  cancelGitProcesses,
  killAllActiveProcesses,
}
