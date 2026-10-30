// Update service: strict manifest validation, semver comparison,
// channel matching, checksum verification, staged downloads with
// progress/cancel, and rollback-by-default (failures clear staging
// and never touch the running install). No network: fetch is injected.
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  validateManifest,
  artifactFor,
  isNewer,
  checkForUpdates,
  verifyArtifact,
  downloadArtifact,
  stagedArtifact,
  clearStaged,
} = require('./update.service.cjs')

const PAYLOAD = Buffer.from('fake-installer-bytes')
const DIGEST = crypto.createHash('sha512').update(PAYLOAD).digest('hex')

function manifest(overrides = {}) {
  return {
    version: '1.2.0',
    channel: 'stable',
    releaseNotes: 'Fixes.',
    artifacts: [
      {
        platform: 'win32',
        url: 'https://updates.example.com/KryomCode-1.2.0.exe',
        sha512: DIGEST,
        size: PAYLOAD.length,
      },
    ],
    ...overrides,
  }
}

function feedFetch(payload, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  })
}

describe('update-service', () => {
  it('validates manifests strictly', () => {
    const valid = validateManifest(manifest())

    assert.equal(valid.version, '1.2.0')
    assert.equal(valid.artifacts.length, 1)

    assert.throws(() => validateManifest(null), /an object is required/)
    assert.throws(() => validateManifest(manifest({ version: '1.2' })), /semver/)
    assert.throws(() => validateManifest(manifest({ channel: 'beta' })), /channel/)
    assert.throws(() => validateManifest(manifest({ artifacts: [] })), /1-10 artifacts/)
    assert.throws(
      () => validateManifest(manifest({ artifacts: [{ platform: 'win32', url: 'http://x/y', sha512: DIGEST, size: 1 }] })),
      /must use https/
    )
    assert.throws(
      () => validateManifest(manifest({ artifacts: [{ platform: 'win32', url: 'https://x/y', sha512: 'nope', size: 1 }] })),
      /sha512/
    )
    assert.throws(
      () => validateManifest(manifest({ artifacts: [{ platform: 'win32', url: 'https://x/y', sha512: DIGEST, size: 0 }] })),
      /bad size/
    )
    assert.throws(
      () => validateManifest(manifest({ artifacts: [{ platform: 'msdos', url: 'https://x/y', sha512: DIGEST, size: 1 }] })),
      /bad platform/
    )
  })

  it('compares versions and matches platform artifacts', () => {
    assert.equal(isNewer('1.1.9', '1.2.0'), true)
    assert.equal(isNewer('1.2.0', '1.2.0'), false)
    assert.equal(isNewer('2.0.0', '1.2.0'), false)

    const parsed = validateManifest(manifest())

    assert.equal(artifactFor(parsed, 'win32').platform, 'win32')
    assert.equal(artifactFor(parsed, 'darwin'), null)
  })

  it('reports unconfigured feeds honestly', async () => {
    const result = await checkForUpdates({ feedUrl: '', currentVersion: '0.1.0' })

    assert.equal(result.available, false)
    assert.match(result.reason, /No update feed/)
  })

  it('checks feeds with channel, version, and platform gates', async () => {
    const feedUrl = 'https://updates.example.com/stable.json'

    const newer = await checkForUpdates({
      feedUrl,
      currentVersion: '1.1.0',
      channel: 'stable',
      platform: 'win32',
      fetchImpl: feedFetch(manifest()),
    })

    assert.equal(newer.available, true)
    assert.equal(newer.manifest.version, '1.2.0')

    const current = await checkForUpdates({
      feedUrl,
      currentVersion: '1.2.0',
      channel: 'stable',
      platform: 'win32',
      fetchImpl: feedFetch(manifest()),
    })

    assert.equal(current.available, false)
    assert.match(current.reason, /Already on/)

    const wrongChannel = await checkForUpdates({
      feedUrl,
      currentVersion: '1.1.0',
      channel: 'preview',
      platform: 'win32',
      fetchImpl: feedFetch(manifest()),
    })

    assert.equal(wrongChannel.available, false)
    assert.match(wrongChannel.reason, /tracks "preview"/)

    const noArtifact = await checkForUpdates({
      feedUrl,
      currentVersion: '1.1.0',
      channel: 'stable',
      platform: 'darwin',
      fetchImpl: feedFetch(manifest()),
    })

    assert.equal(noArtifact.available, false)
    assert.match(noArtifact.reason, /no darwin artifact/)

    const badFeed = await checkForUpdates({
      feedUrl,
      currentVersion: '1.1.0',
      channel: 'stable',
      platform: 'win32',
      fetchImpl: feedFetch({ nope: true }),
    })

    assert.equal(badFeed.available, false)
    assert.match(badFeed.reason, /Invalid update manifest/)

    await assert.rejects(
      () => checkForUpdates({ feedUrl: 'http://x/feed.json', currentVersion: '1.1.0' }),
      /must use https/
    )
  })

  it('verifies checksums and rejects mismatches', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-update-'))
    const target = path.join(dir, 'artifact.bin')

    await fs.writeFile(target, PAYLOAD)

    assert.deepEqual(await verifyArtifact(target, DIGEST), { verified: true, sha512: DIGEST })

    await assert.rejects(
      () => verifyArtifact(target, '0'.repeat(128)),
      /Checksum mismatch/
    )
  })

  it('stages verified downloads with progress and clears on failure', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-update-base-'))
    const artifact = validateManifest(manifest()).artifacts[0]
    const progress = []

    async function* body() {
      yield PAYLOAD.subarray(0, 4)
      yield PAYLOAD.subarray(4)
    }

    const downloaded = await downloadArtifact({
      artifact,
      baseDir: base,
      fetchImpl: async () => ({ ok: true, status: 200, body: body() }),
      onProgress: (event) => progress.push(event.received),
    })

    assert.equal(downloaded.verified, true)
    assert.equal(downloaded.bytes, PAYLOAD.length)
    assert.deepEqual(progress, [4, PAYLOAD.length])

    const staged = await stagedArtifact(base)

    assert.equal(staged.path, downloaded.path)

    // Corrupt payload: checksum fails and staging is cleared.
    async function* badBody() {
      yield Buffer.from('tampered-bytes!!')
    }

    await assert.rejects(
      () => downloadArtifact({
        artifact,
        baseDir: base,
        fetchImpl: async () => ({ ok: true, status: 200, body: badBody() }),
      }),
      /Checksum mismatch/
    )

    assert.equal(await stagedArtifact(base), null)

    await clearStaged(base)
  })

  it('cancels downloads and clears staging', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'kryom-update-cancel-'))
    const artifact = validateManifest(manifest()).artifacts[0]
    const controller = new AbortController()

    async function* slowBody() {
      yield PAYLOAD.subarray(0, 4)
      controller.abort()

      await new Promise((resolve) => setTimeout(resolve, 50))

      yield PAYLOAD.subarray(4)
    }

    await assert.rejects(
      () => downloadArtifact({
        artifact,
        baseDir: base,
        fetchImpl: async () => ({ ok: true, status: 200, body: slowBody() }),
        signal: controller.signal,
      }),
      /cancelled/i
    )

    assert.equal(await stagedArtifact(base), null)
  })
})
