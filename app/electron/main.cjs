const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
} = require("electron");

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const {
  startTests,
  stopTests,
  stopTestsForProject,
  cleanup: cleanupTestRunner,
} = require("./services/test-runner.cjs");

const isDev = !app.isPackaged;

let mainWindow = null;

let currentProjectPath = null;

let terminalProcess = null;
let terminalProjectPath = null;

/**
 * =========================================================
 * Utility / Security Helpers
 * =========================================================
 */

/**
 * Normalize a filesystem path.
 */
function normalizePath(targetPath) {
  return path.resolve(targetPath);
}

/**
 * Check whether targetPath is inside
 * the selected project directory.
 *
 * The project root itself is allowed.
 */
function isPathInsideProject(
  projectPath,
  targetPath,
) {
  const normalizedProject =
    normalizePath(projectPath);

  const normalizedTarget =
    normalizePath(targetPath);

  if (
    normalizedTarget ===
    normalizedProject
  ) {
    return true;
  }

  const relativePath =
    path.relative(
      normalizedProject,
      normalizedTarget,
    );

  return (
    relativePath !== "" &&
    !relativePath.startsWith(
      `..${path.sep}`,
    ) &&
    relativePath !== ".." &&
    !path.isAbsolute(
      relativePath,
    )
  );
}

/**
 * Require an active project.
 */
function requireProject() {
  if (!currentProjectPath) {
    throw new Error(
      "No project is open.",
    );
  }

  return currentProjectPath;
}

/**
 * Validate that a path belongs to
 * the currently opened project.
 */
function requireProjectPath(
  targetPath,
) {
  const projectPath =
    requireProject();

  if (
    typeof targetPath !==
      "string" ||
    targetPath.trim() === ""
  ) {
    throw new Error(
      "A valid filesystem path is required.",
    );
  }

  if (
    !isPathInsideProject(
      projectPath,
      targetPath,
    )
  ) {
    throw new Error(
      "Access denied: path is outside the opened project.",
    );
  }

  return normalizePath(
    targetPath,
  );
}

/**
 * Send an IPC event to the renderer
 * only when the window is still alive.
 */
function sendToRenderer(
  window,
  channel,
  ...args
) {
  if (
    !window ||
    window.isDestroyed()
  ) {
    return;
  }

  window.webContents.send(
    channel,
    ...args,
  );
}

/**
 * =========================================================
 * Main Window
 * =========================================================
 */

/**
 * Create the main application window.
 */
