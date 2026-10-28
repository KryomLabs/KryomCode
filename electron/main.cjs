const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
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
  ctx: { hasWorkspace: false, hasEditor: false },
}

const isTrustedSender = createTrustedSender(() => [...windows])

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
      await window.loadURL('http://127.0.0.1:5173')
      return
    } catch {
      log.warn('Dev server unavailable, falling back to built files.')
    }
  }

  await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
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

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  window.webContents.on('will-navigate', (event, url) => {
    if (
      !url.startsWith('http://127.0.0.1:5173') &&
      !url.startsWith('file:')
    ) {
      event.preventDefault()
    }
  })

  loadApp(window).catch((error) => {
    log.error(`Failed to load the application: ${error.message}`)
  })

  return window
}

app.whenReady().then(() => {
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
