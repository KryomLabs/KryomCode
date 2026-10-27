// Backend syntax gate: byte-compiles every Electron main-process file
// with `node --check` without executing it. Safe to run anywhere Node
// is installed; Electron itself is not required.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', 'electron')

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      collect(full, out)
    } else if (entry.isFile() && full.endsWith('.cjs')) {
      out.push(full)
    }
  }

  return out
}

const files = collect(ROOT).sort()
let failed = 0

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    failed += 1
    process.stderr.write(`SYNTAX FAIL: ${path.relative(ROOT, file)}\n`)
    process.stderr.write(`${error.stderr || error.message}\n`)
  }
}

process.stdout.write(
  `Checked ${files.length} backend file(s): ${files.length - failed} ok, ${failed} failed.\n`
)

process.exit(failed === 0 ? 0 : 1)
