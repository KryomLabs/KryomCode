const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  runGit,
  ensureRepository,
} = require('./git.service.cjs')
const {
  resolveWorkspacePath,
} = require('../../security/validate-path.cjs')
const { boundDetail } = require('../../utils/errors.cjs')

const MAX_DIFF_LENGTH = 200_000
const MAX_ERROR_DETAIL = 2000

// Bounded, color-free diffs for review UI. Accepts an optional workspace
// path (validated for containment) and an optional staged flag.

async function getDiff({ staged = false, path: targetPath } = {}) {
  await ensureRepository()

  const args = ['diff', '--no-color', '--no-ext-diff']

  if (staged) {
    args.push('--cached')
  }

  if (targetPath !== undefined && targetPath !== null) {
    const { path: resolved } = await resolveWorkspacePath(targetPath, {
      allowMissing: true,
    })
    const root = getWorkspaceRoot()

    args.push('--', path.relative(root, resolved))
  }

  const result = await runGit(args)

  if (result.exitCode !== 0) {
    throw new Error(boundDetail(result.stderr, MAX_ERROR_DETAIL) || 'Git diff failed.')
  }

  const truncated = result.stdout.length >= MAX_DIFF_LENGTH

  return {
    diff: result.stdout.slice(0, MAX_DIFF_LENGTH),
    truncated,
    staged: Boolean(staged),
  }
}

async function getChangedFiles({ staged = false } = {}) {
  await ensureRepository()

  const args = ['diff', '--name-only']

  if (staged) {
    args.push('--cached')
  }

  const result = await runGit(args)

  if (result.exitCode !== 0) {
    throw new Error(boundDetail(result.stderr, MAX_ERROR_DETAIL) || 'Git diff failed.')
  }

  return {
    files: result.stdout.split('\n').map((line) => line.trim()).filter(Boolean),
    staged: Boolean(staged),
  }
}

module.exports = {
  getDiff,
  getChangedFiles,
}
