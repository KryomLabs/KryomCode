const {
  runCommand,
} = require('../terminal/terminal.service.cjs')
const { parseOutput } = require('./problem-parser.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('diagnostics')

// Runs one approved build/test command through the standard terminal
// service (workspace containment, timeouts, secret scrubbing) and parses
// the output into structured diagnostics. success is true only when the
// command exited 0 without timing out: failures are never reported green.

async function runDiagnostics(command, { signal } = {}) {
  const result = await runCommand(command, { signal })
  const { diagnostics, truncated } = parseOutput(result.output)
  const success = result.exitCode === 0 && !result.timedOut

  log.info(
    `Diagnostics ran with exit code ${result.exitCode}; ` +
      `${diagnostics.length} problem(s) found.`
  )

  return {
    success,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    outputLimited: result.outputLimited,
    warnings: result.warnings || [],
    output: result.output,
    diagnostics,
    diagnosticsTruncated: truncated,
  }
}

module.exports = {
  runDiagnostics,
}
