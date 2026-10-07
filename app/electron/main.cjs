const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
} = require("electron");

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;

let terminalProcess = null;
let terminalProjectPath = null;

/**
 * Create the main application window.
 */
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
    window.loadFile(
      path.join(__dirname, "../dist/index.html"),
    );
  }
}

/**
 * =========================================================
 * Project IPC
 * =========================================================
 */

/**
 * Open a project directory.
 */
ipcMain.handle(
  "project:select",
  async () => {
    const result =
      await dialog.showOpenDialog({
        properties: ["openDirectory"],
      });

    if (
      result.canceled ||
      result.filePaths.length === 0
    ) {
      return null;
    }

    return result.filePaths[0];
  },
);

/**
 * Read directory contents.
 */
ipcMain.handle(
  "project:read-directory",
  async (
    _event,
    directoryPath,
  ) => {
    const entries =
      await fs.readdir(
        directoryPath,
        {
          withFileTypes: true,
        },
      );

    return entries
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory()
          ? "directory"
          : "file",
        path: path.join(
          directoryPath,
          entry.name,
        ),
      }))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory"
            ? -1
            : 1;
        }

        return a.name.localeCompare(
          b.name,
        );
      });
  },
);

/**
 * Read a text file.
 */
ipcMain.handle(
  "project:read-file",
  async (
    _event,
    filePath,
  ) => {
    return fs.readFile(
      filePath,
      "utf-8",
    );
  },
);

/**
 * Write a text file.
 */
ipcMain.handle(
  "project:write-file",
  async (
    _event,
    filePath,
    content,
  ) => {
    await fs.writeFile(
      filePath,
      content,
      "utf-8",
    );

    return {
      success: true,
    };
  },
);

/**
 * Create a new file.
 */
ipcMain.handle(
  "project:create-file",
  async (
    _event,
    filePath,
  ) => {
    await fs.writeFile(
      filePath,
      "",
      {
        encoding: "utf-8",
        flag: "wx",
      },
    );

    return {
      success: true,
      path: filePath,
    };
  },
);

/**
 * Create a new directory.
 */
ipcMain.handle(
  "project:create-folder",
  async (
    _event,
    directoryPath,
  ) => {
    await fs.mkdir(
      directoryPath,
      {
        recursive: false,
      },
    );

    return {
      success: true,
      path: directoryPath,
    };
  },
);

/**
 * Rename a file or directory.
 */
ipcMain.handle(
  "project:rename",
  async (
    _event,
    oldPath,
    newPath,
  ) => {
    await fs.rename(
      oldPath,
      newPath,
    );

    return {
      success: true,
      oldPath,
      newPath,
    };
  },
);

/**
 * Delete a file or directory.
 */
ipcMain.handle(
  "project:delete",
  async (
    _event,
    targetPath,
    targetType,
  ) => {
    if (
      targetType === "directory"
    ) {
      await fs.rm(
        targetPath,
        {
          recursive: true,
          force: false,
        },
      );
    } else {
      await fs.unlink(
        targetPath,
      );
    }

    return {
      success: true,
      path: targetPath,
    };
  },
);

/**
 * =========================================================
 * Terminal IPC
 * =========================================================
 */

/**
 * Start a persistent PowerShell terminal.
 */
ipcMain.handle(
  "terminal:start",
  async (
    event,
    projectPath,
  ) => {
    if (!projectPath) {
      throw new Error(
        "No project is open.",
      );
    }

    if (terminalProcess) {
      return {
        success: true,
        alreadyRunning: true,
      };
    }

    const senderWindow =
      BrowserWindow.fromWebContents(
        event.sender,
      );

    if (!senderWindow) {
      throw new Error(
        "Terminal window is unavailable.",
      );
    }

    terminalProjectPath =
      projectPath;

    terminalProcess = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "-",
      ],
      {
        cwd: projectPath,
        windowsHide: true,
        stdio: [
          "pipe",
          "pipe",
          "pipe",
        ],
      },
    );

    /**
     * Standard output.
     */
    terminalProcess.stdout.on(
      "data",
      (data) => {
        if (
          !senderWindow.isDestroyed()
        ) {
          senderWindow.webContents.send(
            "terminal:output",
            data.toString(),
          );
        }
      },
    );

    /**
     * Standard error.
     */
    terminalProcess.stderr.on(
      "data",
      (data) => {
        if (
          !senderWindow.isDestroyed()
        ) {
          senderWindow.webContents.send(
            "terminal:error",
            data.toString(),
          );
        }
      },
    );

    /**
     * Process closed.
     */
    terminalProcess.on(
      "close",
      (code) => {
        if (
          !senderWindow.isDestroyed()
        ) {
          senderWindow.webContents.send(
            "terminal:exit",
            code,
          );
        }

        terminalProcess = null;
        terminalProjectPath = null;
      },
    );

    /**
     * Process error.
     */
    terminalProcess.on(
      "error",
      (error) => {
        if (
          !senderWindow.isDestroyed()
        ) {
          senderWindow.webContents.send(
            "terminal:error",
            error.message,
          );
        }

        terminalProcess = null;
        terminalProjectPath = null;
      },
    );

    return {
      success: true,
      alreadyRunning: false,
    };
  },
);

/**
 * Send a command to the
 * existing PowerShell process.
 */
ipcMain.handle(
  "terminal:write",
  async (
    _event,
    command,
  ) => {
    if (!terminalProcess) {
      throw new Error(
        "Terminal process is not running.",
      );
    }

    terminalProcess.stdin.write(
      `${command}\r\n`,
    );

    return {
      success: true,
    };
  },
);

/**
 * Stop the current terminal process.
 */
ipcMain.handle(
  "terminal:stop",
  async () => {
    if (!terminalProcess) {
      return {
        success: true,
      };
    }

    terminalProcess.kill();

    terminalProcess = null;
    terminalProjectPath = null;

    return {
      success: true,
    };
  },
);

/**
 * =========================================================
 * Electron Application Lifecycle
 * =========================================================
 */

app.whenReady().then(() => {
  createWindow();

  app.on(
    "activate",
    () => {
      if (
        BrowserWindow.getAllWindows()
          .length === 0
      ) {
        createWindow();
      }
    },
  );
});

/**
 * Stop terminal and quit when
 * all application windows close.
 */
app.on(
  "window-all-closed",
  () => {
    if (terminalProcess) {
      terminalProcess.kill();
      terminalProcess = null;
      terminalProjectPath = null;
    }

    if (
      process.platform !== "darwin"
    ) {
      app.quit();
    }
  },
);