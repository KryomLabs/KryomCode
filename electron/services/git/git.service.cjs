const { spawn } = require('node:child_process')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  buildChildEnv,
} = require('../terminal/terminal.service.cjs')
const {
  assertNonEmptyString,
  assertStringArray,
  assertOptionalString,
} = require('../../security/validate-input.cjs')
const {
  resolveWorkspacePath,
} = require('../../security/validate-path.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('git')
const TIMEOUT_MS = 30000
const MAX_OUTPUT_LENGTH = 200_000
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/

const activeChildren = new Set()

function killAllActiveProcesses() {
  for (const child of activeChildren) {
    try {
      child.kill()
    } catch {
      // Already exited.
    }
  }

  activeChildren.clear()
}

function runGit(args, { timeoutMs = TIMEOUT_MS } = {}) {
  const workspaceRoot = getWorkspaceRoot()

  if (!workspaceRoot) {
    throw new Error('Open a project folder first.')
  }

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    let child = null

    const childEnv = buildChildEnv()
    delete childEnv.GIT_DIR
    delete childEnv.GIT_WORK_TREE
    delete childEnv.GIT_PREFIX
    delete childEnv.GIT_INDEX_FILE

    try {
      child = spawn('git', args, {
        cwd: workspaceRoot,
        shell: false,
        windowsHide: true,
        env: childEnv,
      })
    } catch (error) {
      reject(error)
      return
    }

    activeChildren.add(child)

    let outputLimited = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      activeChildren.delete(child)
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
      statusResult.stderr.trim() || 'Git status failed.'
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
    throw new Error(result.stderr.trim() || 'Git stage failed.')
  }

  log.info(`Staged ${relative.length} path(s).`)

  return { success: true, staged: relative.length }
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

    throw new Error(detail || 'Git commit failed.')
  }

  log.info('Created a commit.')

  return { success: true }
}

function assertRef(value, name) {
  assertNonEmptyString(value, name, 200)

  if (!REF_PATTERN.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${name}: unsafe characters rejected.`)
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
    throw new Error(detail.slice(0, 2000) || 'Git push failed.')
  }

  log.info(`Pushed ${safeBranch} to ${safeRemote}.`)

  return { success: true, remote: safeRemote, branch: safeBranch }
}

module.exports = {
  runGit,
  ensureRepository,
  getStatus,
  stageFiles,
  commitChanges,
  pushChanges,
  killAllActiveProcesses,
}
