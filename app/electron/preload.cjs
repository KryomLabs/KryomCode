const { contextBridge, ipcRenderer } = require("electron");

console.log("KryomCode preload loaded");

contextBridge.exposeInMainWorld("kryomcode", {
  version: "0.1.0",

  selectProject: () => {
    return ipcRenderer.invoke("project:select");
  },

  readDirectory: (directoryPath) => {
    return ipcRenderer.invoke(
      "project:read-directory",
      directoryPath,
    );
  },

  readFile: (filePath) => {
    return ipcRenderer.invoke(
      "project:read-file",
      filePath,
    );
  },
});