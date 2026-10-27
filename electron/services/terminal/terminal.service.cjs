const { spawn } = require('node:child_process')

const {
  getWorkspaceRoot,
} = require('../workspace/workspace.service.cjs')
const {
  registerProcess,
  unregisterProcess,
  listProcesses,
  killAllProcesses,
} = require('./process-manager.cjs')
const { classifyCommand } = require('./command-validator.cjs')
const { isSecretKey } = require('../settings/secrets.service.cjs')

const MAX_COMMAND_LENGTH = 2000
const MAX_OUTPUT_LENGTH = 100_000
const TIMEOUT_MS = 120_000

// Provider secrets must never reach the shell. Terminal output can be
// copied or screenshared, so child processes get a scrubbed environment.
function buildChildEnv() {
  const env = { ...process.env }

  for (const key of Object.keys(env)) {
    if (isSecretKey(key)) {
      delete env[key]
    }
  }

  return env
}

function validateCommand(command) {
  if (
    typeof command !== 'string' ||
    !command.trim() ||
    command.length > MAX_COMMAND_LENGTH
  ) {
    throw new Error(
      'Enter a valid command (maximum 2000 characters).'
    )
  }
}

async function runCommand(command, options = {}) {
  const workspaceRoot = getWorkspaceRoot()

  if (!workspaceRoot) {
    throw new Error('Open a project folder first.')
  }

  validateCommand(command)

  const warnings = classifyCommand(command)
  const { signal } = options ?? {}

  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    let outputLimited = false
    let settled = false

    const child = spawn(command, {
      cwd: workspaceRoot,
      shell: true,
      windowsHide: true,
      env: buildChildEnv(),
    })

    const processId = registerProcess(child, { command })

    const append = (chunk) => {
      const text = chunk.toString()
      const remaining = MAX_OUTPUT_LENGTH - output.length

      if (remaining <= 0) {
        outputLimited = true
        return
      }

      output += text.slice(0, remaining)

      if (text.length > remaining) {
        outputLimited = true
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, TIMEOUT_MS)

    const onAbort = () => {
      child.kill()
    }

    if (signal) {
      if (signal.aborted) {
        child.kill()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    const cleanup = () => {
      clearTimeout(timer)
      unregisterProcess(processId)

      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }

    child.stdout.on('data', append)
    child.stderr.on('data', append)

    child.on('error', (error) => {
      if (settled) return

      settled = true
      cleanup()

      resolve({
        exitCode: 1,
        output: `${output}\n${error.message}`,
        timedOut,
        outputLimited,
        warnings,
      })
    })

    child.on('close', (code) => {
      if (settled) return

      settled = true
      cleanup()

      resolve({
        exitCode: code ?? 1,
        output:
          output +
          (timedOut
            ? '\nCommand timed out after 120 seconds.'
            : '') +
          (outputLimited ? '\nOutput truncated.' : ''),
        timedOut,
        outputLimited,
        warnings,
      })
    })
  })
}

function listRunningProcesses() {
  return listProcesses()
}

function cancelRunningProcesses() {
  return killAllProcesses()
}

function killAllActiveProcesses() {
  killAllProcesses()
}

module.exports = {
  runCommand,
  buildChildEnv,
  listRunningProcesses,
  cancelRunningProcesses,
  killAllActiveProcesses,
}
