const { app, BrowserWindow, Menu, dialog, shell, protocol } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const dotenv = require('dotenv')

dotenv.config({
  path: path.join(__dirname, '..', '.env'),
})

const registerHandlers = require('./ipc/register-handlers.cjs')
const {
  createTrustedSender,
} = require('./security/trusted-sender.cjs')
const {
  APP_ENTRY_URL,
  APP_SCHEME,
  DEV_ORIGIN,
  isAllowedMainFrameUrl,
} = require('./security/renderer-urls.cjs')
const {
  buildProductionCsp,
} = require('./security/content-security-policy.cjs')
const {
  createAppProtocolHandler,
} = require('./security/protocol-handler.cjs')

// Private renderer scheme. Registered before ready (an Electron
// requirement): standard + secure so the packaged UI gets a stable
// kryom://app origin for CSP 'self', secure-context APIs such as the
// async clipboard, and frame checks — without any file: access.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true } },
])

const { createLogger } = require('./utils/logger.cjs')
const { buildMenuTemplate } = require('./menu.cjs')
const {
  readUIState,
  clearRecent,
} = require('./services/ui/ui-state.service.cjs')

const log = createLogger('main')

const windows = new Set()

// Menu inputs, refreshed from ui-state storage, renderer context pushes,
// and window focus. Unknown context keeps workspace/editor commands
// disabled rather than firing blindly.
const menuState = {
  recent: [],
  autoSave: false,
  ctx: { hasWorkspace: false, hasEditor: false, dirtyCount: 0 },
}

// Pending save-all settlement for the close guard. The renderer echoes
// the nonce it was asked to save with; the waiter resolves once the
// matching push arrives or the deadline passes.
let saveAllNonce = 0
let pendingSaveAll = null

function settleSaveAll(mayClose) {
  if (!pendingSaveAll) {
    return
  }

  const pending = pendingSaveAll
  pendingSaveAll = null
  clearTimeout(pending.timer)
  pending.resolve(mayClose)
}

// Expected main-frame URL shared by navigation guards and IPC
// sender checks: the exact dev origin in development, only the
// packaged entry document in production.
function isTrustedAppUrl(url) {
  return isAllowedMainFrameUrl(url, {
    packaged: app.isPackaged,
    devOrigin: DEV_ORIGIN,
  })
}

const isTrustedSender = createTrustedSender(() => [...windows], {
  isTrustedAppUrl,
})

function getWindows() {
  return [...windows].filter((window) => !window.isDestroyed())
}

function getMainWindow() {
  return BrowserWindow.getFocusedWindow() || getWindows()[0] || null
}

function broadcastUI() {
  const payload = {
    autoSave: menuState.autoSave,
    recent: [...menuState.recent],
  }

  for (const window of getWindows()) {
    window.webContents.send('kryom:ui', payload)
  }
}

function docsDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'docs')
  }

  return path.join(__dirname, '..', 'docs')
}

function openAbout(parent) {
  dialog
    .showMessageBox(parent || getMainWindow(), {
      type: 'info',
      title: 'About KryomCode',
      message: 'KryomCode',
      detail:
        `Version ${app.getVersion()}\n` +
        'AI-assisted desktop coding workspace.\n\n' +
        `Electron ${process.versions.electron}\n` +
        `Chrome ${process.versions.chrome}\n` +
        `Node ${process.versions.node}\n` +
        `Platform ${process.platform}`,
      buttons: ['OK'],
      noLink: true,
    })
    .catch((error) => {
      log.error(`About dialog failed: ${error.message}`)
    })
}

function openDocs() {
  const dir = docsDir()

  if (!fs.existsSync(dir)) {
    const parent = getMainWindow()

    dialog
      .showMessageBox(parent, {
        type: 'warning',
        title: 'Documentation',
        message: 'Documentation folder is not available.',
        detail:
          'The bundled docs folder was not found next to this install.',
        buttons: ['OK'],
      })
      .catch(() => undefined)

    return
  }

  shell.openPath(dir).catch((error) => {
    log.error(`Failed to open documentation: ${error.message}`)
  })
}

function rebuildMenu() {
  try {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildMenuTemplate({
          recent: menuState.recent,
          autoSave: menuState.autoSave,
          ctx: menuState.ctx,
          actions: {
            newWindow: () => createWindow(),
            openAbout: (parent) => openAbout(parent),
            openDocs: () => openDocs(),
            clearRecent: () => {
              clearRecent()
                .then((state) => {
                  menuState.recent = state.recent
                  rebuildMenu()
                  broadcastUI()
                })
                .catch((error) => {
                  log.error(`Clear recent failed: ${error.message}`)
                })
            },
          },
        })
      )
    )
  } catch (error) {
    log.error(`Menu rebuild failed: ${error.message}`)
  }
}

async function refreshMenuUIState() {
  try {
    const state = await readUIState()

    menuState.recent = state.recent
    menuState.autoSave = state.autoSave
    rebuildMenu()
  } catch (error) {
    log.error(`UI state refresh failed: ${error.message}`)
  }
}

async function loadApp(window) {
  if (!app.isPackaged) {
    try {
      await window.loadURL(DEV_ORIGIN)
      return
    } catch {
      log.warn('Dev server unavailable, falling back to built files.')
    }
  }

  await window.loadURL(APP_ENTRY_URL)
}

