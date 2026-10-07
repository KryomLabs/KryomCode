const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("fs/promises");
const path = require("path");

const isDev = !app.isPackaged;

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,

    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    window.loadURL("http://localhost:5173");
  } else {
    window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

/**
 * Open a project directory.
 */
ipcMain.handle("project:select", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

/**
 * Read directory contents.
 */
ipcMain.handle(
  "project:read-directory",
  async (_event, directoryPath) => {
    const entries = await fs.readdir(directoryPath, {
      withFileTypes: true,
    });

    return entries
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        path: path.join(directoryPath, entry.name),
      }))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1;
        }

        return a.name.localeCompare(b.name);
      });
  },
);

/**
 * Read a text file.
 */
ipcMain.handle(
  "project:read-file",
  async (_event, filePath) => {
    return fs.readFile(filePath, "utf-8");
  },
);

/**
 * Start Electron application.
 */
app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const window = new BrowserWindow({
  width: 1440,
  height: 900,
  minWidth: 1100,
  minHeight: 700,

  webPreferences: {
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});

      createWindow();
    }
  });
});

/**
 * Quit application when all windows are closed.
 */
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});