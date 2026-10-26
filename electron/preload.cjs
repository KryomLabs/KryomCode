const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kryom', {
  platform: process.platform,
runCommand: (command) =>
  ipcRenderer.invoke('terminal:run', command),

  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  openWorkspace: () => ipcRenderer.invoke('workspace:open'),

  readFile: (filePath) =>
    ipcRenderer.invoke('workspace:read-file', filePath),

  saveFile: (filePath, content) =>
    ipcRenderer.invoke('workspace:save-file', filePath, content),
})