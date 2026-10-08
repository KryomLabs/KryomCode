import { useState } from "react";

import FileTree from "./FileTree";
import "./project-explorer.css";

interface ProjectExplorerProps {
  projectPath: string | null;
  entries: FileEntry[];
  onFileSelect: (file: FileEntry) => void;
  onRefresh: () => Promise<void> | void;
}

type CreateType =
  | "file"
  | "folder"
  | null;

/**
 * Project Explorer
 *
 * Responsibilities:
 * - Display project name
 * - Create files/folders
 * - Delegate tree rendering to FileTree
 * - Trigger project refresh
 *
 * File/folder navigation, rename and delete
 * are handled by FileTree.
 */
function ProjectExplorer({
  projectPath,
  entries,
  onFileSelect,
  onRefresh,
}: ProjectExplorerProps) {
  const [creating, setCreating] =
    useState<CreateType>(null);

  const [newName, setNewName] =
    useState("");

  const [error, setError] =
    useState<string | null>(null);

  /**
   * Get project display name.
   */
  const projectName = projectPath
    ? projectPath.split(/[\\/]/).pop() ??
      "Project"
    : "No Project";

  /**
   * Start creating a file or folder.
   */
  function startCreating(
    type: "file" | "folder",
  ) {
    if (!projectPath) {
      return;
    }

    setError(null);
    setNewName("");
    setCreating(type);
  }

  /**
   * Cancel creation.
   */
  function cancelCreating() {
    setCreating(null);
    setNewName("");
    setError(null);
  }

  /**
   * Validate a new item name.
   */
  function validateName(
    name: string,
  ): string | null {
    if (!name) {
      return creating === "file"
        ? "File name is required."
        : "Folder name is required.";
    }

    if (
      name.includes("/") ||
      name.includes("\\")
    ) {
      return "Name cannot contain / or \\ characters.";
    }

    if (
      name === "." ||
      name === ".."
    ) {
      return "Invalid file or folder name.";
    }

    return null;
  }

  /**
   * Create the requested file/folder.
   */
  async function handleCreate() {
    if (
      !projectPath ||
      !creating
    ) {
      return;
    }

    const name =
      newName.trim();

    const validationError =
      validateName(name);

    if (validationError) {
      setError(
        validationError,
      );
      return;
    }

    const targetPath =
      `${projectPath}\\${name}`;

    try {
      setError(null);

      if (
        creating === "file"
      ) {
        await window.kryomcode.createFile(
          targetPath,
        );
      } else {
        await window.kryomcode.createFolder(
          targetPath,
        );
      }

      cancelCreating();

      await onRefresh();
    } catch (creationError) {
      console.error(
        "KryomCode creation error:",
        creationError,
      );

      setError(
        creationError instanceof Error
          ? creationError.message
          : "Unable to create item.",
      );
    }
  }

  /**
   * Handle Enter/Escape while creating.
   */
  function handleInputKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();

      void handleCreate();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();

      cancelCreating();
    }
  }

  return (
    <aside
      className="project-explorer"
      aria-label="Project Explorer"
    >
      {/* =================================================
          Panel Header
          ================================================= */}

      <div className="panel-title">
        <span>PROJECT</span>

        {projectPath && (
          <div className="project-actions">
            {/* New File */}

            <button
              type="button"
              className="project-action-button"
              title="New File"
              aria-label="Create new file"
              onClick={() =>
                startCreating(
                  "file",
                )
              }
            >
              +
            </button>

            {/* New Folder */}

            <button
              type="button"
              className="project-action-button folder-action"
              title="New Folder"
              aria-label="Create new folder"
              onClick={() =>
                startCreating(
                  "folder",
                )
              }
            >
              📁
            </button>
          </div>
        )}
      </div>

      {/* =================================================
          Project Name
          ================================================= */}

      <div
        className="project-name"
        title={
          projectPath ??
          "No project opened"
        }
      >
        {projectName}
      </div>

      {/* =================================================
          Create File / Folder
          ================================================= */}

      {creating && (
        <div className="create-item">
          <div className="create-item-label">
            {creating === "file"
              ? "New File"
              : "New Folder"}
          </div>

          <input
            autoFocus
            type="text"
            value={newName}
            placeholder={
              creating === "file"
                ? "filename.ts"
                : "folder-name"
            }
            aria-label={
              creating === "file"
                ? "New file name"
                : "New folder name"
            }
            onChange={(
              event,
            ) =>
              setNewName(
                event.target.value,
              )
            }
            onKeyDown={
              handleInputKeyDown
            }
          />

          <div className="create-item-actions">
            <button
              type="button"
              onClick={() =>
                void handleCreate()
              }
            >
              Create
            </button>

            <button
              type="button"
              onClick={
                cancelCreating
              }
            >
              Cancel
            </button>
          </div>

          {error && (
            <div
              className="create-item-error"
              role="alert"
            >
              {error}
            </div>
          )}
        </div>
      )}

      {/* =================================================
          File Tree
          ================================================= */}

      <FileTree
        entries={entries}
        onFileSelect={
          onFileSelect
        }
        onRefresh={onRefresh}
      />
    </aside>
  );
}

export default ProjectExplorer;