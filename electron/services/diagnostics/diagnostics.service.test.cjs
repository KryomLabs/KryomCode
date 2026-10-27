const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const {
  setWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const { parseOutput } = require('./problem-parser.cjs')
const { runDiagnostics } = require('./diagnostics.service.cjs')

describe('problem-parser', () => {
  it('parses TypeScript errors', () => {
    const { diagnostics } = parseOutput(
      'src/app.ts(12,4): error TS2322: Type mismatch.\nsrc/x.ts(1,1): warning TS1234: Hint.'
    )

    assert.equal(diagnostics.length, 2)
    assert.equal(diagnostics[0].file, 'src/app.ts')
    assert.equal(diagnostics[0].line, 12)
    assert.equal(diagnostics[0].column, 4)
    assert.equal(diagnostics[0].severity, 'error')
    assert.equal(diagnostics[0].code, 'TS2322')
    assert.equal(diagnostics[1].severity, 'warning')
  })

  it('parses generic file:line:col diagnostics', () => {
    const { diagnostics } = parseOutput('src/app.js:3:15: error: Unexpected token')

    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].line, 3)
    assert.equal(diagnostics[0].column, 15)
  })

  it('parses node stack frames and skips internals', () => {
    const { diagnostics } = parseOutput(
      'Error: boom\n    at run (C:\\proj\\app.js:10:5)\n    at node:internal/main:1:1'
    )

    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].file, 'C:\\proj\\app.js')
    assert.equal(diagnostics[0].code, 'STACK')
  })

  it('returns empty for clean output', () => {
    const { diagnostics, truncated } = parseOutput('All good.\nDone in 1s.')

    assert.deepEqual(diagnostics, [])
    assert.equal(truncated, false)
  })
})

describe('diagnostics.service', () => {
  it('reports success only on exit code zero', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-diag-'))
    await setWorkspaceRoot(dir)

    const ok = await runDiagnostics('node --version')

    assert.equal(ok.success, true)
    assert.equal(ok.exitCode, 0)

    const bad = await runDiagnostics('node -e "process.exit(3)"')

    assert.equal(bad.success, false)
    assert.equal(bad.exitCode, 3)
  })

  it('captures diagnostics from failing output', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-diag-'))
    await setWorkspaceRoot(dir)

    const result = await runDiagnostics(
      'node -e "console.error(\'src/a.ts(2,3): error TS9999: Fake.\'); process.exit(2)"'
    )

    assert.equal(result.success, false)
    assert.equal(result.diagnostics.length, 1)
    assert.equal(result.diagnostics[0].code, 'TS9999')
  })
})
