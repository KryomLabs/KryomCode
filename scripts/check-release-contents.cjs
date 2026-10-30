// Release-contents gate: verifies the unpacked Windows build produced
// by `npm run pack` (default: release/win-unpacked). Always checks the
// unpacked layout plus the package.json inclusion/exclusion config;
// when the @electron/asar reader (a transitive electron-builder
// dependency) is resolvable it also lists the asar and asserts
// required files and local assets are present while secrets, tests,
// private state, and key material are absent. Usage:
//   npm run pack && node scripts/check-release-contents.cjs [unpacked-dir]
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const unpackedDir = path.resolve(
  ROOT,
  process.argv[2] || path.join('release', 'win-unpacked')
)

let failed = 0

function fail(message) {
  failed += 1
  process.stderr.write(`RELEASE CONTENTS FAIL: ${message}\n`)
}

function checkFile(label, full) {
  if (!fs.existsSync(full)) {
    fail(`missing ${label}: ${path.relative(ROOT, full)}`)
    return false
  }

  return true
}

// 1. Unpacked layout.
if (!fs.existsSync(unpackedDir)) {
  fail(
    `unpacked dir not found: ${unpackedDir}. Run \`npm run pack\` first.`
  )
  process.exit(1)
}

checkFile('executable', path.join(unpackedDir, 'KryomCode.exe'))

const resourcesDir = path.join(unpackedDir, 'resources')
const asarPath = path.join(resourcesDir, 'app.asar')
const hasAsar = checkFile('app archive', asarPath)

// 1b. Staleness guard: the asar must be newer than the inputs that
// produce it. A bare `npm run build` refreshes dist/ but leaves the
// previous pack in place, and the missing-file errors below then
// mislead. Precondition failure exits immediately like above.
if (hasAsar) {
  const asarStat = fs.statSync(asarPath)
  const inputs = [
    path.join(ROOT, 'package.json'),
    path.join(ROOT, 'dist', 'index.html'),
  ]

  for (const input of inputs) {
    let inputStat = null

    try {
      inputStat = fs.statSync(input)
    } catch {
      inputStat = null
    }

    if (inputStat && inputStat.mtimeMs > asarStat.mtimeMs) {
      fail(
        `stale unpacked dir: ${path.relative(ROOT, input)} is newer ` +
          `than the asar. Run \`npm run pack\` first, then re-run this check.`
      )
      process.exit(1)
    }
  }
}

if (!fs.existsSync(path.join(resourcesDir, 'docs'))) {
  fail('missing extraResources docs: resources/docs.')
}

// 2. Inclusion/exclusion config: the file-set guards must survive edits.
const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
)
const patterns = ((pkg.build && pkg.build.files) || []).filter(
  (entry) => typeof entry === 'string'
)

for (const required of ['dist/**', 'electron/**', 'package.json']) {
  if (!patterns.includes(required)) {
    fail(`package.json build.files lost the ${required} inclusion.`)
  }
}

for (const required of ['!**/.env', '!**/.env.*', '!**/*.test.cjs']) {
  if (!patterns.includes(required)) {
    fail(`package.json build.files lost the ${required} exclusion.`)
  }
}

// 2b. Release channel + worker unpacking must survive config edits.
const extraMetadata = (pkg.build && pkg.build.extraMetadata) || {}

if (extraMetadata.main !== 'electron/main.cjs') {
  fail('package.json build.extraMetadata lost the main entry override.')
}

if (extraMetadata.kryomChannel !== 'stable') {
  fail('package.json build.extraMetadata lost the default stable channel.')
}

const unpacked = (pkg.build && pkg.build.asarUnpack) || []

if (!unpacked.includes('electron/services/extensions/worker/extension-worker.cjs')) {
  fail('package.json build.asarUnpack lost the extension worker entry.')
}

if (hasAsar) {
  checkFile(
    'unpacked extension worker',
    path.join(resourcesDir, 'app.asar.unpacked', 'electron', 'services', 'extensions', 'worker', 'extension-worker.cjs')
  )
}

// 3. Deep asar listing when a reader is available.
let listed = null

try {
  listed = require('@electron/asar').listPackage(asarPath)
} catch {
  listed = null
}

if (hasAsar && !listed) {
  process.stdout.write(
    'WARN: @electron/asar not resolvable; skipped deep asar listing.\n'
  )
}

if (Array.isArray(listed)) {
  const names = listed.map((entry) => String(entry).replace(/\\/g, '/'))

  for (const required of [
    'dist/index.html',
    'electron/main.cjs',
    'electron/preload.cjs',
    'electron/services/extensions/runtime.cjs',
    'electron/services/extensions/worker/extension-host.cjs',
    'package.json',
  ]) {
    if (!names.some((name) => name === required || name.endsWith(`/${required}`))) {
      fail(`asar is missing ${required}.`)
    }
  }

  // Local-first assets: the editor must work offline, so the
  // Monaco worker/font chunks and the app bundle must ship inside
  // the asar (hashed names, hence patterns, not literals).
  for (const [label, pattern] of [
    ['Monaco editor worker', /\/dist\/assets\/editor\.worker-[^/]+\.js$/],
    ['app bundle', /\/dist\/assets\/index-[^/]+\.js$/],
    ['app styles', /\/dist\/assets\/[^/]+\.css$/],
    ['Monaco codicon font', /\/dist\/assets\/codicon-[^/]+\.ttf$/],
  ]) {
    if (!names.some((name) => pattern.test(name))) {
      fail(`asar is missing ${label} (dist/assets).`)
    }
  }

  for (const name of names) {
    const base = name.slice(name.lastIndexOf('/') + 1)
    const segments = name.split('/')
    const underNodeModules = segments.includes('node_modules')

    if (base === '.env' || base.startsWith('.env.')) {
      fail(`asar leaks secret file: ${name}.`)
    }

    if (base.endsWith('.test.cjs')) {
      fail(`asar ships test file: ${name}.`)
    }

    if (segments.includes('.kryom')) {
      fail(`asar ships private project state: ${name}.`)
    }

    if (name.startsWith('/dist/') && base.endsWith('.map')) {
      fail(`asar ships sourcemap: ${name}.`)
    }

    if (
      !underNodeModules &&
      (base.endsWith('.pem') ||
        base.endsWith('.key') ||
        base.startsWith('id_rsa'))
    ) {
      fail(`asar ships key material: ${name}.`)
    }
  }

  process.stdout.write(`Listed ${names.length} asar entries.\n`)
}

process.stdout.write(
  failed === 0
    ? `Release contents ok: ${path.relative(ROOT, unpackedDir)}.\n`
    : `Release contents: ${failed} failure(s).\n`
)
process.exit(failed === 0 ? 0 : 1)
