interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

interface Window {
  kryomcode: {
    version: string;

    // =====================================================
    // Project
    // =====================================================

    selectProject: () => Promise<string | null>;

    readDirectory: (
      directoryPath: string,
    ) => Promise<FileEntry[]>;

    readFile: (
      filePath: string,
    ) => Promise<string>;

    writeFile: (
      filePath: string,
      content: string,
    ) => Promise<{
      success: boolean;
    }>;

    createFile: (
      filePath: string,
    ) => Promise<{
      success: boolean;
      path: string;
    }>;

    createFolder: (
      directoryPath: string,
    ) => Promise<{
      success: boolean;
      path: string;
    }>;

    rename: (
      oldPath: string,
      newPath: string,
    ) => Promise<{
      success: boolean;
      oldPath: string;
      newPath: string;
    }>;

    delete: (
      targetPath: string,
      targetType: "file" | "directory",
    ) => Promise<{
      success: boolean;
      path: string;
    }>;

    // =====================================================
    // Terminal
    // =====================================================

    startTerminal: (
      projectPath: string,
    ) => Promise<{
      success: boolean;
      alreadyRunning?: boolean;
    }>;

    writeTerminal: (
      command: string,
    ) => Promise<{
      success: boolean;
    }>;

    stopTerminal: () => Promise<{
      success: boolean;
    }>;

    onTerminalOutput: (
      callback: (data: string) => void,
    ) => () => void;

    onTerminalError: (
      callback: (data: string) => void,
    ) => () => void;

    onTerminalExit: (
      callback: (code: number | null) => void,
    ) => () => void;
  };
}