// Main-process approval enforcement for renderer-driven destructive
// operations (prior-audit P1, critical slice). The renderer classifies
// and confirms first for UX; THIS gate is the enforcement point a
// compromised renderer cannot skip: a destructive command always faces
// a native OS dialog here before execution. Benign commands never take
// the dialog path, so automation, tests, and ordinary runs behave
// exactly as before.
//
// Known wart: destructive interactive commands currently prompt twice
// (renderer dialog, then this native one). The renderer prompt stays
// because it also serves confirm-all mode and scan-failure states;
// consolidating the two prompts is follow-up work, not a reason to
// leave execution ungated.
const {
  classifyCommand,
} = require('../services/terminal/command-validator.cjs')

function resolveDialog() {
  const electron = require('electron')
  const native = electron && electron.dialog

  if (!native || typeof native.showMessageBox !== 'function') {
    throw new Error(
      'This destructive command needs a user confirmation that is unavailable here.'
    )
  }

  return native
}

function validParent(parent) {
  if (
    parent &&
    typeof parent.isDestroyed === 'function' &&
    !parent.isDestroyed()
  ) {
    return parent
  }

  return null
}

// Explicit parent wins; otherwise the focused window, else the first
// live window — mirroring main.cjs getMainWindow without threading it
// through every caller. Null (unparented app-modal dialog) when no
// window exists, e.g. in tests that stub Electron.
function resolveParent(explicit) {
  const owned = validParent(explicit)

  if (owned) {
    return owned
  }

  try {
    const electron = require('electron')
    const windows = electron && electron.BrowserWindow

    if (!windows) {
      return null
    }

    const focused =
      typeof windows.getFocusedWindow === 'function'
        ? windows.getFocusedWindow()
        : null

    if (validParent(focused)) {
      return focused
    }

    const all =
      typeof windows.getAllWindows === 'function'
        ? windows.getAllWindows()
        : []

    return Array.isArray(all) ? (all.find((entry) => validParent(entry)) || null) : null
  } catch {
    return null
  }
}

// Throws when the user declines (message matches the renderer's
// cancelled classification) or when no confirmation surface exists.
// Resolves with the advisory warnings otherwise.
async function confirmDestructiveCommand(
  command,
  { parent = null, source = 'terminal' } = {}
) {
  const warnings = classifyCommand(command)

  if (warnings.length === 0) {
    return { approved: true, warnings }
  }

  const native = resolveDialog()
  const shown = command.length > 300 ? `${command.slice(0, 300)}…` : command
  const owner = resolveParent(parent)
  const options = {
    type: 'warning',
    title: 'Run destructive command?',
    message: 'This command looks destructive. Run it anyway?',
    detail:
      `Source: ${source}\n\n"${shown}"\n\n${warnings.join(' ')}`,
    buttons: ['Run command', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }

  const choice = owner
    ? await native.showMessageBox(owner, options)
    : await native.showMessageBox(options)

  if (!choice || choice.response !== 0) {
    throw new Error('Command cancelled by user.')
  }

  return { approved: true, warnings }
}

module.exports = {
  confirmDestructiveCommand,
}
