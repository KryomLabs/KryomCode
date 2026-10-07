import { useState } from "react";
import "./App.css";
import ProjectExplorer from "./components/ProjectExplorer/ProjectExplorer";

interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

function App() {
  const [projectPath, setProjectPath] =
    useState<string | null>(null);

  const [entries, setEntries] =
    useState<FileEntry[]>([]);

  const [loading, setLoading] =
    useState(false);

  const [activeFile, setActiveFile] =
    useState<FileEntry | null>(null);

  const [fileContent, setFileContent] =
    useState("");

  const [fileLoading, setFileLoading] =
    useState(false);

  async function openProject() {
    setLoading(true);

    try {
      const selectedPath =
        await window.kryomcode.selectProject();

      if (!selectedPath) {
        return;
      }

      const directoryEntries =
        await window.kryomcode.readDirectory(
          selectedPath,
        );

      setProjectPath(selectedPath);
      setEntries(directoryEntries);
      setActiveFile(null);
      setFileContent("");
    } finally {
      setLoading(false);
    }
  }

  async function openFile(file: FileEntry) {
    setFileLoading(true);

    try {
      const content =
        await window.kryomcode.readFile(
          file.path,
        );

      setActiveFile(file);
      setFileContent(content);
    } catch (error) {
      console.error(
        "Failed to read file:",
        error,
      );

      setActiveFile(file);
      setFileContent(
        "Unable to read this file.",
      );
    } finally {
      setFileLoading(false);
    }
  }

  return (
    <div className="kryomcode">
      {/* TOP BAR */}

      <header className="topbar">
        <div className="brand">
          KRYOMCODE
        </div>

        <nav className="menu">
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>Project</span>
          <span>AI</span>
          <span>GitHub</span>
        </nav>

        <div className="topbar-status">
          <span className="status-dot" />
          Ready
        </div>
      </header>

      {/* WORKSPACE */}

      <main className="workspace">
        <ProjectExplorer
          projectPath={projectPath}
          entries={entries}
          onFileSelect={openFile}
        />

        {/* EDITOR */}

        <section className="editor">
          <div className="editor-tabs">
            <div className="editor-tab active">
              {activeFile
                ? activeFile.name
                : "Welcome"}
            </div>
          </div>

          <div className="editor-content">
            {fileLoading ? (
              <div className="welcome">
                <h2>Loading file...</h2>
              </div>
            ) : activeFile ? (
              <pre className="code-preview">
                {fileContent}
              </pre>
            ) : (
              <div className="welcome">
                <h1>KryomCode</h1>

                <p>
                  AI-Native Software Engineering Environment
                </p>

                <div className="welcome-actions">
                  <button
                    onClick={openProject}
                    disabled={loading}
                  >
                    {loading
                      ? "Opening..."
                      : "Open Project"}
                  </button>

                  <button>
                    New Project
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* PROJECT INTELLIGENCE */}

        <aside className="planner">
          <div className="panel-title">
            PROJECT INTELLIGENCE
          </div>

          <div className="planner-section">
            <h3>Project Plan</h3>

            <div className="plan-item">
              ○ Requirements
            </div>

            <div className="plan-item">
              ○ Architecture
            </div>

            <div className="plan-item">
              ○ Implementation
            </div>

            <div className="plan-item">
              ○ Testing
            </div>

            <div className="plan-item">
              ○ Deployment
            </div>
          </div>

          <div className="planner-section">
            <h3>AI Engine</h3>

            <button className="ai-button">
              ✦ Generate Code
            </button>

            <button className="ai-button secondary">
              Analyze Project
            </button>
          </div>
        </aside>
      </main>

      {/* BOTTOM PANEL */}

      <footer className="bottom-panel">
        <div>
          Problems <strong>0</strong>
        </div>

        <div>Terminal</div>

        <div>Tests</div>

        <div>Git</div>

        <div>AI Activity</div>
      </footer>
    </div>
  );
}

export default App;