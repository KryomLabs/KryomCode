contextBridge.exposeInMainWorld("kryomcode", {
  version: "0.1.0",

  selectProject: () =>
    ipcRenderer.invoke("project:select"),

  readDirectory: (directoryPath) =>
    ipcRenderer.invoke(
      "project:read-directory",
      directoryPath,
    ),

  readFile: (filePath) =>
    ipcRenderer.invoke(
      "project:read-file",
      filePath,
    ),
});