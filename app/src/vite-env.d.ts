interface IngeniaFileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

interface Window {
  ingenia: {
    version: string;
    selectProject: () => Promise<string | null>;
    readDirectory: (directoryPath: string) => Promise<IngeniaFileEntry[]>;
  };
}