import {
  type ReactNode,
  useEffect,
  useState,
} from "react";

interface FileTreeProps {
  entries: FileEntry[];
  onFileSelect: (
    file: FileEntry,
  ) => void;
  onRefresh?: () =>
    | Promise<void>
    | void;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

/**
 * FileTree
 *
 * Responsibilities:
 * - Render files/folders
 * - Expand/collapse directories
 * - Lazy-load directory contents
 * - Rename entries
 * - Delete entries
 * - Context menu
 */
function FileTree({
  entries,
  onFileSelect,
  onRefresh,
}: FileTreeProps) {
  const [
    expandedPaths,
    setExpandedPaths,
  ] = useState<string[]>([]);

  const [
    directoryEntries,
    setDirectoryEntries,
  ] = useState<
    Record<
      string,
      FileEntry[]
    >
  >({});

  const [
    loadingPaths,
    setLoadingPaths,
  ] = useState<string[]>([]);

  const [
    contextMenu,
    setContextMenu,
  ] =
    useState<ContextMenuState | null>(
      null,
    );

  const [
    renamingPath,
    setRenamingPath,
  ] =
    useState<string | null>(
      null,
    );

  const [
    renameValue,
    setRenameValue,
  ] = useState("");

  const [
    operationError,
    setOperationError,
  ] =
    useState<string | null>(
      null,
    );

  /**
   * Close context menu when
   * the user clicks elsewhere.
   */
  useEffect(() => {
    function handleDocumentClick() {
      setContextMenu(null);
    }

    function handleEscape(
      event: KeyboardEvent,
    ) {
      if (
        event.key === "Escape"
      ) {
        setContextMenu(null);
        cancelRename();
      }
    }

    document.addEventListener(
      "click",
      handleDocumentClick,
    );

    document.addEventListener(
      "keydown",
      handleEscape,
    );

    return () => {
      document.removeEventListener(
        "click",
        handleDocumentClick,
      );

      document.removeEventListener(
        "keydown",
        handleEscape,
      );
    };
  });

  /**
   * Reset lazy-loaded directory state
   * whenever the root project entries change.
   */
  useEffect(() => {
    setDirectoryEntries({});
    setExpandedPaths([]);
    setLoadingPaths([]);
    setContextMenu(null);
    setRenamingPath(null);
    setRenameValue("");
  }, [entries]);

  /**
   * Load directory contents.
   */
  async function loadDirectory(
    directoryPath: string,
  ) {
    if (
      loadingPaths.includes(
        directoryPath,
      )
    ) {
      return;
    }

    setLoadingPaths(
      (current) => [
        ...current,
        directoryPath,
      ],
    );

    try {
      const children =
        await window.kryomcode.readDirectory(
          directoryPath,
        );

      setDirectoryEntries(
        (current) => ({
          ...current,
          [directoryPath]:
            children,
        }),
      );
    } catch (error) {
      console.error(
        "KryomCode directory read error:",
        error,
      );

      setOperationError(
        error instanceof Error
          ? error.message
          : "Unable to read directory.",
      );
    } finally {
      setLoadingPaths(
        (current) =>
          current.filter(
            (item) =>
              item !==
              directoryPath,
          ),
      );
    }
  }

  /**
   * Toggle directory expansion.
   */
  async function toggleDirectory(
    directoryPath: string,
  ) {
    const isExpanded =
      expandedPaths.includes(
        directoryPath,
      );

    if (isExpanded) {
      setExpandedPaths(
        (current) =>
          current.filter(
            (item) =>
              item !==
              directoryPath,
          ),
      );

      return;
    }

    setOperationError(null);

    if (
      !directoryEntries[
        directoryPath
      ]
    ) {
      await loadDirectory(
        directoryPath,
      );
    }

    setExpandedPaths(
      (current) => [
        ...current,
        directoryPath,
      ],
    );
  }

  /**
   * Close context menu.
   */
  function closeContextMenu() {
    setContextMenu(null);
  }

  /**
   * Start renaming an entry.
   */
  function startRename(
    entry: FileEntry,
  ) {
    closeContextMenu();

    setOperationError(null);

    setRenamingPath(
      entry.path,
    );

    setRenameValue(
      entry.name,
    );
  }

  /**
   * Cancel rename.
   */
  function cancelRename() {
    setRenamingPath(null);
    setRenameValue("");
  }

  /**
   * Submit rename operation.
   */
  async function submitRename(
    entry: FileEntry,
  ) {
    const newName =
      renameValue.trim();

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

    if (
      newName === "." ||
      newName === ".."
    ) {
      setOperationError(
        "Invalid file or folder name.",
      );

      return;
    }

    if (
      newName === entry.name
    ) {
      cancelRename();
      return;
    }

    const parentPath =
      entry.path.substring(
        0,
        entry.path.length -
          entry.name.length,
      );

    const newPath =
      `${parentPath}${newName}`;

    try {
      setOperationError(null);

      await window.kryomcode.rename(
        entry.path,
        newPath,
      );

      cancelRename();

      /*
       * Clear cached directories because
       * the tree structure may have changed.
       */
      setDirectoryEntries({});
      setExpandedPaths([]);

      if (onRefresh) {
        await onRefresh();
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

  /**
   * Delete an entry after confirmation.
   */
  async function deleteEntry(
    entry: FileEntry,
  ) {
    closeContextMenu();

    const message =
      entry.type ===
      "directory"
        ? `Delete folder "${entry.name}" and everything inside it?`
        : `Delete file "${entry.name}"?`;

    const confirmed =
      window.confirm(
        message,
      );

    if (!confirmed) {
      return;
    }

    try {
      setOperationError(null);

      await window.kryomcode.delete(
        entry.path,
        entry.type,
      );

      setDirectoryEntries({});
      setExpandedPaths([]);

      if (onRefresh) {
        await onRefresh();
      }
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

  /**
   * Open context menu.
   *
   * Prevent the document-level click handler
   * from immediately closing it.
   */
  function handleContextMenu(
    event: React.MouseEvent,
    entry: FileEntry,
  ) {
    event.preventDefault();
    event.stopPropagation();

    setOperationError(null);

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry,
    });
  }

  /**
   * Handle rename keyboard shortcuts.
   */
  function handleRenameKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    entry: FileEntry,
  ) {
    if (
      event.key === "Enter"
    ) {
      event.preventDefault();

      void submitRename(entry);
      return;
    }

    if (
      event.key === "Escape"
    ) {
      event.preventDefault();

      cancelRename();
    }
  }

  /**
   * Render tree entries recursively.
   */
  function renderEntries(
    items: FileEntry[],
    depth = 0,
  ): ReactNode {
    return items.map(
      (entry) => {
        const isDirectory =
          entry.type ===
          "directory";

        const isExpanded =
          expandedPaths.includes(
            entry.path,
          );

        const isLoading =
          loadingPaths.includes(
            entry.path,
          );

        const isRenaming =
          renamingPath ===
          entry.path;

        return (
          <div
            key={entry.path}
            className="tree-node"
          >
            <div
              className="tree-item"
              style={{
                paddingLeft: `${
                  6 + depth * 16
                }px`,
              }}
              role="button"
              tabIndex={0}
              onClick={(
                event,
              ) => {
                event.stopPropagation();

                closeContextMenu();

                if (
                  isDirectory
                ) {
                  void toggleDirectory(
                    entry.path,
                  );
                } else {
                  onFileSelect(
                    entry,
                  );
                }
              }}
              onKeyDown={(
                event,
              ) => {
                if (
                  event.key ===
                  "Enter"
                ) {
                  event.preventDefault();

                  if (
                    isDirectory
                  ) {
                    void toggleDirectory(
                      entry.path,
                    );
                  } else {
                    onFileSelect(
                      entry,
                    );
                  }
                }
              }}
              onContextMenu={(
                event,
              ) =>
                handleContextMenu(
                  event,
                  entry,
                )
              }
            >
              {/* Arrow */}

              <span
                className="tree-arrow"
                aria-hidden="true"
              >
                {isDirectory
                  ? isLoading
                    ? "…"
                    : isExpanded
                      ? "▾"
                      : "▸"
                  : ""}
              </span>

              {/* Icon */}

              <span
                className="tree-icon"
                aria-hidden="true"
              >
                {isDirectory
                  ? isExpanded
                    ? "📂"
                    : "📁"
                  : "📄"}
              </span>

              {/* Name / Rename */}

              {isRenaming ? (
                <input
                  className="tree-rename-input"
                  autoFocus
                  type="text"
                  value={
                    renameValue
                  }
                  aria-label={`Rename ${entry.name}`}
                  onChange={(
                    event,
                  ) =>
                    setRenameValue(
                      event.target
                        .value,
                    )
                  }
                  onKeyDown={(
                    event,
                  ) =>
                    handleRenameKeyDown(
                      event,
                      entry,
                    )
                  }
                  onBlur={() => {
                    if (
                      renamingPath ===
                      entry.path
                    ) {
                      void submitRename(
                        entry,
                      );
                    }
                  }}
                  onClick={(
                    event,
                  ) =>
                    event.stopPropagation()
                  }
                />
              ) : (
                <span
                  className="tree-entry-name"
                  title={entry.name}
                >
                  {entry.name}
                </span>
              )}
            </div>

            {/* Children */}

            {isDirectory &&
              isExpanded &&
              directoryEntries[
                entry.path
              ] && (
                <div className="tree-children">
                  {directoryEntries[
                    entry.path
                  ].length > 0 ? (
                    renderEntries(
                      directoryEntries[
                        entry.path
                      ],
                      depth + 1,
                    )
                  ) : (
                    <div className="tree-placeholder">
                      Empty folder
                    </div>
                  )}
                </div>
              )}
          </div>
        );
      },
    );
  }

  return (
    <div
      className="file-tree"
      onClick={() =>
        closeContextMenu()
      }
    >
      {/* Root */}

      {entries.length === 0 ? (
        <div className="empty-tree">
          No project opened
        </div>
      ) : (
        renderEntries(entries)
      )}

      {/* Error */}

      {operationError && (
        <div
          className="tree-operation-error"
          role="alert"
        >
          {operationError}
        </div>
      )}

      {/* Context Menu */}

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