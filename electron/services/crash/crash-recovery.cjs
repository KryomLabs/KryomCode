// Crash-recovery decisions for the main process. Pure helpers so the
// recovery policy is unit-testable without Electron: electron/main.cjs
// owns the dialogs, reloads, and relaunch calls.
const { redactText } = require('../../utils/logger.cjs')

const CRASH_WINDOW_MS = 60000
const MAX_CRASHES_IN_WINDOW = 3
const MAX_DETAIL_CHARS = 300

function summarizeCrash(details) {
  if (!details || typeof details !== 'object') {
    return 'unknown cause'
  }

  const reason =
    typeof details.reason === 'string' && details.reason
      ? details.reason
      : 'unknown'
  const exitCode =
    typeof details.exitCode === 'number' ? ` (exit ${details.exitCode})` : ''

  return `${reason}${exitCode}`
}

function pruneCrashes(stamps, now) {
  const cutoff = now - CRASH_WINDOW_MS

  return (Array.isArray(stamps) ? stamps : []).filter(
    (stamp) => typeof stamp === 'number' && stamp > cutoff
  )
}

function shouldOfferReload(stamps, now) {
  return pruneCrashes(stamps, now).length < MAX_CRASHES_IN_WINDOW
}

function describeMainFailure(error) {
  const raw =
    error instanceof Error
      ? error.stack || error.message
      : String(error ?? 'unknown error')

  const firstLine = String(raw).split('\n')[0].trim()
  const bounded = firstLine.slice(0, MAX_DETAIL_CHARS)

  return redactText(bounded) || 'unknown error'
}

module.exports = {
  CRASH_WINDOW_MS,
  MAX_CRASHES_IN_WINDOW,
  summarizeCrash,
  pruneCrashes,
  shouldOfferReload,
  describeMainFailure,
}
