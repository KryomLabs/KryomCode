import { useState } from "react";
import FileTree from "./FileTree";
import "./project-explorer.css";

interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

interface ProjectExplorerProps {
  projectPath: string | null;
  entries: FileEntry[];
  onFileSelect: (file: FileEntry) => void;
  onRefresh: () => Promise<void> | void;
}

function ProjectExplorer({
  projectPath,
  entries,
  onFileSelect,
  onRefresh,
}: ProjectExplorerProps) {
  const [creating, setCreating] = useState<
    "file" | "folder" | null
  >(null);

  const [newName, setNewName] = useState("");

  const [error, setError] = useState<string | null>(
    null,
  );

  const projectName = projectPath
    ? projectPath.split("\\").pop() ?? "Project"
    : "No Project";

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

  function cancelCreating() {
    setCreating(null);
    setNewName("");
    setError(null);
  }

  async function handleCreate() {
    if (!projectPath || !creating) {
      return;
    }

    const name = newName.trim();

    if (!name) {
      setError(
        creating === "file"
          ? "File name is required."
          : "Folder name is required.",
      );

      return;
    }

    if (
      name.includes("/") ||
      name.includes("\\")
    ) {
      setError(
        "Name cannot contain / or \\ characters.",
      );

      return;
    }

    const targetPath = `${projectPath}\\${name}`;

    try {
      setError(null);

      if (creating === "file") {
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

  function handleInputKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleCreate();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelCreating();
    }
  }

  return (
    <aside className="project-explorer">
      <div className="panel-title">
        <span>PROJECT</span>

        {projectPath && (
          <div className="project-actions">
            <button
              type="button"
              className="project-action-button"
              title="New File"
              onClick={() =>
                startCreating("file")
              }
            >
              +
            </button>

            <button
              type="button"
              className="project-action-button folder-action"
              title="New Folder"
              onClick={() =>
                startCreating("folder")
              }
            >
              📁
            </button>
          </div>
        )}
      </div>

      <div className="project-name">
        {projectName}
      </div>

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
            onChange={(event) =>
              setNewName(event.target.value)
            }
            onKeyDown={handleInputKeyDown}
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
              onClick={cancelCreating}
            >
              Cancel
            </button>
          </div>

          {error && (
            <div className="create-item-error">
              {error}
            </div>
          )}
        </div>
      )}

      <FileTree
        entries={entries}
        onFileSelect={onFileSelect}
        onRefresh={onRefresh}
      />
    </aside>
  );
}

export default ProjectExplorer;