async function resolveDirtyClose(window) {
  const dirtyCount = menuState.ctx.dirtyCount ?? 0

  const choice = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Unsaved changes',
    message:
      dirtyCount === 1
        ? '1 file has unsaved changes.'
        : `${dirtyCount} files have unsaved changes.`,
    detail:
      'Save them before closing? Chat and agent sessions are not saved.',
    buttons: ['Save', 'Discard changes', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })

  if (choice.response === 2) {
    return false
  }

  if (choice.response === 1) {
    return true
  }

  if (window.isDestroyed()) {
    return false
  }

  saveAllNonce += 1
  const nonce = saveAllNonce

  window.webContents.send('kryom:command', {
    id: 'file.saveAll',
    payload: { nonce },
  })

  return new Promise((resolve) => {
    pendingSaveAll = {
      nonce,
      resolve,
      timer: setTimeout(() => {
        pendingSaveAll = null
        resolve(false)
      }, 120000),
    }
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'KryomCode',
    backgroundColor: '#101114',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  windows.add(window)

  window.on('closed', () => {
    windows.delete(window)
  })

  // Close guard: dirty editor buffers get a native Save/Discard/Cancel
  // prompt. Save delegates to the renderer (which owns conflict
  // dialogs) and the window is destroyed only after the renderer
  // reports a clean state. destroy() intentionally bypasses
  // beforeunload so Discard never double-prompts; reload paths keep
  // the renderer's generic beforeunload prompt instead.
  let closeRunning = false

  window.on('close', (event) => {
    const dirtyCount = menuState.ctx.dirtyCount ?? 0

    if (dirtyCount <= 0) {
      return
    }

    event.preventDefault()

    if (closeRunning) {
      return
    }

    closeRunning = true

    void resolveDirtyClose(window)
      .then((mayClose) => {
        closeRunning = false

        if (mayClose && !window.isDestroyed()) {
          window.destroy()
        }
      })
      .catch((error) => {
        closeRunning = false
        log.error(`Close guard failed: ${error.message}`)
      })
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Parsed-URL navigation policy: the exact dev origin in
  // development, only the packaged entry document in production. No
  // file: URLs, no userinfo or sibling-host tricks, no subframes.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url)) {
      event.preventDefault()
    }
  })

  window.webContents.on(
    'will-frame-navigate',
    (event, url, _httpCode, _httpText, isMainFrame) => {
      if (isMainFrame !== true || !isTrustedAppUrl(url)) {
        event.preventDefault()
      }
    }
  )

  loadApp(window).catch((error) => {
    log.error(`Failed to load the application: ${error.message}`)
  })

  return window
}

app.whenReady().then(() => {
  protocol.handle(
    APP_SCHEME,
    createAppProtocolHandler({
      distDir: path.join(__dirname, '..', 'dist'),
      contentSecurityPolicy: buildProductionCsp(),
    })
  )

  registerHandlers({
    getMainWindow,
    getWindows,
    isTrustedSender,
    // Called after ui-state changes so menus, recent lists, and windows
    // stay in sync. The caller passes the fresh state it just wrote.
    onUIStateChanged: (state) => {
      if (state && typeof state === 'object') {
        if (typeof state.autoSave === 'boolean') {
          menuState.autoSave = state.autoSave
        }

        if (Array.isArray(state.recent)) {
          menuState.recent = state.recent
        }
      }

      rebuildMenu()
      broadcastUI()
    },
    onUIContext: (ctx) => {
      menuState.ctx = {
        hasWorkspace: ctx.hasWorkspace === true,
        hasEditor: ctx.hasEditor === true,
        terminalRunning: ctx.terminalRunning === true,
        dirtyCount:
          typeof ctx.dirtyCount === 'number' && ctx.dirtyCount >= 0
            ? Math.floor(ctx.dirtyCount)
            : 0,
      }

      if (
        pendingSaveAll &&
        typeof ctx.saveAllNonce === 'number' &&
        ctx.saveAllNonce === pendingSaveAll.nonce
      ) {
        settleSaveAll(menuState.ctx.dirtyCount === 0)
      } else if (pendingSaveAll && menuState.ctx.dirtyCount === 0) {
        // Belt and braces: any clean push settles a pending save-all.
        settleSaveAll(true)
      }

      const target = getMainWindow()

      if (target && !target.isDestroyed()) {
        target.setTitle(
          typeof ctx.title === 'string' && ctx.title
            ? ctx.title
            : 'KryomCode'
        )
      }

      rebuildMenu()
    },
    onWorkspaceOpened: () => {
      void refreshMenuUIState()
    },
  })

  void refreshMenuUIState()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // Recent projects and auto-save can change from another window, so
  // the menu re-reads storage whenever a window gains focus.
  app.on('browser-window-focus', () => {
    void refreshMenuUIState()
  })
})

app.on('before-quit', () => {
  try {
    require('./services/terminal/terminal.service.cjs').killAllActiveProcesses()
    require('./services/git/git.service.cjs').killAllActiveProcesses()
  } catch (error) {
    log.error(`Shutdown cleanup failed: ${error.message}`)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
