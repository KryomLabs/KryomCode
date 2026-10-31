// Release environment detection. KryomCode runs in exactly one of:
// development (source checkout + vite), preview (packaged test build),
// production (packaged release). Detection is deterministic and
// dependency-free so scripts, main, and tests share one source.
//
// Rules:
// - app.isPackaged === false  -> development, always.
// - packaged + KRYOM_CHANNEL=preview (baked at build time) -> preview.
// - packaged otherwise -> production.
// - KRYOM_CHANNEL is only honored when packaged, so a dev checkout can
//   never impersonate production (and vice versa).
const CHANNELS = ['stable', 'preview']

const ENVIRONMENTS = ['development', 'preview', 'production']

function sanitizeChannel(value) {
  return value === 'preview' ? 'preview' : 'stable'
}

function detectEnvironment({ packaged = false, channel = null } = {}) {
  if (packaged !== true) {
    return 'development'
  }

  return sanitizeChannel(channel) === 'preview' ? 'preview' : 'production'
}

function describeEnvironment(env) {
  if (env === 'development') {
    return {
      environment: env,
      channel: 'stable',
      devServer: true,
      verboseErrors: true,
      allowDevtools: true,
    }
  }

  if (env === 'preview') {
    return {
      environment: env,
      channel: 'preview',
      devServer: false,
      verboseErrors: true,
      allowDevtools: true,
    }
  }

  return {
    environment: env,
    channel: 'stable',
    devServer: false,
    verboseErrors: false,
    allowDevtools: false,
  }
}

// Baked channel: electron-builder extraMetadata merges kryomChannel
// to the packaged package.json top level (stable by default,
// preview via dist:preview). Absent in source checkouts by design.
function readBakedChannel(pkg = null) {
  try {
    const manifest = pkg || require('../../../package.json')
    const baked = manifest && typeof manifest.kryomChannel === 'string'
      ? manifest.kryomChannel.trim().toLowerCase()
      : ''

    return baked === 'preview' ? 'preview' : null
  } catch {
    return null
  }
}

// Reads the live process state. `app` is the Electron app module (or a
// stub with isPackaged/getVersion in tests); env defaults to process.env.
function currentEnvironment({ app = null, env = process.env, pkg = null } = {}) {
  const packaged = Boolean(app && app.isPackaged === true)
  const fromEnv = env && typeof env.KRYOM_CHANNEL === 'string'
    ? env.KRYOM_CHANNEL.trim().toLowerCase()
    : null
  const channel = fromEnv || (packaged ? readBakedChannel(pkg) : null)
  const environment = detectEnvironment({ packaged, channel })

  return {
    ...describeEnvironment(environment),
    packaged,
    version:
      app && typeof app.getVersion === 'function' ? app.getVersion() : '0.0.0-unknown',
  }
}

module.exports = {
  CHANNELS,
  ENVIRONMENTS,
  detectEnvironment,
  describeEnvironment,
  currentEnvironment,
  readBakedChannel,
}
