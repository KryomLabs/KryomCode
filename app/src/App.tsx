import { useState } from "react";
import "./App.css";
import ProjectExplorer from "./components/ProjectExplorer/ProjectExplorer";

interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  async function openProject() {
    setLoading(true);

    try {
      const selectedPath = await window.ingenia.selectProject();

      if (!selectedPath) {
        return;
      }

      const directoryEntries =
        await window.ingenia.readDirectory(selectedPath);

      setProjectPath(selectedPath);
      setEntries(directoryEntries);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ingenia">
      {/* TOP BAR */}
      <header className="topbar">
        <div className="brand">INGENIA</div>

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

      {/* MAIN WORKSPACE */}
      <main className="workspace">
        {/* PROJECT EXPLORER */}
        <ProjectExplorer
          projectPath={projectPath}
          entries={entries}
        />

        {/* CODE EDITOR */}
        <section className="editor">
          <div className="editor-tabs">
            <div className="editor-tab active">
              Welcome
            </div>
          </div>

          <div className="editor-content">
            <div className="welcome">
              <h1>Ingenia</h1>

              <p>
                AI-Native Software Engineering Environment
              </p>

              <div className="welcome-actions">
                <button
                  onClick={openProject}
                  disabled={loading}
                >
                  {loading ? "Opening..." : "Open Project"}
                </button>

                <button>
                  New Project
                </button>
              </div>
            </div>
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