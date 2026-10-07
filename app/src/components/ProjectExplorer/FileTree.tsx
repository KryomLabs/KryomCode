import { type ReactNode, useState } from "react";

interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

interface FileTreeProps {
  entries: FileEntry[];
  onFileSelect: (file: FileEntry) => void;
}

function FileTree({
  entries,
  onFileSelect,
}: FileTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<string[]>(
    [],
  );

  const [directoryEntries, setDirectoryEntries] = useState<
    Record<string, FileEntry[]>
  >({});

  const [loadingPaths, setLoadingPaths] = useState<string[]>(
    [],
  );

  async function toggleDirectory(path: string) {
    const isExpanded = expandedPaths.includes(path);

    if (isExpanded) {
      setExpandedPaths((current) =>
        current.filter((item) => item !== path),
      );

      return;
    }

    if (!directoryEntries[path]) {
      setLoadingPaths((current) => [
        ...current,
        path,
      ]);

      try {
        const children =
          await window.kryomcode.readDirectory(path);

        setDirectoryEntries((current) => ({
          ...current,
          [path]: children,
        }));
      } finally {
        setLoadingPaths((current) =>
          current.filter((item) => item !== path),
        );
      }
    }

    setExpandedPaths((current) => [
      ...current,
      path,
    ]);
  }

  function renderEntries(
    items: FileEntry[],
    depth = 0,
  ): ReactNode {
    return items.map((entry) => {
      const isDirectory =
        entry.type === "directory";

      const isExpanded =
        expandedPaths.includes(entry.path);

      const isLoading =
        loadingPaths.includes(entry.path);

      return (
        <div key={entry.path}>
          <div
            className="tree-item"
            style={{
              paddingLeft: `${6 + depth * 16}px`,
            }}
            onClick={() => {
              if (isDirectory) {
                void toggleDirectory(entry.path);
              } else {
                onFileSelect(entry);
              }
            }}
          >
            <span className="tree-arrow">
              {isDirectory
                ? isLoading
                  ? "…"
                  : isExpanded
                    ? "▾"
                    : "▸"
                : ""}
            </span>

            <span className="tree-icon">
              {isDirectory ? "📁" : "📄"}
            </span>

            <span>{entry.name}</span>
          </div>

          {isDirectory &&
            isExpanded &&
            directoryEntries[entry.path] &&
            renderEntries(
              directoryEntries[entry.path],
              depth + 1,
            )}
        </div>
      );
    });
  }

  if (entries.length === 0) {
    return (
      <div className="empty-tree">
        No project opened
      </div>
    );
  }

  return (
    <div className="file-tree">
      {renderEntries(entries)}
    </div>
  );
}

export default FileTree;