// Test-manifest gate: every colocated backend test must be listed in
// the `test` script in package.json. The suite names files
// explicitly, so a new *.test.cjs is silently skipped until it is
// added there. Fails on missing entries and on stale entries that no
// longer exist on disk.
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      collect(full, out)
    } else if (entry.isFile() && full.endsWith('.test.cjs')) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/'))
    }
  }

  return out
}

const found = collect(path.join(ROOT, 'electron')).sort()
const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
)
const script = (pkg.scripts && pkg.scripts.test) || ''
const listed = script
  .split(/\s+/)
  .filter((token) => token.endsWith('.test.cjs'))
  .sort()

const missing = found.filter((file) => !listed.includes(file))
const stale = listed.filter((file) => !found.includes(file))

for (const file of missing) {
  process.stderr.write(
    `TEST MANIFEST FAIL: ${file} exists but is not in the package.json test script.\n`
  )
}

for (const file of stale) {
  process.stderr.write(
    `TEST MANIFEST FAIL: ${file} is listed in the test script but does not exist.\n`
  )
}

process.stdout.write(
  `Test manifest: ${found.length} test file(s) on disk, ${listed.length} listed.\n`
)
process.exit(missing.length + stale.length === 0 ? 0 : 1)
