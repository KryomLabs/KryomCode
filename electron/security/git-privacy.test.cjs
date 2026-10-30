// Git privacy audit (Level 3A.2): private `.kryom/` runtime state must
// stay untracked. Fails if `.kryom/` is ever force-added back to the
// index or if the `.gitignore` rule is lost. Skips without git or
// outside a work tree (e.g. running from installed app sources).
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' })
}

function workTreeRoot() {
  try {
    const probed = git(
      ['rev-parse', '--show-toplevel'],
      path.join(__dirname, '..', '..')
    )

    if (probed.status !== 0 || !probed.stdout) {
      return null
    }

    return probed.stdout.trim()
  } catch {
    return null
  }
}

const ROOT = workTreeRoot()

describe('git privacy', { skip: !ROOT }, () => {
  it('tracks no .kryom files', () => {
    const listed = git(['ls-files', '.kryom'], ROOT)

    assert.equal(listed.status, 0)

    const tracked = listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    assert.deepEqual(tracked, [])
  })

  it('keeps the .kryom ignore rule', () => {
    const gitignore = fs.readFileSync(
      path.join(ROOT, '.gitignore'),
      'utf8'
    )

    const rules = gitignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))

    assert.ok(
      rules.some(
        (rule) => rule === '.kryom/' || rule === '.kryom' || rule === '/.kryom/'
      ),
      '.gitignore must ignore .kryom/'
    )

    const check = git(['check-ignore', '-q', '.kryom/chat.json'], ROOT)

    assert.equal(check.status, 0)
  })
})