function createWindow() {
  mainWindow =
    new BrowserWindow({
      width: 1440,
      height: 900,

      minWidth: 1100,
      minHeight: 700,

      webPreferences: {
        preload: path.join(
          __dirname,
          "preload.cjs",
        ),

        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

  mainWindow.on(
    "closed",
    () => {
      mainWindow = null;
    },
  );

  if (isDev) {
    void mainWindow.loadURL(
      "http://localhost:5173",
    );
  } else {
    void mainWindow.loadFile(
      path.join(
        __dirname,
        "../dist/index.html",
      ),
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
        properties: [
          "openDirectory",
        ],
      });

    if (
      result.canceled ||
      result.filePaths.length === 0
    ) {
      return null;
    }

    const selectedPath =
      normalizePath(
        result.filePaths[0],
      );

    /*
     * Stop the previous terminal when
     * switching to another project.
     */
    if (
      terminalProcess &&
      terminalProjectPath !==
        selectedPath
    ) {
      stopTerminalProcess();
    }

    /*
     * Stop tests associated with the
     * previously opened project.
     */
    if (
      currentProjectPath &&
      currentProjectPath !==
        selectedPath
    ) {
      stopTestsForProject(
        currentProjectPath,
      );
    }

    currentProjectPath =
      selectedPath;

    return selectedPath;
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
    const safeDirectoryPath =
      requireProjectPath(
        directoryPath,
      );

    const entries =
      await fs.readdir(
        safeDirectoryPath,
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
          safeDirectoryPath,
          entry.name,
        ),
      }))
      .sort((a, b) => {
        if (
          a.type !== b.type
        ) {
          return a.type ===
            "directory"
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
    const safeFilePath =
      requireProjectPath(
        filePath,
      );

    const fileStats =
      await fs.stat(
        safeFilePath,
      );

    if (
      !fileStats.isFile()
    ) {
      throw new Error(
        "The selected path is not a file.",
      );
    }

    return fs.readFile(
      safeFilePath,
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
    const safeFilePath =
      requireProjectPath(
        filePath,
      );

    if (
      typeof content !==
      "string"
    ) {
      throw new Error(
        "File content must be a string.",
      );
    }

    const fileStats =
      await fs.stat(
        safeFilePath,
      );

    if (
      !fileStats.isFile()
    ) {
      throw new Error(
        "The selected path is not a file.",
      );
    }

    await fs.writeFile(
      safeFilePath,
      content,
      "utf-8",
    );

    return {
      success: true,
      path: safeFilePath,
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
    const safeFilePath =
      requireProjectPath(
        filePath,
      );

    await fs.writeFile(
      safeFilePath,
      "",
      {
        encoding: "utf-8",
        flag: "wx",
      },
    );

    return {
      success: true,
      path: safeFilePath,
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
    const safeDirectoryPath =
      requireProjectPath(
        directoryPath,
      );

    await fs.mkdir(
      safeDirectoryPath,
      {
        recursive: false,
      },
    );

    return {
      success: true,
      path: safeDirectoryPath,
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
    const safeOldPath =
      requireProjectPath(
        oldPath,
      );

    const safeNewPath =
      requireProjectPath(
        newPath,
      );

    await fs.rename(
      safeOldPath,
      safeNewPath,
    );

    return {
      success: true,
      oldPath: safeOldPath,
      newPath: safeNewPath,
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
    const safeTargetPath =
      requireProjectPath(
        targetPath,
      );

    /*
     * Prevent deletion of the
     * project root itself.
     */
    const projectPath =
      requireProject();

    if (
      normalizePath(
        safeTargetPath,
      ) ===
      normalizePath(
        projectPath,
      )
    ) {
      throw new Error(
        "The project root cannot be deleted.",
      );
    }

    if (
      targetType ===
      "directory"
    ) {
      await fs.rm(
        safeTargetPath,
        {
          recursive: true,
          force: false,
        },
      );
    } else {
      await fs.unlink(
        safeTargetPath,
      );
    }

    return {
      success: true,
      path: safeTargetPath,
    };
  },
);

/**
 * =========================================================
 * Terminal Helpers
 * =========================================================
 */

/**
 * Stop the current terminal process.
 */
function stopTerminalProcess() {
  if (!terminalProcess) {
    terminalProjectPath =
      null;

    return;
  }

  try {
    terminalProcess.kill();
  } catch (error) {
    console.error(
      "Failed to stop terminal process:",
      error,
    );
  }

  terminalProcess = null;
  terminalProjectPath = null;
}

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
    if (
      typeof projectPath !==
        "string" ||
      projectPath.trim() === ""
    ) {
      throw new Error(
        "No project is open.",
      );
    }

    const activeProjectPath =
      requireProjectPath(
        projectPath,
      );

    const senderWindow =
      BrowserWindow.fromWebContents(
        event.sender,
      );

    if (!senderWindow) {
      throw new Error(
        "Terminal window is unavailable.",
      );
    }

    /*
     * Reuse the current terminal
     * when it belongs to the same
     * project.
     */
    if (
      terminalProcess &&
      terminalProjectPath ===
        activeProjectPath
    ) {
      return {
        success: true,
        alreadyRunning: true,
      };
    }

    /*
     * If another terminal exists,
     * stop it before creating a new
     * project session.
     */
    if (terminalProcess) {
      stopTerminalProcess();
    }

    terminalProjectPath =
      activeProjectPath;

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
        cwd: activeProjectPath,

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
        sendToRenderer(
          senderWindow,
          "terminal:output",
          data.toString(),
        );
      },
    );

    /**
     * Standard error.
     */
    terminalProcess.stderr.on(
      "data",
      (data) => {
        sendToRenderer(
          senderWindow,
          "terminal:error",
          data.toString(),
        );
      },
    );

    /**
     * Process closed.
     */
    terminalProcess.on(
      "close",
      (code) => {
        sendToRenderer(
          senderWindow,
          "terminal:exit",
          code,
        );

        terminalProcess =
          null;

        terminalProjectPath =
          null;
      },
    );

    /**
     * Process error.
     */
    terminalProcess.on(
      "error",
      (error) => {
        sendToRenderer(
          senderWindow,
          "terminal:error",
          error.message,
        );

        terminalProcess =
          null;

        terminalProjectPath =
          null;
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

    if (
      typeof command !==
      "string"
    ) {
      throw new Error(
        "Terminal command must be a string.",
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
    stopTerminalProcess();

    return {
      success: true,
    };
  },
);

/**
 * =========================================================
 * Test Runner IPC
 * =========================================================
 */

/**
 * Run the project's test suite.
 *
 * Currently the test-runner service
 * executes:
 *
 *     python -m pytest
 *
 * inside the active project directory.
 */
ipcMain.handle(
  "tests:run",
  async (
    event,
    projectPath,
  ) => {
    const activeProjectPath =
      requireProjectPath(
        projectPath,
      );

    const senderWindow =
      BrowserWindow.fromWebContents(
        event.sender,
      );

    if (!senderWindow) {
      throw new Error(
        "Test runner window is unavailable.",
      );
    }

    const result =
      startTests({
        projectPath:
          activeProjectPath,

        /**
         * Stream stdout.
         */
        onOutput: (data) => {
          sendToRenderer(
            senderWindow,
            "tests:output",
            data,
          );
        },

        /**
         * Stream stderr.
         */
        onError: (data) => {
          sendToRenderer(
            senderWindow,
            "tests:error",
            data,
          );
        },

        /**
         * Test process exited.
         */
        onExit: (code) => {
          sendToRenderer(
            senderWindow,
            "tests:exit",
            code,
          );
        },

        /**
         * Test process could not start.
         */
        onProcessError: (error) => {
          sendToRenderer(
            senderWindow,
            "tests:process-error",
            error.message,
          );
        },
      });

    return result;
  },
);

/**
 * Stop the currently running
 * test process.
 */
ipcMain.handle(
  "tests:stop",
  async () => {
    return stopTests();
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
 * Stop terminal and test runner
 * when all application windows close.
 */
app.on(
  "window-all-closed",
  () => {
    stopTerminalProcess();
    cleanupTestRunner();

    currentProjectPath =
      null;

    if (
      process.platform !==
      "darwin"
    ) {
      app.quit();
    }
  },
);

/**
 * Cleanup before application quit.
 */
app.on(
  "before-quit",
  () => {
    stopTerminalProcess();
    cleanupTestRunner();
  },
);