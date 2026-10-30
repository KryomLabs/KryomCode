const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
  isInsideScope,
} = require('../workspace/workspace.service.cjs')
const {
  analyzeDependencies,
} = require('./dependency-analyzer.service.cjs')

const IGNORED = new Set([
  'node_modules',
  '.git',
  '.kryom',
  'dist',
  '.next',
  'coverage',
  'out',
  'build',
  '__pycache__',
  '.venv',
  'target',
])

const MAX_INDEX_FILES = 500
const MAX_DEPTH = 6
const MAX_CONTEXT_CHARS = 12000
const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'webpack.config.js',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  '.env.example',
]

function isSkipped(name) {
  return (
    IGNORED.has(name) ||
    name.startsWith('.env') ||
    name === '.DS_Store'
  )
}

async function collectIndex(directory, root, depth, index, counts) {
  if (depth > MAX_DEPTH || index.length >= MAX_INDEX_FILES) {
    return
  }

  let entries = []

  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (index.length >= MAX_INDEX_FILES) {
      counts.truncated = true
      break
    }

    if (isSkipped(entry.name) || entry.isSymbolicLink()) {
      counts.skipped += 1
      continue
    }

    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      // Junctions look like directories: descend only when the
      // canonical path stays inside the indexed tree.
      let real = null

      try {
        real = await fs.realpath(fullPath)
      } catch {
        counts.skipped += 1
        continue
      }

      if (!isInsideScope(root, real)) {
        counts.skipped += 1
        continue
      }

      counts.directories += 1
      await collectIndex(fullPath, root, depth + 1, index, counts)
    } else if (entry.isFile()) {
      let size = 0

      try {
        size = (await fs.stat(fullPath)).size
      } catch {
        continue
      }

      counts.files += 1
      index.push({
        relativePath: path.relative(root, fullPath),
        size,
      })
    }
  }
}

async function detectProjectType(root, manifest) {
  if (manifest.hasManifest) {
    return 'node'
  }

  const markers = [
    ['pyproject.toml', 'python'],
    ['requirements.txt', 'python'],
    ['Cargo.toml', 'rust'],
    ['go.mod', 'go'],
    ['pom.xml', 'jvm'],
    ['build.gradle', 'jvm'],
    ['composer.json', 'php'],
  ]

  for (const [file, type] of markers) {
    try {
      const stat = await fs.stat(path.join(root, file))

      if (stat.isFile()) {
        return type
      }
    } catch {
      // Missing marker; keep looking.
    }
  }

  return 'unknown'
}

async function findConfigs(root) {
  const present = []

  for (const file of CONFIG_FILES) {
    try {
      const stat = await fs.stat(path.join(root, file))

      if (stat.isFile()) {
        present.push(file)
      }
    } catch {
      // Missing config; keep looking.
    }
  }

  return present
}

async function getWorkspaceSummary() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  const manifest = await analyzeDependencies(root)
  const index = []
  const counts = { files: 0, directories: 0, skipped: 0, truncated: false }

  await collectIndex(root, root, 0, index, counts)

  return {
    root,
    projectType: await detectProjectType(root, manifest),
    frameworks: manifest.frameworks,
    scripts: manifest.scripts,
    description: manifest.description,
    configs: await findConfigs(root),
    fileIndex: index,
    counts,
  }
}

// Compact, bounded text for AI requests: project facts plus a file
// listing. File contents are never dumped here; the chat layer attaches
// only the explicitly selected file.
async function buildWorkspaceContext({ maxChars = MAX_CONTEXT_CHARS } = {}) {
  const summary = await getWorkspaceSummary()
  const lines = [
    `Project type: ${summary.projectType}`,
  ]

  if (summary.frameworks.length > 0) {
    lines.push(`Frameworks: ${summary.frameworks.join(', ')}`)
  }

  if (summary.description) {
    lines.push(`Description: ${summary.description}`)
  }

  const scriptNames = Object.keys(summary.scripts)

  if (scriptNames.length > 0) {
    lines.push(`Scripts: ${scriptNames.join(', ')}`)
  }

  if (summary.configs.length > 0) {
    lines.push(`Configs: ${summary.configs.join(', ')}`)
  }

  lines.push(
    `Files: ${summary.counts.files} files, ${summary.counts.directories} folders` +
      (summary.counts.truncated ? ' (index truncated)' : '')
  )
  lines.push('File index:')

  for (const entry of summary.fileIndex) {
    lines.push(`- ${entry.relativePath}`)
  }

  const text = lines.join('\n')
  const limit = Math.min(Math.max(1000, maxChars), MAX_CONTEXT_CHARS)

  return {
    context: text.slice(0, limit),
    truncated: text.length > limit,
    projectType: summary.projectType,
  }
}

module.exports = {
  getWorkspaceSummary,
  buildWorkspaceContext,
}
