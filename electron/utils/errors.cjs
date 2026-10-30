// Consistent main-process error shapes. Messages stay human-readable
// because only the message crosses the IPC boundary to the renderer;
// codes let main-process callers and tests branch precisely.

const CODES = {
  WORKSPACE_CLOSED: 'E_WORKSPACE_CLOSED',
  PATH_TRAVERSAL: 'E_PATH_TRAVERSAL',
  NOT_FOUND: 'E_NOT_FOUND',
  ALREADY_EXISTS: 'E_ALREADY_EXISTS',
  WRITE_CONFLICT: 'E_WRITE_CONFLICT',
  VALIDATION: 'E_VALIDATION',
  TIMEOUT: 'E_TIMEOUT',
  PROCESS: 'E_PROCESS',
  GIT: 'E_GIT',
  AI_CONFIG: 'E_AI_CONFIG',
  AI_REQUEST: 'E_AI_REQUEST',
  AGENT: 'E_AGENT',
  SETTINGS: 'E_SETTINGS',
}

function createError(code, message) {
  const error = new Error(message)
  error.code = code

  return error
}

function validationError(message) {
  return createError(CODES.VALIDATION, message)
}

function isCodedError(error) {
  return Boolean(
    error &&
      error instanceof Error &&
      typeof error.code === 'string'
  )
}

// External text (tool stderr/stdout, HTTP error bodies) is untrusted:
// coerce to a trimmed string capped at max characters so it cannot
// flood the UI. Non-strings become '' so callers fall back to static
// wording. See docs/ERROR_TAXONOMY.md.
function boundDetail(text, max) {
  if (typeof text !== 'string') {
    return ''
  }

  return text.trim().slice(0, max)
}

module.exports = {
  CODES,
  createError,
  validationError,
  isCodedError,
  boundDetail,
}
