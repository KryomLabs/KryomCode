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
}

function ProjectExplorer({
  projectPath,
  entries,
  onFileSelect,
}: ProjectExplorerProps) {
  const projectName = projectPath
    ? projectPath.split("\\").pop() ?? "Project"
    : "No Project";

  return (
    <aside className="project-explorer">
      <div className="panel-title">
        PROJECT
      </div>

      <div className="project-name">
        {projectName}
      </div>

      <FileTree
        entries={entries}
        onFileSelect={onFileSelect}
      />
    </aside>
  );
}

export default ProjectExplorer;