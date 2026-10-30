// Structured diagnosis tests (Level 3B.3): failure classification
// over fixture runner output (provenance 'fixture'), bounds,
// redaction, location honesty, and persistence validation. No
// processes are spawned here; executed runs are covered in
// diagnostics.service.test.cjs.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  FAILURE_CATEGORIES,
  MAX_FINDINGS,
  diagnoseRun,
  sanitizeDiagnosis,
} = require('./diagnosis.cjs')

function run(overrides = {}) {
  return {
    command: 'npm test',
    exitCode: 1,
    timedOut: false,
    cancelled: false,
    output: '',
    diagnostics: [],
    durationMs: 1200,
    provenance: 'fixture',
    planId: null,
    stepId: null,
    ...overrides,
  }
}

function firstCategory(output, extras = {}) {
  const diagnosis = diagnoseRun(run({ output, ...extras }))

  assert.ok(diagnosis.findings.length > 0)

  return diagnosis
}

describe('diagnosis', () => {
  it('exposes the nine failure categories', () => {
    assert.deepEqual(FAILURE_CATEGORIES, [
      'assertion_failure',
      'compilation_error',
      'type_error',
      'missing_dependency',
      'configuration_error',
      'runtime_error',
      'timeout',
      'cancelled',
      'unknown',
    ])
  })

  it('passes clean runs with no findings, warnings included', () => {
    const diagnosis = diagnoseRun(
      run({
        exitCode: 0,
        output: 'ok 1 - first\nok 2 - second\n',
        diagnostics: [
          {
            file: 'src/a.ts',
            line: 3,
            column: 1,
            severity: 'warning',
            code: null,
            message: 'unused',
            source: 'generic',
          },
        ],
      })
    )

    assert.equal(diagnosis.status, 'passed')
    assert.deepEqual(diagnosis.findings, [])
    assert.equal(diagnosis.runner, 'node-test')
    assert.equal(diagnosis.provenance, 'fixture')
    assert.match(diagnosis.runId, /^dg-[0-9a-z]+-[0-9a-f]+$/)
  })

  it('classifies cancellation and timeout from flags, not output', () => {
    const cancelled = diagnoseRun(run({ cancelled: true, exitCode: 1 }))

    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.findings[0].category, 'cancelled')
    assert.equal(cancelled.findings[0].confidence, 'high')

    const timedOut = diagnoseRun(
      run({ timedOut: true, exitCode: 1, durationMs: 120000 })
    )

    assert.equal(timedOut.status, 'timeout')
    assert.equal(timedOut.findings[0].category, 'timeout')
    assert.match(timedOut.summary, /120 second/)
  })

  it('never claims a pass for cancelled or timed-out runs', () => {
    for (const flags of [
      { cancelled: true, exitCode: 0 },
      { timedOut: true, exitCode: 0 },
    ]) {
      const diagnosis = diagnoseRun(run({ ...flags, output: 'all green\n' }))

      assert.notEqual(diagnosis.status, 'passed')
      assert.ok(diagnosis.findings.length > 0)
    }
  })

  it('classifies node:test TAP failures with the test name', () => {
    const diagnosis = firstCategory(
      'TAP version 13\nnot ok 1 - adds two numbers\n' +
        '  AssertionError: expected 3 to equal 4\n'
    )
    const finding = diagnosis.findings[0]

    assert.equal(diagnosis.status, 'failed')
    assert.equal(diagnosis.runner, 'node-test')
    assert.equal(finding.category, 'assertion_failure')
    assert.equal(finding.confidence, 'high')
    assert.equal(finding.test, 'adds two numbers')
    assert.match(finding.evidence, /not ok 1/)
  })

  it('classifies the node:test spec reporter with the test name', () => {
    const diagnosis = firstCategory(
      '✖ adds (2.27ms)\nℹ tests 1\nℹ pass 0\nℹ fail 1\n\n✖ failing tests:\n'
    )
    const finding = diagnosis.findings[0]

    assert.equal(diagnosis.runner, 'node-test')
    assert.equal(finding.category, 'assertion_failure')
    assert.equal(finding.confidence, 'medium')
    assert.equal(finding.test, 'adds')
  })

  it('classifies pytest failures with file and test', () => {
    const diagnosis = firstCategory(
      'FAILED tests/test_math.py::test_add - assert 3 == 4\n' +
        'E       assert 3 == 4\n'
    )
    const finding = diagnosis.findings[0]

    assert.equal(diagnosis.runner, 'pytest')
    assert.equal(finding.category, 'assertion_failure')
    assert.equal(finding.test, 'tests/test_math.py::test_add')
    assert.equal(finding.file, 'tests/test_math.py')
  })

  it('classifies jest failures from bullet and expectation lines', () => {
    const diagnosis = firstCategory(
      '● Suite › adds numbers\n' +
        '  Expected: 4\n' +
        '  Received: 3\n'
    )
    const finding = diagnosis.findings[0]

    assert.equal(finding.category, 'assertion_failure')
    assert.equal(finding.confidence, 'medium')
    assert.equal(finding.test, 'Suite › adds numbers')
  })

  it('classifies missing dependencies before cascading failures', () => {
    const diagnosis = firstCategory(
      "Error: Cannot find module 'left-pad'\n" +
        '    at Object.<anonymous> (app.js:1:15)\n' +
        'not ok 1 - boots\n'
    )

    assert.equal(diagnosis.findings[0].category, 'missing_dependency')
    assert.equal(diagnosis.findings[0].confidence, 'high')
    assert.ok(
      diagnosis.findings.some(
        (entry) => entry.category === 'assertion_failure'
      )
    )
  })

  it('classifies python missing modules', () => {
    const diagnosis = firstCategory(
      "ModuleNotFoundError: No module named 'requests'\n"
    )

    assert.equal(diagnosis.findings[0].category, 'missing_dependency')
  })

  it('splits TypeScript syntax errors from type errors', () => {
    const diagnosis = diagnoseRun(
      run({
        command: 'npx tsc --noEmit',
        output: 'src/a.ts(1,5): error TS1005: x\nsrc/b.ts(2,3): error TS2322: y\n',
        diagnostics: [
          {
            file: 'src/a.ts',
            line: 1,
            column: 5,
            severity: 'error',
            code: 'TS1005',
            message: "';' expected.",
            source: 'tsc',
          },
          {
            file: 'src/b.ts',
            line: 2,
            column: 3,
            severity: 'error',
            code: 'TS2322',
            message: 'Type mismatch.',
            source: 'tsc',
          },
        ],
      })
    )

    assert.equal(diagnosis.runner, 'tsc')
    assert.equal(diagnosis.findings[0].category, 'compilation_error')
    assert.equal(diagnosis.findings[0].file, 'src/a.ts')
    assert.equal(diagnosis.findings[1].category, 'type_error')
    assert.equal(diagnosis.findings[1].file, 'src/b.ts')
  })

  it('classifies bare SyntaxError output as a compilation error', () => {
    const diagnosis = firstCategory('app.js:1\nSyntaxError: Unexpected token\n')

    assert.equal(diagnosis.findings[0].category, 'compilation_error')
  })

  it('classifies runtime errors only with stack evidence', () => {
    const withStack = firstCategory(
      'TypeError: Cannot read properties of null\n' +
        '    at main (app.js:10:5)\n',
      {
        diagnostics: [
          {
            file: 'app.js',
            line: 10,
            column: 5,
            severity: 'error',
            code: 'STACK',
            message: 'at main (app.js:10:5)',
            source: 'stack',
          },
        ],
      }
    )

    assert.equal(withStack.findings[0].category, 'runtime_error')
    assert.equal(withStack.findings[0].file, 'app.js')
    assert.equal(withStack.findings[0].line, 10)

    // The same words without a stack stay unknown: symptoms are not
    // promoted without supporting evidence.
    const withoutStack = firstCategory('note: a TypeError was discussed\n')

    assert.equal(withoutStack.findings[0].category, 'unknown')
    assert.equal(withoutStack.findings[0].confidence, 'low')
  })

  it('classifies commands that failed to start', () => {
    const diagnosis = firstCategory(
      "'nope-test' is not recognized as an internal or external command\n"
    )

    assert.equal(diagnosis.findings[0].category, 'configuration_error')
    assert.equal(diagnosis.findings[0].file, null)
  })

  it('quotes unclassified error diagnostics as unknown, never promoted', () => {
    const diagnosis = diagnoseRun(
      run({
        command: 'npx eslint src/',
        exitCode: 1,
        output: 'src/a.ts:1:1: error: no-var\n',
        diagnostics: [
          {
            file: 'src/a.ts',
            line: 1,
            column: 1,
            severity: 'error',
            code: null,
            message: 'no-var',
            source: 'generic',
          },
        ],
      })
    )

    assert.equal(diagnosis.runner, 'eslint')
    assert.equal(diagnosis.findings[0].category, 'unknown')
    assert.equal(diagnosis.findings[0].confidence, 'medium')
    assert.equal(diagnosis.findings[0].file, 'src/a.ts')
  })

  it('handles unknown frameworks gracefully', () => {
    const diagnosis = firstCategory('blorp runner v9: kaboom (code 7)\n', {
      command: 'blorp --run',
      exitCode: 7,
    })

    assert.equal(diagnosis.runner, 'unknown')
    assert.equal(diagnosis.findings[0].category, 'unknown')
    assert.equal(diagnosis.findings[0].confidence, 'low')
  })

  it('carries missing source files exactly as observed', () => {
    const diagnosis = diagnoseRun(
      run({
        output: 'ghost/missing.ts(4,2): error TS2322: nope\n',
        diagnostics: [
          {
            file: 'ghost/missing.ts',
            line: 4,
            column: 2,
            severity: 'error',
            code: 'TS2322',
            message: 'nope',
            source: 'tsc',
          },
        ],
      })
    )

    // Quoted from the runner verbatim; the classifier never checks
    // the disk, so it can neither confirm nor deny the file exists.
    assert.equal(diagnosis.findings[0].file, 'ghost/missing.ts')
    assert.equal(diagnosis.findings[0].line, 4)
  })

  it('nulls invalid locations instead of inventing them', () => {
    const diagnosis = diagnoseRun(
      run({
        output: 'not ok 1 - x\n',
        diagnostics: [
          {
            file: '',
            line: -3,
            column: 1.5,
            severity: 'error',
            code: null,
            message: 'bogus',
            source: 'generic',
          },
        ],
      })
    )
    const finding = diagnosis.findings.find(
      (entry) => entry.category === 'assertion_failure'
    )

    assert.equal(finding.file, null)
    assert.equal(finding.line, null)
    assert.equal(finding.column, null)
  })

  it('bounds evidence and findings on huge output', () => {
    const bigLine = `x${'y'.repeat(5000)}`
    const output = `${'not ok 1 - big\n'}${bigLine}\n`.repeat(6000)
    const diagnosis = diagnoseRun(run({ output, durationMs: 5 }))

    assert.ok(diagnosis.findings.length <= MAX_FINDINGS)

    for (const finding of diagnosis.findings) {
      assert.ok(finding.summary.length <= 300)
      assert.ok(finding.evidence.length <= 1500)
    }

    assert.ok(diagnosis.summary.length <= 300)
  })

  it('redacts secrets from summaries and evidence', () => {
    const diagnosis = firstCategory(
      'not ok 1 - auth with Bearer abcdefghijklmnop\n'
    )
    const finding = diagnosis.findings[0]

    assert.ok(!finding.evidence.includes('abcdefghijklmnop'))
    assert.ok(!finding.summary.includes('abcdefghijklmnop'))
    assert.ok(finding.evidence.includes('[redacted]'))
  })

  it('rejects malformed classifier input', () => {
    assert.throws(() => diagnoseRun(null), /Invalid diagnosis input/)
    assert.throws(() => diagnoseRun(run({ command: '' })), /command/)
    assert.throws(() => diagnoseRun(run({ exitCode: '1' })), /exit code/)
    assert.throws(() => diagnoseRun(run({ output: null })), /output/)
    assert.throws(() => diagnoseRun(run({ diagnostics: {} })), /diagnostics/)
    assert.throws(() => diagnoseRun(run({ durationMs: -1 })), /duration/)
    assert.throws(() => diagnoseRun(run({ provenance: 'live' })), /provenance/)
    assert.throws(() => diagnoseRun(run({ planId: 42 })), /plan id/)
  })

  it('round-trips valid diagnoses through the sanitizer', () => {
    const built = diagnoseRun(
      run({
        output: 'not ok 1 - adds\n',
        planId: 'pl-abc',
        stepId: 'verify',
      })
    )
    const clean = sanitizeDiagnosis(JSON.parse(JSON.stringify(built)))

    assert.deepEqual(clean, built)
  })

  it('rejects corrupt persisted diagnoses', () => {
    const built = diagnoseRun(run({ output: 'not ok 1 - adds\n' }))
    const tamper = (mutate) => {
      const copy = JSON.parse(JSON.stringify(built))
      mutate(copy)

      return copy
    }

    assert.throws(
      () => sanitizeDiagnosis(tamper((copy) => { copy.runId = 'nope' })),
      /run id/
    )
    assert.throws(
      () =>
        sanitizeDiagnosis(
          tamper((copy) => { copy.findings[0].category = 'gremlins' })
        ),
      /category/
    )
    assert.throws(
      () =>
        sanitizeDiagnosis(
          tamper((copy) => { copy.findings[0].id = 'dg-other-f0' })
        ),
      /finding id/
    )
    assert.throws(
      () =>
        sanitizeDiagnosis(
          tamper((copy) => { copy.findings[0].line = -2 })
        ),
      /location/
    )
    assert.throws(
      () =>
        sanitizeDiagnosis(tamper((copy) => { copy.findings = [] })),
      /at least one finding/
    )
    assert.throws(
      () => sanitizeDiagnosis(tamper((copy) => { copy.status = 'passed' })),
      /no findings/
    )
    assert.throws(
      () => sanitizeDiagnosis('diagnosis'),
      /Invalid diagnosis report/
    )
  })
})
