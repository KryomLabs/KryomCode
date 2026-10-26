const { spawn } = require('node:child_process')
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

let mainWindow = null
let workspaceRoot = null

const IGNORED = new Set([
'node_modules',
'.git',
'dist',
'.next',
'coverage',
])

function isInsideWorkspace(filePath) {
if (!workspaceRoot) return false

const relative = path.relative(workspaceRoot, filePath)

return (
relative === '' ||
(!path.isAbsolute(relative) &&
relative !== '..' &&
!relative.startsWith("..${path.sep}"))
)
}

async function buildTree(dir, depth = 0, counter = { count: 0 }) {
if (depth > 8 || counter.count >= 2000) return []

const entries = await fs.readdir(dir, { withFileTypes: true })

entries.sort((a, b) => {
if (a.isDirectory() !== b.isDirectory()) {
return a.isDirectory() ? -1 : 1
}

return a.name.localeCompare(b.name)

})

const result = []

for (const entry of entries) {
if (counter.count >= 2000) break
if (IGNORED.has(entry.name)) continue
if (entry.isSymbolicLink()) continue

const fullPath = path.join(dir, entry.name)
counter.count++

if (entry.isDirectory()) {
  result.push({
    name: entry.name,
    path: fullPath,
    type: 'directory',
    children: await buildTree(fullPath, depth + 1, counter),
  })
} else if (entry.isFile()) {
  result.push({
    name: entry.name,
    path: fullPath,
    type: 'file',
  })
}

}

return result
}

async function readWorkspaceFile(filePath) {
if (typeof filePath !== 'string' || !filePath.trim()) {
throw new Error('Invalid file path.')
}

const resolved = path.resolve(filePath)

if (!isInsideWorkspace(resolved) || resolved === workspaceRoot) {
throw new Error('File is outside the selected workspace.')
}

const stat = await fs.lstat(resolved)

if (!stat.isFile() || stat.isSymbolicLink()) {
throw new Error('Only regular files can be opened.')
}

if (stat.size > 1024 * 1024) {
throw new Error('File is larger than 1 MB.')
}

return fs.readFile(resolved, 'utf8')
}

async function saveWorkspaceFile(filePath, content) {
if (typeof filePath !== 'string' || !filePath.trim()) {
throw new Error('Invalid file path.')
}

const resolved = path.resolve(filePath)

if (!isInsideWorkspace(resolved) || resolved === workspaceRoot) {
throw new Error('Invalid workspace file path.')
}

if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
throw new Error('Invalid content or file exceeds 1 MB.')
}

const stat = await fs.lstat(resolved)

if (!stat.isFile() || stat.isSymbolicLink()) {
throw new Error('Only existing regular files can be saved.')
}

await fs.writeFile(resolved, content, 'utf8')

return { success: true }
}

function registerWorkspaceHandlers() {
ipcMain.handle('workspace:open', async (event) => {
if (!mainWindow || event.sender !== mainWindow.webContents) {
throw new Error('Unauthorized workspace request.')
}

const result = await dialog.showOpenDialog(mainWindow, {
  title: 'Open Project Folder',
  properties: ['openDirectory'],
})

if (result.canceled || !result.filePaths[0]) {
  return null
}

workspaceRoot = await fs.realpath(result.filePaths[0])

return {
  root: workspaceRoot,
  tree: await buildTree(workspaceRoot),
}

})

ipcMain.handle('workspace:read-file', async (event, filePath) => {
if (!mainWindow || event.sender !== mainWindow.webContents) {
throw new Error('Unauthorized file request.')
}

return readWorkspaceFile(filePath)

})

ipcMain.handle(
'workspace:save-file',
async (event, filePath, content) => {
if (!mainWindow || event.sender !== mainWindow.webContents) {
throw new Error('Unauthorized file request.')
}

  return saveWorkspaceFile(filePath, content)
},

)
}

function registerTerminalHandler() {
ipcMain.handle('terminal:run', async (event, command) => {
if (!mainWindow || event.sender !== mainWindow.webContents) {
throw new Error('Unauthorized terminal request.')
}

if (!workspaceRoot) {
  throw new Error('Open a project folder first.')
}

if (
  typeof command !== 'string' ||
  !command.trim() ||
  command.length > 2000
) {
  throw new Error('Enter a valid command (maximum 2000 characters).')
}

return new Promise((resolve) => {
  let output = ''
  let timedOut = false
  let outputLimited = false
  let settled = false

  const child = spawn(command, {
    cwd: workspaceRoot,
    shell: true,
    windowsHide: true,
    env: process.env,
  })

  const append = (chunk) => {
    if (output.length >= 100_000) {
      outputLimited = true
      return
    }

    const remaining = 100_000 - output.length
    const text = chunk.toString()

    output += text.slice(0, remaining)

    if (text.length > remaining || output.length >= 100_000) {
      outputLimited = true
    }
  }

  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 120_000)

  child.stdout.on('data', append)
  child.stderr.on('data', append)

  child.on('error', (error) => {
    if (settled) return
    settled = true
    clearTimeout(timer)

    resolve({
      exitCode: 1,
      output: `${output}\n${error.message}`,
      timedOut,
      outputLimited,
    })
  })

  child.on('close', (code) => {
    if (settled) return
    settled = true
    clearTimeout(timer)

    resolve({
      exitCode: code ?? 1,
      output:
        output +
        (timedOut ? '\nCommand timed out after 120 seconds.' : '') +
        (outputLimited ? '\nOutput truncated.' : ''),
      timedOut,
      outputLimited,
    })
  })
})

})
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

mainWindow.loadURL('http://127.0.0.1:5173')
}

app.whenReady().then(() => {
registerWorkspaceHandlers()
registerTerminalHandler()
createWindow()

app.on('activate', () => {
if (BrowserWindow.getAllWindows().length === 0) {
createWindow()
}
})
})

app.on('window-all-closed', () => {
if (process.platform !== 'darwin') {
app.quit()
}
})