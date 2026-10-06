interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

interface Window {
  kryomcode: {
    version: string;
    selectProject: () => Promise<string | null>;
    readDirectory: (directoryPath: string) => Promise<IngeniaFileEntry[]>;
  };
}