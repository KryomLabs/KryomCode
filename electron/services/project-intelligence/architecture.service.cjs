// Project architecture understanding (Level 3C.1). Builds a useful,
// evidence-backed representation of the open project: languages,
// frameworks, entry points, configuration, modules, services,
// architectural boundaries, and conventions. Every claim cites the
// files it came from; anything not found is reported as unknown,
// never guessed.
const fs = require('node:fs/promises')
const path = require('node:path')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  analyzeDependencies,
} = require('./dependency-analyzer.service.cjs')
const {
  MAX_INDEX_FILES,
  checkIndexFreshness,
  getIndexStatus,
} = require('./code-index.service.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('architecture')

const MAX_LISTED = 50

const CONFIG_MARKERS = [
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'webpack.config.js',
  'rollup.config.js',
  'esbuild.config.js',
  'pyproject.toml',
  'requirements.txt',
  'setup.cfg',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'Gemfile',
  '.eslintrc.json',
  '.eslintrc.js',
  'eslint.config.js',
  '.prettierrc',
  'prettier.config.js',
  'jest.config.js',
  'vitest.config.ts',
  'pytest.ini',
  'tox.ini',
  'Dockerfile',
  'docker-compose.yml',
  'Makefile',
  '.env.example',
]

const ENTRY_CANDIDATES = [
  'src/main.ts',
  'src/main.js',
  'src/index.ts',
  'src/index.js',
  'src/app.ts',
  'src/app.js',
  'src/App.tsx',
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
  'app.ts',
  'app.js',
  'server.ts',
  'server.js',
  'electron/main.cjs',
  'electron/main.js',
]

const SERVICE_PATTERNS = [
  /service/i,
  /controller/i,
  /route/i,
  /handler/i,
  /provider/i,
  /repository/i,
  /store/i,
]

function openRoot() {
  const root = getWorkspaceRoot()

  if (!root) {
    throw new Error('Open a project folder first.')
  }

  return root
}

async function existsFile(root, relativePath) {
  try {
    const stat = await fs.stat(path.join(root, relativePath))

    return stat.isFile()
  } catch {
    return false
  }
}

async function readManifest(root) {
  try {
    const stat = await fs.stat(path.join(root, 'package.json'))

    if (!stat.isFile() || stat.size > 200 * 1024) {
      return null
    }

    return JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

function languageOf(relativePath) {
  const ext = path.extname(relativePath).toLowerCase()

  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return 'typescript'
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript'
    case '.py':
      return 'python'
    case '.rs':
      return 'rust'
    case '.go':
      return 'go'
    case '.java':
    case '.kt':
      return 'jvm'
    case '.rb':
      return 'ruby'
    case '.php':
      return 'php'
    case '.cs':
      return 'csharp'
    case '.cpp':
    case '.cc':
    case '.c':
    case '.h':
    case '.hpp':
      return 'cpp'
    case '.css':
    case '.scss':
    case '.less':
      return 'styles'
    case '.html':
    case '.vue':
    case '.svelte':
      return 'markup'
    case '.json':
    case '.yaml':
    case '.yml':
    case '.toml':
    case '.xml':
      return 'config-data'
    case '.md':
    case '.mdx':
    case '.txt':
      return 'docs'
    default:
      return 'other'
  }
}

function topLevelModule(relativePath) {
  const segments = relativePath.split('/')

  if (segments.length < 2) {
    return '(root)'
  }

  return segments[0]
}

async function analyzeArchitecture() {
  const root = openRoot()
  const status = await getIndexStatus()

  if (!status.indexed) {
    throw new Error('No code index exists yet. Refresh the index first.')
  }

  const { readStorageFile } = require('../../security/storage-path.cjs')
  const stored = await readStorageFile(root, ['.kryom', 'index', 'manifest.json'])

  if (!stored.found || !stored.data) {
    throw new Error('No code index exists yet. Refresh the index first.')
  }

  const manifest = JSON.parse(stored.data)
  const files = Object.keys(manifest.files || {})

  // Freshness gate: files changed or deleted since indexing are
  // excluded from the survey and reported, never silently counted.
  let currentPaths = null
  let stale = []

  if (files.length > 0) {
    const freshness = await checkIndexFreshness(files.slice(0, MAX_INDEX_FILES))

    currentPaths = new Set(
      freshness.entries
        .filter((entry) => entry.status === 'current')
        .map((entry) => entry.path)
    )
    stale = freshness.entries.filter((entry) => entry.status !== 'current')
  }

  const surveyed = files.filter((entry) => {
    const record = manifest.files[entry]

    if (!record || record.binary || record.unreadable) {
      return false
    }

    return currentPaths === null || currentPaths.has(entry)
  })

  const languages = {}
  const modules = {}

  for (const relativePath of surveyed) {
    const language = languageOf(relativePath)

    languages[language] = (languages[language] || 0) + 1

    const module = topLevelModule(relativePath)

    if (!modules[module]) {
      modules[module] = { files: 0, sample: [] }
    }

    modules[module].files += 1

    if (modules[module].sample.length < 5) {
      modules[module].sample.push(relativePath)
    }
  }

  const primaryLanguage = Object.entries(languages)
    .filter(([language]) => language !== 'config-data' && language !== 'docs' && language !== 'other')
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown'

  const deps = await analyzeDependencies(root)
  const manifestJson = await readManifest(root)

  const configs = []

  for (const marker of CONFIG_MARKERS) {
    if (await existsFile(root, marker)) {
      configs.push(marker)
    }
  }

  // Entry points: manifest-declared first, then conventional files
  // that actually exist. Each cites its evidence.
  const entryPoints = []

  if (manifestJson && typeof manifestJson.main === 'string' && manifestJson.main) {
    const main = manifestJson.main.slice(0, 300)

    entryPoints.push({
      path: main,
      evidence: 'package.json "main" field',
      exists: await existsFile(root, main),
    })
  }

  for (const candidate of ENTRY_CANDIDATES) {
    if (await existsFile(root, candidate)) {
      entryPoints.push({
        path: candidate,
        evidence: 'Conventional entry-point filename, verified on disk',
        exists: true,
      })
    }
  }

  // Services: files whose names match service-like patterns.
  const services = surveyed
    .filter((entry) => {
      const base = entry.split('/').pop() || ''

      return SERVICE_PATTERNS.some((pattern) => pattern.test(base))
    })
    .slice(0, MAX_LISTED)

  // Boundaries: layers we can prove from the tree (Electron main vs
  // renderer, sources vs tests vs tooling), plus enforced exclusions.
  const boundaries = []
  const hasDir = (name) => surveyed.some((entry) => entry === name || entry.startsWith(`${name}/`))

  if (hasDir('electron') && hasDir('src')) {
    boundaries.push({
      name: 'main-process / renderer',
      evidence: 'electron/ and src/ top-level directories both present',
      detail: 'Desktop main process code lives under electron/; UI code under src/.',
    })
  }

  const testFiles = surveyed.filter((entry) => /(\.test\.|\.spec\.|__tests__)/.test(entry))

  if (testFiles.length > 0) {
    const colocated = testFiles.filter((entry) => !entry.startsWith('test/') && !entry.startsWith('tests/')).length

    boundaries.push({
      name: 'sources / tests',
      evidence: `${testFiles.length} test file(s) found`,
      detail: colocated > testFiles.length / 2
        ? 'Tests are colocated with sources.'
        : 'Tests live in dedicated directories.',
    })
  }

  boundaries.push({
    name: 'project / dependencies',
    evidence: 'node_modules/, .git/, dist/, build/ excluded from analysis',
    detail: 'Third-party and generated code is never indexed or sent to providers.',
  })

  boundaries.push({
    name: 'project / KryomCode state',
    evidence: '.kryom/ excluded from analysis',
    detail: 'Assistant state (plans, checkpoints, index) stays out of indexed source.',
  })

  // Conventions: only claims with on-disk evidence.
  const conventions = []

  if ((languages.typescript || 0) > 0 && (languages.javascript || 0) === 0) {
    conventions.push({
      name: 'TypeScript-only sources',
      evidence: `${languages.typescript} TypeScript file(s), 0 JavaScript file(s)`,
    })
  } else if ((languages.typescript || 0) > 0 && (languages.javascript || 0) > 0) {
    conventions.push({
      name: 'Mixed TypeScript and JavaScript',
      evidence: `${languages.typescript} TS file(s), ${languages.javascript} JS file(s)`,
    })
  }

  if (manifestJson && manifestJson.type === 'module') {
    conventions.push({
      name: 'ECMAScript modules',
      evidence: 'package.json "type": "module"',
    })
  }

  if (testFiles.length > 0) {
    conventions.push({
      name: testFiles.some((entry) => entry.endsWith('.test.cjs'))
        ? 'Node test runner (.test.cjs)'
        : 'Dedicated test files',
      evidence: `${testFiles.length} test file(s), e.g. ${testFiles.slice(0, 3).join(', ')}`,
    })
  }

  if (configs.some((entry) => entry.includes('eslint'))) {
    conventions.push({ name: 'ESLint configured', evidence: 'ESLint config file present' })
  }

  const moduleList = Object.entries(modules)
    .map(([name, info]) => ({ name, files: info.files, sample: info.sample }))
    .sort((a, b) => b.files - a.files)

  log.info(
    `Architecture analyzed: ${surveyed.length} file(s), ` +
      `primary language ${primaryLanguage}.`
  )

  return {
    refreshedAt: manifest.refreshedAt,
    indexTruncated: manifest.counts.truncated === true,
    totalIndexed: files.length,
    surveyed: surveyed.length,
    staleFiles: stale.length,
    stale: stale.slice(0, MAX_LISTED),
    primaryLanguage,
    languages,
    frameworks: deps.frameworks,
    package: {
      name: deps.name,
      version: deps.version,
      description: deps.description,
      scripts: deps.scripts,
    },
    entryPoints: entryPoints.slice(0, MAX_LISTED),
    configs,
    modules: moduleList,
    services,
    boundaries,
    conventions,
  }
}

module.exports = {
  analyzeArchitecture,
}
