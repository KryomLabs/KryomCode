// Safe update architecture (Level 4B.3). Checks a release feed,
// stages verified downloads, and NEVER touches the running install.
//
// Trust model:
// - Feed URL and artifacts must be https; anything else is rejected.
// - Every artifact needs a sha512 checksum; mismatches delete the
//   staged file and fail loudly.
// - No auto-install, no downloaded-script execution, no renderer-
//   supplied URLs: the feed URL comes from baked package metadata or
//   an operator environment variable, never from UI input.
// - Code signing (Authenticode/notarization) is NOT implemented here:
//   it needs owner certificates (see docs/RELEASING.md). Until then,
//   checksums are the integrity mechanism and releases are manual.
//
// Rollback story: the current installation is never overwritten by
// this service. A failed download, corrupt artifact, or bad manifest
// leaves the staged directory deleted (or quarantined for inspect)
// and the app untouched. "Rollback" is therefore the default state;
// recovery means clearing staged files and reporting status.
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const { compareVersions } = require('../extensions/manifest.cjs')
const { createLogger } = require('../../utils/logger.cjs')

const log = createLogger('update')

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]{1,40})?$/
const SHA512_PATTERN = /^[0-9a-f]{128}$/i
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_ARTIFACT_BYTES = 500 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20000
const STAGING_DIRNAME = 'pending-update'

function defaultBaseDir() {
  const electron = require('electron')
  const app = electron && electron.app

  if (!app || typeof app.getPath !== 'function') {
    throw new Error('Update staging is unavailable outside Electron.')
  }

  return app.getPath('userData')
}

function stagingRoot(baseDir) {
  return path.join(baseDir || defaultBaseDir(), STAGING_DIRNAME)
}

function assertHttpsUrl(value, name) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Invalid update manifest: "${name}" must be a URL.`)
  }

  let parsed = null

  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`Invalid update manifest: "${name}" is not a URL.`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Invalid update manifest: "${name}" must use https.`)
  }

  if (!parsed.hostname) {
    throw new Error(`Invalid update manifest: "${name}" needs a host.`)
  }

  return value
}

