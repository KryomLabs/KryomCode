/// <reference types="vite/client" />

/**
 * =========================================================
 * Project / Filesystem Types
 * =========================================================
 */

interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

interface WriteFileResult {
  success: boolean;
  path?: string;
}

interface CreateFileResult {
  success: boolean;
  path: string;
}

interface CreateFolderResult {
  success: boolean;
  path: string;
}

interface RenameResult {
  success: boolean;
  oldPath: string;
  newPath: string;
}

interface DeleteResult {
  success: boolean;
  path: string;
}

/**
 * =========================================================
 * Terminal Types
 * =========================================================
 */

interface StartTerminalResult {
  success: boolean;
  alreadyRunning?: boolean;
}

interface WriteTerminalResult {
  success: boolean;
}

interface StopTerminalResult {
  success: boolean;
}

/**
 * =========================================================
 * Test Runner Types
 * =========================================================
 */

interface RunTestsResult {
  success: boolean;
  alreadyRunning?: boolean;
}

interface StopTestsResult {
  success: boolean;
  wasRunning?: boolean;
}

/**
 * =========================================================
 * KryomCode API
 * =========================================================
 */

interface KryomCodeAPI {
  /**
   * Application version.
   */
  version: string;

  /**
   * =======================================================
   * Project
   * =======================================================
   */

  selectProject: () => Promise<
    string | null
  >;

  readDirectory: (
    directoryPath: string,
  ) => Promise<FileEntry[]>;

  readFile: (
    filePath: string,
  ) => Promise<string>;

  writeFile: (
    filePath: string,
    content: string,
  ) => Promise<WriteFileResult>;

  createFile: (
    filePath: string,
  ) => Promise<CreateFileResult>;

  createFolder: (
    directoryPath: string,
  ) => Promise<CreateFolderResult>;

  rename: (
    oldPath: string,
    newPath: string,
  ) => Promise<RenameResult>;

  delete: (
    targetPath: string,
    targetType:
      | "file"
      | "directory",
  ) => Promise<DeleteResult>;

  /**
   * =======================================================
   * Terminal
   * =======================================================
   */

  startTerminal: (
    projectPath: string,
  ) => Promise<StartTerminalResult>;

  writeTerminal: (
    command: string,
  ) => Promise<WriteTerminalResult>;

  stopTerminal: () => Promise<StopTerminalResult>;

  onTerminalOutput: (
    callback: (
      data: string,
    ) => void,
  ) => () => void;

  onTerminalError: (
    callback: (
      data: string,
    ) => void,
  ) => () => void;

  onTerminalExit: (
    callback: (
      code: number | null,
    ) => void,
  ) => () => void;

  /**
   * =======================================================
   * Test Runner
   * =======================================================
   */

  /**
   * Start pytest in the
   * currently opened project.
   */
  runTests: (
    projectPath: string,
  ) => Promise<RunTestsResult>;

  /**
   * Stop the active pytest process.
   */
  stopTests: () => Promise<StopTestsResult>;

  /**
   * Stream pytest stdout.
   */
  onTestOutput: (
    callback: (
      data: string,
    ) => void,
  ) => () => void;

  /**
   * Stream pytest stderr.
   */
  onTestError: (
    callback: (
      data: string,
    ) => void,
  ) => () => void;

  /**
   * Called when pytest exits.
   */
  onTestExit: (
    callback: (
      code: number | null,
    ) => void,
  ) => () => void;

  /**
   * Called when pytest could
   * not be started.
   */
  onTestProcessError: (
    callback: (
      message: string,
    ) => void,
  ) => () => void;
}

/**
 * =========================================================
 * Browser Window API
 * =========================================================
 */

interface Window {
  kryomcode: KryomCodeAPI;
}