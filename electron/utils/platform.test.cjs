// Platform adapter: OS branches, detach policy, shell-free
// executable resolution, and spawn defaults.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  currentPlatform,
  isWindows,
  isMacOS,
  isLinux,
  shouldDetach,
  spawnDefaults,
  resolveExecutable,
  describePlatform,
} = require('./platform.cjs')

describe('platform-adapter', () => {
  it('detects each OS through overrides', () => {
    assert.equal(currentPlatform({ platform: 'win32' }), 'win32')
    assert.equal(isWindows({ platform: 'win32' }), true)
    assert.equal(isMacOS({ platform: 'darwin' }), true)
    assert.equal(isLinux({ platform: 'linux' }), true)
    assert.equal(isWindows({ platform: 'darwin' }), false)
    assert.equal(currentPlatform({}), process.platform)
  })

  it('detaches POSIX children but never Windows ones', () => {
    assert.equal(shouldDetach({ platform: 'win32' }), false)
    assert.equal(shouldDetach({ platform: 'darwin' }), true)
    assert.equal(shouldDetach({ platform: 'linux' }), true)
  })

  it('returns per-OS spawn defaults', () => {
    assert.deepEqual(spawnDefaults({ platform: 'win32' }), { windowsHide: true })
    assert.deepEqual(spawnDefaults({ platform: 'linux' }), { detached: true })
  })

  it('resolves executables without a shell', () => {
    const calls = []
    const resolved = resolveExecutable('git', {
      platform: 'linux',
      spawnSync: (cmd, args, options) => {
        calls.push([cmd, args, options])

        return { status: 0, stdout: '/usr/bin/git\n' }
      },
    })

    assert.equal(resolved, '/usr/bin/git')
    assert.deepEqual(calls[0][0], 'which')
    assert.deepEqual(calls[0][1], ['git'])

    const winResolved = resolveExecutable('git', {
      platform: 'win32',
      spawnSync: (cmd) => {
        assert.equal(cmd, 'where')

        return { status: 0, stdout: 'C:\\Git\\bin\\git.exe\r\n' }
      },
    })

    assert.equal(winResolved, 'C:\\Git\\bin\\git.exe')
  })

  it('returns null for missing executables, bad names, and failures', () => {
    assert.equal(resolveExecutable('../evil', { platform: 'linux' }), null)
    assert.equal(resolveExecutable('', { platform: 'linux' }), null)
    assert.equal(
      resolveExecutable('nope', {
        platform: 'linux',
        spawnSync: () => ({ status: 1, stdout: '' }),
      }),
      null
    )
    assert.equal(
      resolveExecutable('nope', {
        platform: 'linux',
        spawnSync: () => {
          throw new Error('spawn failed')
        },
      }),
      null
    )
  })

  it('describes the platform deterministically', () => {
    assert.deepEqual(describePlatform({ platform: 'win32' }), {
      platform: 'win32',
      windows: true,
      macos: false,
      linux: false,
      treeKill: 'taskkill',
      executableProbe: 'where',
    })
    assert.deepEqual(describePlatform({ platform: 'darwin' }).treeKill, 'process-group')
  })
})
