import { type ReactNode, useState } from "react";

interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

interface FileTreeProps {
  entries: FileEntry[];
  onFileSelect: (file: FileEntry) => void;
  onRefresh?: () => Promise<void> | void;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

function FileTree({
  entries,
  onFileSelect,
  onRefresh,
}: FileTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [directoryEntries, setDirectoryEntries] = useState<
    Record<string, FileEntry[]>
  >({});
  const [loadingPaths, setLoadingPaths] = useState<string[]>([]);

  const [contextMenu, setContextMenu] =
    useState<ContextMenuState | null>(null);

  const [renamingPath, setRenamingPath] =
    useState<string | null>(null);

  const [renameValue, setRenameValue] =
    useState("");

  const [operationError, setOperationError] =
    useState<string | null>(null);

  async function loadDirectory(path: string) {
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
        current.filter(
          (item) => item !== path,
        ),
      );
    }
  }

  async function toggleDirectory(path: string) {
    const isExpanded =
      expandedPaths.includes(path);

    if (isExpanded) {
      setExpandedPaths((current) =>
        current.filter(
          (item) => item !== path,
        ),
      );

      return;
    }

    if (!directoryEntries[path]) {
      await loadDirectory(path);
    }

    setExpandedPaths((current) => [
      ...current,
      path,
    ]);
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  function startRename(entry: FileEntry) {
    closeContextMenu();
    setOperationError(null);
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
  }

  function cancelRename() {
    setRenamingPath(null);
    setRenameValue("");
    setOperationError(null);
  }

  async function submitRename(entry: FileEntry) {
    const newName = renameValue.trim();

    if (!newName) {
      setOperationError(
        "Name cannot be empty.",
      );
      return;
    }

    if (
      newName.includes("/") ||
      newName.includes("\\")
    ) {
      setOperationError(
        "Name cannot contain / or \\ characters.",
      );
      return;
    }

    if (newName === entry.name) {
      cancelRename();
      return;
    }

    const parentPath =
      entry.path.substring(
        0,
        entry.path.length -
          entry.name.length,
      );

    const newPath = `${parentPath}${newName}`;

    try {
      setOperationError(null);

      await window.kryomcode.rename(
        entry.path,
        newPath,
      );

      cancelRename();

      if (onRefresh) {
        await onRefresh();
      }

      if (entry.type === "directory") {
        setDirectoryEntries({});
        setExpandedPaths([]);
      }
    } catch (error) {
      console.error(
        "KryomCode rename error:",
        error,
      );

      setOperationError(
        error instanceof Error
          ? error.message
          : "Unable to rename item.",
      );
    }
  }

  async function deleteEntry(entry: FileEntry) {
    closeContextMenu();

    const message =
      entry.type === "directory"
        ? `Delete folder "${entry.name}" and everything inside it?`
        : `Delete file "${entry.name}"?`;

    const confirmed =
      window.confirm(message);

    if (!confirmed) {
      return;
    }

    try {
      setOperationError(null);

      await window.kryomcode.delete(
        entry.path,
        entry.type,
      );

      if (onRefresh) {
        await onRefresh();
      }

      setDirectoryEntries({});
      setExpandedPaths([]);
    } catch (error) {
      console.error(
        "KryomCode delete error:",
        error,
      );

      setOperationError(
        error instanceof Error
          ? error.message
          : "Unable to delete item.",
      );
    }
  }

  function handleContextMenu(
    event: React.MouseEvent,
    entry: FileEntry,
  ) {
    event.preventDefault();

    setOperationError(null);

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry,
    });
  }

  function handleRenameKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    entry: FileEntry,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitRename(entry);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  function renderEntries(
    items: FileEntry[],
    depth = 0,
  ): ReactNode {
    return items.map((entry) => {
      const isDirectory =
        entry.type === "directory";

      const isExpanded =
        expandedPaths.includes(
          entry.path,
        );

      const isLoading =
        loadingPaths.includes(
          entry.path,
        );

      const isRenaming =
        renamingPath === entry.path;

      return (
        <div key={entry.path}>
          <div
            className="tree-item"
            style={{
              paddingLeft: `${
                6 + depth * 16
              }px`,
            }}
            onClick={() => {
              closeContextMenu();

              if (isDirectory) {
                void toggleDirectory(
                  entry.path,
                );
              } else {
                onFileSelect(entry);
              }
            }}
            onContextMenu={(event) =>
              handleContextMenu(
                event,
                entry,
              )
            }
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
              {isDirectory
                ? "📁"
                : "📄"}
            </span>

            {isRenaming ? (
              <input
                className="tree-rename-input"
                autoFocus
                value={renameValue}
                onChange={(event) =>
                  setRenameValue(
                    event.target.value,
                  )
                }
                onKeyDown={(event) =>
                  handleRenameKeyDown(
                    event,
                    entry,
                  )
                }
                onBlur={() => {
                  void submitRename(
                    entry,
                  );
                }}
                onClick={(event) =>
                  event.stopPropagation()
                }
              />
            ) : (
              <span>{entry.name}</span>
            )}
          </div>

          {isDirectory &&
            isExpanded &&
            directoryEntries[
              entry.path
            ] &&
            renderEntries(
              directoryEntries[
                entry.path
              ],
              depth + 1,
            )}
        </div>
      );
    });
  }

  return (
    <div
      className="file-tree"
      onClick={closeContextMenu}
    >
      {entries.length === 0 ? (
        <div className="empty-tree">
          No project opened
        </div>
      ) : (
        renderEntries(entries)
      )}

      {operationError && (
        <div className="tree-operation-error">
          {operationError}
        </div>
      )}

      {contextMenu && (
        <div
          className="tree-context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(event) =>
            event.stopPropagation()
          }
        >
          <button
            type="button"
            onClick={() =>
              startRename(
                contextMenu.entry,
              )
            }
          >
            Rename
          </button>

          <button
            type="button"
            className="danger-action"
            onClick={() =>
              void deleteEntry(
                contextMenu.entry,
              )
            }
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default FileTree;