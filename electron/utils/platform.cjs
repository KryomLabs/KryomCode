// Platform adapter (Level 4B.2). Centralizes every platform branch:
// OS detection, executable resolution, and spawn defaults. Callers
// pass overrides in tests; production code never reads
// process.platform outside this module (except the one documented
// macOS quit branch in main.cjs).
const { spawnSync } = require('node:child_process')

function currentPlatform(overrides = {}) {
  return overrides.platform || process.platform
}

function isWindows(overrides = {}) {
  return currentPlatform(overrides) === 'win32'
}

function isMacOS(overrides = {}) {
  return currentPlatform(overrides) === 'darwin'
}

function isLinux(overrides = {}) {
  return currentPlatform(overrides) === 'linux'
}

// POSIX children spawn detached (their own process group) so
// cancellation and timeouts can terminate the whole tree with one
// group signal. Windows keeps taskkill-based tree termination and
// must NOT detach (different semantics, no group kill).
function shouldDetach(overrides = {}) {
  return !isWindows(overrides)
}

function spawnDefaults(overrides = {}) {
  if (isWindows(overrides)) {
    return { windowsHide: true }
  }

  return { detached: true }
}

// Resolves an executable name to an absolute path without a shell:
// `where` on Windows, `which` everywhere else. Returns null when
// missing or when the lookup itself fails. Argument arrays only —
// the name is never interpolated into a command string.
function resolveExecutable(name, overrides = {}) {
  if (typeof name !== 'string' || !name || /[/\\]/.test(name)) {
    return null
  }

  const runner = overrides.spawnSync || spawnSync
  const probe = isWindows(overrides) ? 'where' : 'which'

  try {
    const result = runner(probe, [name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    })

    if (!result || result.status !== 0 || typeof result.stdout !== 'string') {
      return null
    }

    const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)

    return first || null
  } catch {
    return null
  }
}

function describePlatform(overrides = {}) {
  const platform = currentPlatform(overrides)

  return {
    platform,
    windows: platform === 'win32',
    macos: platform === 'darwin',
    linux: platform === 'linux',
    treeKill: platform === 'win32' ? 'taskkill' : 'process-group',
    executableProbe: platform === 'win32' ? 'where' : 'which',
  }
}

module.exports = {
  currentPlatform,
  isWindows,
  isMacOS,
  isLinux,
  shouldDetach,
  spawnDefaults,
  resolveExecutable,
  describePlatform,
}
