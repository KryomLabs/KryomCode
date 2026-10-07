const {
  contextBridge,
  ipcRenderer,
} = require("electron");

console.log(
  "KryomCode preload loaded",
);

contextBridge.exposeInMainWorld(
  "kryomcode",
  {
    version: "0.1.0",

    /**
     * =====================================================
     * Project
     * =====================================================
     */

    /**
     * Open a project directory.
     */
    selectProject: () => {
      return ipcRenderer.invoke(
        "project:select",
      );
    },

    /**
     * Read directory contents.
     */
    readDirectory: (
      directoryPath,
    ) => {
      return ipcRenderer.invoke(
        "project:read-directory",
        directoryPath,
      );
    },

    /**
     * Read a text file.
     */
    readFile: (
      filePath,
    ) => {
      return ipcRenderer.invoke(
        "project:read-file",
        filePath,
      );
    },

    /**
     * Write a text file.
     */
    writeFile: (
      filePath,
      content,
    ) => {
      return ipcRenderer.invoke(
        "project:write-file",
        filePath,
        content,
      );
    },

    /**
     * Create a new file.
     */
    createFile: (
      filePath,
    ) => {
      return ipcRenderer.invoke(
        "project:create-file",
        filePath,
      );
    },

    /**
     * Create a new folder.
     */
    createFolder: (
      directoryPath,
    ) => {
      return ipcRenderer.invoke(
        "project:create-folder",
        directoryPath,
      );
    },

    /**
     * Rename a file or folder.
     */
    rename: (
      oldPath,
      newPath,
    ) => {
      return ipcRenderer.invoke(
        "project:rename",
        oldPath,
        newPath,
      );
    },

    /**
     * Delete a file or folder.
     */
    delete: (
      targetPath,
      targetType,
    ) => {
      return ipcRenderer.invoke(
        "project:delete",
        targetPath,
        targetType,
      );
    },

    /**
     * =====================================================
     * Terminal
     * =====================================================
     */

    /**
     * Start a persistent PowerShell terminal.
     */
    startTerminal: (
      projectPath,
    ) => {
      return ipcRenderer.invoke(
        "terminal:start",
        projectPath,
      );
    },

    /**
     * Send a command to the running terminal.
     */
    writeTerminal: (
      command,
    ) => {
      return ipcRenderer.invoke(
        "terminal:write",
        command,
      );
    },

    /**
     * Stop the running terminal.
     */
    stopTerminal: () => {
      return ipcRenderer.invoke(
        "terminal:stop",
      );
    },

    /**
     * =====================================================
     * Terminal Events
     * =====================================================
     */

    /**
     * Receive standard output from terminal.
     *
     * Returns a cleanup function that removes
     * the registered IPC listener.
     */
    onTerminalOutput: (
      callback,
    ) => {
      const listener = (
        _event,
        data,
      ) => {
        callback(data);
      };

      ipcRenderer.on(
        "terminal:output",
        listener,
      );

      return () => {
        ipcRenderer.removeListener(
          "terminal:output",
          listener,
        );
      };
    },

    /**
     * Receive error output from terminal.
     *
     * Returns a cleanup function.
     */
    onTerminalError: (
      callback,
    ) => {
      const listener = (
        _event,
        data,
      ) => {
        callback(data);
      };

      ipcRenderer.on(
        "terminal:error",
        listener,
      );

      return () => {
        ipcRenderer.removeListener(
          "terminal:error",
          listener,
        );
      };
    },

    /**
     * Receive terminal process exit event.
     *
     * Returns a cleanup function.
     */
    onTerminalExit: (
      callback,
    ) => {
      const listener = (
        _event,
        code,
      ) => {
        callback(code);
      };

      ipcRenderer.on(
        "terminal:exit",
        listener,
      );

      return () => {
        ipcRenderer.removeListener(
          "terminal:exit",
          listener,
        );
      };
    },
  },
);