// Manifest schema (v1):
// {
//   version: '1.2.3',
//   channel: 'stable' | 'preview',
//   publishedAt: '2026-01-01T00:00:00.000Z' (optional),
//   releaseNotes: '...' (optional, <= 4000 chars),
//   artifacts: [{ platform: 'win32'|'darwin'|'linux',
//                 url: 'https://...', sha512: '<128 hex>', size: <bytes> }]
// }
function validateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid update manifest: an object is required.')
  }

  if (typeof raw.version !== 'string' || !SEMVER_PATTERN.test(raw.version)) {
    throw new Error('Invalid update manifest: "version" must be semver.')
  }

  if (raw.channel !== 'stable' && raw.channel !== 'preview') {
    throw new Error('Invalid update manifest: "channel" must be stable or preview.')
  }

  if (!Array.isArray(raw.artifacts) || raw.artifacts.length === 0 || raw.artifacts.length > 10) {
    throw new Error('Invalid update manifest: provide 1-10 artifacts.')
  }

  const artifacts = raw.artifacts.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid update manifest: artifact ${index} must be an object.`)
    }

    if (!['win32', 'darwin', 'linux'].includes(entry.platform)) {
      throw new Error(`Invalid update manifest: artifact ${index} has a bad platform.`)
    }

    assertHttpsUrl(entry.url, `artifacts[${index}].url`)

    if (typeof entry.sha512 !== 'string' || !SHA512_PATTERN.test(entry.sha512)) {
      throw new Error(`Invalid update manifest: artifact ${index} needs a sha512 checksum.`)
    }

    if (!Number.isInteger(entry.size) || entry.size <= 0 || entry.size > MAX_ARTIFACT_BYTES) {
      throw new Error(`Invalid update manifest: artifact ${index} has a bad size.`)
    }

    return {
      platform: entry.platform,
      url: entry.url,
      sha512: entry.sha512.toLowerCase(),
      size: entry.size,
    }
  })

  return {
    version: raw.version,
    channel: raw.channel,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt.slice(0, 40) : null,
    releaseNotes: typeof raw.releaseNotes === 'string' ? raw.releaseNotes.slice(0, 4000) : '',
    artifacts,
  }
}

function artifactFor(manifest, platform = process.platform) {
  return manifest.artifacts.find((entry) => entry.platform === platform) || null
}

function isNewer(currentVersion, manifestVersion) {
  return compareVersions(manifestVersion, currentVersion) > 0
}

async function readJsonWithCap(fetchImpl, url, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_MANIFEST_BYTES } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  if (typeof timer.unref === 'function') {
    timer.unref()
  }

  try {
    const response = await fetchImpl(url, { signal: controller.signal })

    if (!response || response.ok !== true) {
      throw new Error(`Update feed responded with status ${response ? response.status : 'unknown'}.`)
    }

    const text = await response.text()

    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('Update manifest exceeds the size cap.')
    }

    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

async function checkForUpdates({
  feedUrl,
  currentVersion,
  channel = 'stable',
  platform = process.platform,
  fetchImpl = fetch,
} = {}) {
  if (typeof feedUrl !== 'string' || !feedUrl) {
    return { available: false, manifest: null, reason: 'No update feed is configured.' }
  }

  assertHttpsUrl(feedUrl, 'feedUrl')

  if (typeof currentVersion !== 'string' || !SEMVER_PATTERN.test(currentVersion)) {
    throw new Error('Current version must be semver.')
  }

  let manifest = null

  try {
    manifest = validateManifest(await readJsonWithCap(fetchImpl, feedUrl))
  } catch (error) {
    log.warn(`Update check failed: ${error.message}`)

    return { available: false, manifest: null, reason: error.message }
  }

  if (manifest.channel !== channel) {
    return {
      available: false,
      manifest: null,
      reason: `Feed channel is "${manifest.channel}"; this build tracks "${channel}".`,
    }
  }

  if (!isNewer(currentVersion, manifest.version)) {
    return { available: false, manifest: null, reason: `Already on ${currentVersion} (feed: ${manifest.version}).` }
  }

  const artifact = artifactFor(manifest, platform)

  if (!artifact) {
    return {
      available: false,
      manifest: null,
      reason: `Release ${manifest.version} has no ${platform} artifact.`,
    }
  }

  return { available: true, manifest, reason: `Release ${manifest.version} is available.` }
}

async function verifyArtifact(filePath, sha512) {
  const hash = crypto.createHash('sha512')
  const { createReadStream } = require('node:fs')

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)

    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })

  const digest = hash.digest('hex')

  if (digest.toLowerCase() !== String(sha512).toLowerCase()) {
    throw new Error(`Checksum mismatch for ${path.basename(filePath)}: expected ${sha512}, got ${digest}.`)
  }

  return { verified: true, sha512: digest.toLowerCase() }
}

async function clearStaged(baseDir) {
  await fs.rm(stagingRoot(baseDir), { recursive: true, force: true }).catch(() => undefined)
}

// Downloads one artifact into staging with progress + cancellation.
// Resolves { path, bytes, verified } or throws (clearing staging).
// The running install is never modified.
async function downloadArtifact({
  artifact,
  baseDir,
  fetchImpl = fetch,
  signal = null,
  onProgress = null,
} = {}) {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('An artifact descriptor is required.')
  }

  assertHttpsUrl(artifact.url, 'artifact.url')

  if (typeof artifact.sha512 !== 'string' || !SHA512_PATTERN.test(artifact.sha512)) {
    throw new Error('Artifact needs a sha512 checksum.')
  }

  const root = stagingRoot(baseDir)

  await fs.rm(root, { recursive: true, force: true })
  await fs.mkdir(root, { recursive: true })

  const fileName = path.basename(new URL(artifact.url).pathname) || 'update.bin'

  if (!/^[\w.-]{1,120}$/.test(fileName)) {
    await clearStaged(baseDir)

    throw new Error('Artifact file name is unsafe.')
  }

  const target = path.join(root, fileName)
  const controller = new AbortController()

  const onAbort = () => controller.abort()

  if (signal) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  try {
    const response = await fetchImpl(artifact.url, { signal: controller.signal })

    if (!response || response.ok !== true) {
      throw new Error(`Artifact download failed with status ${response ? response.status : 'unknown'}.`)
    }

    const { createWriteStream } = require('node:fs')
    const writer = createWriteStream(target)
    let received = 0

    try {
      for await (const chunk of response.body) {
        if (controller.signal.aborted) {
          throw new Error('Update download was cancelled.')
        }

        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

        received += buffer.length

        if (received > MAX_ARTIFACT_BYTES) {
          throw new Error('Artifact exceeds the size cap.')
        }

        await new Promise((resolve, reject) => {
          writer.write(buffer, (error) => (error ? reject(error) : resolve()))
        })

        if (typeof onProgress === 'function') {
          onProgress({ received, size: artifact.size || null })
        }
      }
    } finally {
      await new Promise((resolve) => writer.end(resolve))
    }

    const verified = await verifyArtifact(target, artifact.sha512)

    log.info(`Update artifact staged: ${fileName} (${received} bytes, sha512 verified).`)

    return { path: target, bytes: received, verified: verified.verified }
  } catch (error) {
    await clearStaged(baseDir).catch(() => undefined)

    if (controller.signal.aborted && error.name !== 'Error') {
      throw new Error('Update download was cancelled.')
    }

    throw error
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

// Feed URL resolution: operator env wins, then the baked package.json
// field (set via electron-builder extraMetadata for preview/stable
// pipelines), then nothing (updates unavailable — an honest state,
// never an invented URL). Renderer input can never supply this.
function resolveFeedUrl({ env = process.env, pkg = null } = {}) {
  const fromEnv = env && typeof env.KRYOM_UPDATE_FEED === 'string'
    ? env.KRYOM_UPDATE_FEED.trim()
    : ''

  if (fromEnv) {
    return fromEnv
  }

  try {
    const manifest = pkg || require('../../../package.json')
    const baked = manifest && typeof manifest.kryomUpdateFeed === 'string'
      ? manifest.kryomUpdateFeed.trim()
      : ''

    return baked
  } catch {
    return ''
  }
}

async function stagedArtifact(baseDir) {
  const root = stagingRoot(baseDir)
  const entries = await fs.readdir(root).catch(() => [])

  if (entries.length === 0) {
    return null
  }

  const [name] = entries
  const full = path.join(root, name)
  const stat = await fs.stat(full).catch(() => null)

  if (!stat || !stat.isFile()) {
    return null
  }

  return { path: full, bytes: stat.size }
}

module.exports = {
  STAGING_DIRNAME,
  MAX_ARTIFACT_BYTES,
  resolveFeedUrl,
  validateManifest,
  artifactFor,
  isNewer,
  checkForUpdates,
  verifyArtifact,
  downloadArtifact,
  stagedArtifact,
  clearStaged,
}
