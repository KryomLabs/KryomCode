const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const dotenv = require('dotenv')

dotenv.config({
  path: path.join(__dirname, '..', '.env'),
})

const registerHandlers = require('./ipc/register-handlers.cjs')
const {
  createTrustedSender,
} = require('./security/trusted-sender.cjs')
const { createLogger } = require('./utils/logger.cjs')

const log = createLogger('main')

let mainWindow = null

const isTrustedSender = createTrustedSender(() => mainWindow)

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
  mainWindow = new BrowserWindow({
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

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (
      !url.startsWith('http://127.0.0.1:5173') &&
      !url.startsWith('file:')
    ) {
      event.preventDefault()
    }
  })

  loadApp(mainWindow).catch((error) => {
    log.error(`Failed to load the application: ${error.message}`)
  })
}

app.whenReady().then(() => {
  registerHandlers({
    getMainWindow: () => mainWindow,
    isTrustedSender,
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
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
