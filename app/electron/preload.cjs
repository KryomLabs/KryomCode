const {
  contextBridge,
  ipcRenderer,
} = require("electron");

/**
 * =========================================================
 * Event Subscription Helper
 * =========================================================
 *
 * Creates a safe renderer-side subscription
 * without exposing ipcRenderer directly.
 */
function createEventSubscription(
  channel,
  callback,
) {
  const listener = (
    _event,
    ...args
  ) => {
    callback(...args);
  };

  ipcRenderer.on(
    channel,
    listener,
  );

  /**
   * Return cleanup function.
   */
  return () => {
    ipcRenderer.removeListener(
      channel,
      listener,
    );
  };
}

/**
 * =========================================================
 * KryomCode Renderer API
 * =========================================================
 *
 * Only explicitly approved APIs are
 * exposed to the renderer process.
 *
 * ipcRenderer itself is NEVER exposed.
 * =========================================================
 */

const kryomcodeAPI = {
  /**
   * Application version.
   */
  version: "0.1.0",

  /**
   * =======================================================
   * Project
   * =======================================================
   */

  /**
   * Open a project directory.
   */
  selectProject: () =>
    ipcRenderer.invoke(
      "project:select",
    ),

  /**
   * Read a directory.
   */
  readDirectory: (
    directoryPath,
  ) =>
    ipcRenderer.invoke(
      "project:read-directory",
      directoryPath,
    ),

  /**
   * Read a text file.
   */
  readFile: (
    filePath,
  ) =>
    ipcRenderer.invoke(
      "project:read-file",
      filePath,
    ),

  /**
   * Write a text file.
   */
  writeFile: (
    filePath,
    content,
  ) =>
    ipcRenderer.invoke(
      "project:write-file",
      filePath,
      content,
    ),

  /**
   * Create a new file.
   */
  createFile: (
    filePath,
  ) =>
    ipcRenderer.invoke(
      "project:create-file",
      filePath,
    ),

  /**
   * Create a new folder.
   */
  createFolder: (
    directoryPath,
  ) =>
    ipcRenderer.invoke(
      "project:create-folder",
      directoryPath,
    ),

  /**
   * Rename a file or directory.
   */
  rename: (
    oldPath,
    newPath,
  ) =>
    ipcRenderer.invoke(
      "project:rename",
      oldPath,
      newPath,
    ),

  /**
   * Delete a file or directory.
   */
  delete: (
    targetPath,
    targetType,
  ) =>
    ipcRenderer.invoke(
      "project:delete",
      targetPath,
      targetType,
    ),

  /**
   * =======================================================
   * Terminal
   * =======================================================
   */

  /**
   * Start integrated terminal.
   */
  startTerminal: (
    projectPath,
  ) =>
    ipcRenderer.invoke(
      "terminal:start",
      projectPath,
    ),

  /**
   * Send command to terminal.
   */
  writeTerminal: (
    command,
  ) =>
    ipcRenderer.invoke(
      "terminal:write",
      command,
    ),

  /**
   * Stop integrated terminal.
   */
  stopTerminal: () =>
    ipcRenderer.invoke(
      "terminal:stop",
    ),

  /**
   * Terminal stdout.
   */
  onTerminalOutput: (
    callback,
  ) =>
    createEventSubscription(
      "terminal:output",
      callback,
    ),

  /**
   * Terminal stderr.
   */
  onTerminalError: (
    callback,
  ) =>
    createEventSubscription(
      "terminal:error",
      callback,
    ),

  /**
   * Terminal process exit.
   */
  onTerminalExit: (
    callback,
  ) =>
    createEventSubscription(
      "terminal:exit",
      callback,
    ),

  /**
   * =======================================================
   * Test Runner
   * =======================================================
   */

  /**
   * Start pytest.
   *
   * The main process validates the
   * project path before execution.
   */
  runTests: (
    projectPath,
  ) =>
    ipcRenderer.invoke(
      "tests:run",
      projectPath,
    ),

  /**
   * Stop the active pytest process.
   */
  stopTests: () =>
    ipcRenderer.invoke(
      "tests:stop",
    ),

  /**
   * Test stdout.
   */
  onTestOutput: (
    callback,
  ) =>
    createEventSubscription(
      "tests:output",
      callback,
    ),

  /**
   * Test stderr.
   */
  onTestError: (
    callback,
  ) =>
    createEventSubscription(
      "tests:error",
      callback,
    ),

  /**
   * Test process exit.
   */
  onTestExit: (
    callback,
  ) =>
    createEventSubscription(
      "tests:exit",
      callback,
    ),

  /**
   * Test process startup error.
   */
  onTestProcessError: (
    callback,
  ) =>
    createEventSubscription(
      "tests:process-error",
      callback,
    ),
};

/**
 * =========================================================
 * Expose API
 * =========================================================
 */

contextBridge.exposeInMainWorld(
  "kryomcode",
  kryomcodeAPI,
);