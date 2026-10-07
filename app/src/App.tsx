import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import Editor from "@monaco-editor/react";
import Terminal from "./components/Terminal/Terminal";

import "./App.css";

import ProjectExplorer from "./components/ProjectExplorer/ProjectExplorer";

/* =========================================================
 * Types
 * ======================================================= */

interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

interface EditorTab {
  file: FileEntry;
  content: string;
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;
}

type SaveStatus =
  | "saved"
  | "saving"
  | "error";

type BottomPanel =
  | "problems"
  | "terminal"
  | "tests"
  | "git"
  | "ai";

type IntelligenceSection =
  | "requirements"
  | "architecture"
  | "implementation"
  | "testing"
  | "deployment";

/* =========================================================
 * Language Detection
 * ======================================================= */

function getLanguageFromFileName(
  fileName: string,
): string {
  const lowerName =
    fileName.toLowerCase();

  if (lowerName === "dockerfile") {
    return "dockerfile";
  }

  const extension = lowerName
    .split(".")
    .pop();

  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";

    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";

    case "json":
      return "json";

    case "css":
      return "css";

    case "scss":
      return "scss";

    case "less":
      return "less";

    case "html":
    case "htm":
      return "html";

    case "xml":
      return "xml";

    case "md":
    case "markdown":
      return "markdown";

    case "py":
      return "python";

    case "java":
      return "java";

    case "c":
      return "c";

    case "cpp":
    case "cc":
    case "cxx":
    case "h":
    case "hpp":
      return "cpp";

    case "rs":
      return "rust";

    case "go":
      return "go";

    case "sql":
      return "sql";

    case "yaml":
    case "yml":
      return "yaml";

    case "sh":
    case "bash":
      return "shell";

    case "ps1":
      return "powershell";

    case "bat":
    case "cmd":
      return "bat";

    case "ini":
    case "toml":
      return "ini";

    default:
      return "plaintext";
  }
}

/* =========================================================
 * Application
 * ======================================================= */

function App() {
  /* -------------------------------------------------------
   * Project State
   * ----------------------------------------------------- */

  const [projectPath, setProjectPath] =
    useState<string | null>(null);

  const [entries, setEntries] =
    useState<FileEntry[]>([]);

  const [projectLoading, setProjectLoading] =
    useState(false);

  /* -------------------------------------------------------
   * Editor State
   * ----------------------------------------------------- */

  const [tabs, setTabs] =
    useState<EditorTab[]>([]);

  const [
    activeTabPath,
    setActiveTabPath,
  ] = useState<string | null>(null);

  const [saveStatus, setSaveStatus] =
    useState<SaveStatus>("saved");

  /* -------------------------------------------------------
   * Workspace Panels
   * ----------------------------------------------------- */

  const [
    activeBottomPanel,
    setActiveBottomPanel,
  ] = useState<BottomPanel | null>(null);

  const [
    intelligenceSection,
    setIntelligenceSection,
  ] =
    useState<IntelligenceSection>(
      "requirements",
    );

  /* =======================================================
   * Derived State
   * ===================================================== */

  const activeTab = useMemo(
    () =>
      tabs.find(
        (tab) =>
          tab.file.path ===
          activeTabPath,
      ) ?? null,
    [tabs, activeTabPath],
  );

  const dirtyTabs = useMemo(
    () =>
      tabs.filter(
        (tab) => tab.isDirty,
      ),
    [tabs],
  );

  const editorLanguage =
    activeTab
      ? getLanguageFromFileName(
          activeTab.file.name,
        )
      : "plaintext";

  /* =======================================================
   * Project Refresh
   * ===================================================== */

  const refreshProject =
    useCallback(async () => {
      if (!projectPath) {
        return;
      }

      try {
        const directoryEntries =
          await window.kryomcode.readDirectory(
            projectPath,
          );

        setEntries(directoryEntries);
      } catch (error) {
        console.error(
          "Failed to refresh project:",
          error,
        );

        setSaveStatus("error");
      }
    }, [projectPath]);

  /* =======================================================
   * Project Operations
   * ===================================================== */

  const openProject =
    useCallback(async () => {
      if (dirtyTabs.length > 0) {
        const shouldContinue =
          window.confirm(
            "You have unsaved files. Opening another project will discard those changes. Continue?",
          );

        if (!shouldContinue) {
          return;
        }
      }

      setProjectLoading(true);

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

        setTabs([]);
        setActiveTabPath(null);

        setSaveStatus("saved");
      } catch (error) {
        console.error(
          "Failed to open project:",
          error,
        );

        setSaveStatus("error");
      } finally {
        setProjectLoading(false);
      }
    }, [dirtyTabs]);

  /* =======================================================
   * File Operations
   * ===================================================== */

  const openFile =
    useCallback(
      async (file: FileEntry) => {
        if (file.type !== "file") {
          return;
        }

        const existingTab =
          tabs.find(
            (tab) =>
              tab.file.path ===
              file.path,
          );

        if (existingTab) {
          setActiveTabPath(
            file.path,
          );

          return;
        }

        const newTab: EditorTab = {
          file,
          content: "",
          isDirty: false,
          isLoading: true,
          error: null,
        };

        setTabs(
          (currentTabs) => [
            ...currentTabs,
            newTab,
          ],
        );

        setActiveTabPath(file.path);

        try {
          const content =
            await window.kryomcode.readFile(
              file.path,
            );

          setTabs(
            (currentTabs) =>
              currentTabs.map(
                (tab) =>
                  tab.file.path ===
                  file.path
                    ? {
                        ...tab,
                        content,
                        isDirty:
                          false,
                        isLoading:
                          false,
                        error:
                          null,
                      }
                    : tab,
              ),
          );
        } catch (error) {
          console.error(
            "Failed to read file:",
            error,
          );

          setTabs(
            (currentTabs) =>
              currentTabs.map(
                (tab) =>
                  tab.file.path ===
                  file.path
                    ? {
                        ...tab,
                        content: "",
                        isDirty:
                          false,
                        isLoading:
                          false,
                        error:
                          "Unable to read this file.",
                      }
                    : tab,
              ),
          );

          setSaveStatus("error");
        }
      },
      [tabs],
    );

  /* =======================================================
   * Editor Operations
   * ===================================================== */

  const updateActiveTabContent =
    useCallback(
      (content: string) => {
        if (!activeTabPath) {
          return;
        }

        setTabs(
          (currentTabs) =>
            currentTabs.map(
              (tab) =>
                tab.file.path ===
                activeTabPath
                  ? {
                      ...tab,
                      content,
                      isDirty: true,
                    }
                  : tab,
            ),
        );

        setSaveStatus("saved");
      },
      [activeTabPath],
    );

  /* =======================================================
   * Save
   * ===================================================== */

  const saveTab =
    useCallback(
      async (
        tab: EditorTab,
      ): Promise<boolean> => {
        if (!tab.isDirty) {
          return true;
        }

        setSaveStatus("saving");

        try {
          await window.kryomcode.writeFile(
            tab.file.path,
            tab.content,
          );

          setTabs(
            (currentTabs) =>
              currentTabs.map(
                (currentTab) =>
                  currentTab.file
                    .path ===
                  tab.file.path
                    ? {
                        ...currentTab,
                        isDirty:
                          false,
                      }
                    : currentTab,
              ),
          );

          setSaveStatus("saved");

          console.log(
            `Saved: ${tab.file.path}`,
          );

          return true;
        } catch (error) {
          console.error(
            "Failed to save file:",
            error,
          );

          setSaveStatus("error");

          return false;
        }
      },
      [],
    );

  const saveActiveFile =
    useCallback(async () => {
      if (!activeTab) {
        return;
      }

      await saveTab(activeTab);
    }, [activeTab, saveTab]);

  const saveAllFiles =
    useCallback(async () => {
      const filesToSave =
        tabs.filter(
          (tab) => tab.isDirty,
        );

      if (
        filesToSave.length === 0
      ) {
        return;
      }

      for (const tab of filesToSave) {
        const success =
          await saveTab(tab);

        if (!success) {
          break;
        }
      }
    }, [tabs, saveTab]);

  /* =======================================================
   * Tab Operations
   * ======================================================= */

  const activateTab =
    useCallback(
      (filePath: string) => {
        setActiveTabPath(filePath);
      },
      [],
    );

  const closeTab =
    useCallback(
      (filePath: string) => {
        const tabToClose =
          tabs.find(
            (tab) =>
              tab.file.path ===
              filePath,
          );

        if (!tabToClose) {
          return;
        }

        if (tabToClose.isDirty) {
          const shouldClose =
            window.confirm(
              `"${tabToClose.file.name}" has unsaved changes. Close without saving?`,
            );

          if (!shouldClose) {
            return;
          }
        }

        const closingIndex =
          tabs.findIndex(
            (tab) =>
              tab.file.path ===
              filePath,
          );

        const remainingTabs =
          tabs.filter(
            (tab) =>
              tab.file.path !==
              filePath,
          );

        setTabs(remainingTabs);

        if (
          activeTabPath !==
          filePath
        ) {
          return;
        }

        if (
          remainingTabs.length ===
          0
        ) {
          setActiveTabPath(null);

          return;
        }

        const nextIndex =
          Math.min(
            closingIndex,
            remainingTabs.length -
              1,
          );

        setActiveTabPath(
          remainingTabs[
            nextIndex
          ].file.path,
        );
      },
      [tabs, activeTabPath],
    );

  const closeActiveTab =
    useCallback(() => {
      if (!activeTabPath) {
        return;
      }

      closeTab(activeTabPath);
    }, [
      activeTabPath,
      closeTab,
    ]);

  /* =======================================================
   * Keyboard Shortcuts
   * ===================================================== */

  useEffect(() => {
    function handleKeyDown(
      event: KeyboardEvent,
    ) {
      const commandKey =
        event.ctrlKey ||
        event.metaKey;

      if (
        commandKey &&
        !event.shiftKey &&
        event.key.toLowerCase() ===
          "s"
      ) {
        event.preventDefault();

        void saveActiveFile();

        return;
      }

      if (
        commandKey &&
        event.shiftKey &&
        event.key.toLowerCase() ===
          "s"
      ) {
        event.preventDefault();

        void saveAllFiles();

        return;
      }

      if (
        commandKey &&
        event.key.toLowerCase() ===
          "w"
      ) {
        event.preventDefault();

        closeActiveTab();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    saveActiveFile,
    saveAllFiles,
    closeActiveTab,
  ]);

  /* =======================================================
   * Window Close Protection
   * ===================================================== */

  useEffect(() => {
    function handleBeforeUnload(
      event: BeforeUnloadEvent,
    ) {
      const hasUnsavedChanges =
        tabs.some(
          (tab) => tab.isDirty,
        );

      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener(
      "beforeunload",
      handleBeforeUnload,
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload,
      );
    };
  }, [tabs]);

  /* =======================================================
   * Temporary v0.1.0 Intelligence Actions
   * ===================================================== */

  function handleGenerateCode() {
    setActiveBottomPanel("ai");

    console.log(
      "Generate Code requested.",
    );
  }

  function handleAnalyzeProject() {
    setActiveBottomPanel("ai");

    console.log(
      "Analyze Project requested.",
    );
  }

  /* =======================================================
   * Render
   * ===================================================== */

  return (
    <div className="kryomcode">
      {/* ===================================================
       * TOP BAR
       * ================================================= */}

      <header className="topbar">
        <div className="brand">
          KRYOMCODE
        </div>

        <nav className="menu">
          <button
            type="button"
            onClick={() => {
              void openProject();
            }}
          >
            File
          </button>

          <button type="button">
            Edit
          </button>

          <button type="button">
            View
          </button>

          <button type="button">
            Project
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveBottomPanel(
                "ai",
              )
            }
          >
            AI
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveBottomPanel(
                "git",
              )
            }
          >
            GitHub
          </button>
        </nav>

        <div className="topbar-status">
          <span
            className={`status-dot ${
              saveStatus === "error"
                ? "error"
                : saveStatus ===
                    "saving"
                  ? "saving"
                  : ""
            }`}
          />

          {saveStatus ===
          "saving"
            ? "Saving..."
            : saveStatus ===
                "error"
              ? "Save Error"
              : dirtyTabs.length >
                    0
                ? `${dirtyTabs.length} Unsaved`
                : "Ready"}
        </div>
      </header>

      {/* ===================================================
       * MAIN WORKSPACE
       * ================================================= */}

      <main className="workspace">
        {/* PROJECT EXPLORER */}

        <ProjectExplorer
          projectPath={projectPath}
          entries={entries}
          onFileSelect={openFile}
          onRefresh={refreshProject}
        />

        {/* =================================================
         * EDITOR
         * =============================================== */}

        <section className="editor">
          {/* EDITOR TABS */}

          <div className="editor-tabs">
            {tabs.length === 0 ? (
              <div className="editor-tab active">
                <span className="editor-tab-name">
                  Welcome
                </span>
              </div>
            ) : (
              tabs.map((tab) => {
                const isActive =
                  tab.file.path ===
                  activeTabPath;

                return (
                  <div
                    key={
                      tab.file.path
                    }
                    className={`editor-tab ${
                      isActive
                        ? "active"
                        : ""
                    }`}
                    onClick={() =>
                      activateTab(
                        tab.file
                          .path,
                      )
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(
                      event,
                    ) => {
                      if (
                        event.key ===
                          "Enter" ||
                        event.key ===
                          " "
                      ) {
                        activateTab(
                          tab.file
                            .path,
                        );
                      }
                    }}
                  >
                    <span className="editor-tab-name">
                      {
                        tab.file
                          .name
                      }

                      {tab.isDirty && (
                        <span className="editor-dirty-indicator">
                          {" "}
                          ●
                        </span>
                      )}
                    </span>

                    <button
                      type="button"
                      className="editor-tab-close"
                      aria-label={`Close ${tab.file.name}`}
                      onClick={(
                        event,
                      ) => {
                        event.stopPropagation();

                        closeTab(
                          tab.file
                            .path,
                        );
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* EDITOR BODY */}

          <div className="editor-content">
            {!activeTab ? (
              <div className="welcome">
                <h1>
                  KryomCode
                </h1>

                <p>
                  AI-Native
                  Software
                  Engineering
                  Environment
                </p>

                <div className="welcome-actions">
                  <button
                    type="button"
                    onClick={() => {
                      void openProject();
                    }}
                    disabled={
                      projectLoading
                    }
                  >
                    {projectLoading
                      ? "Opening..."
                      : "Open Project"}
                  </button>

                  <button
                    type="button"
                    disabled
                    title="New Project will be implemented in a later milestone."
                  >
                    New Project
                  </button>
                </div>

                <div className="welcome-shortcuts">
                  <div>
                    <span>
                      Save
                    </span>

                    <kbd>
                      Ctrl+S
                    </kbd>
                  </div>

                  <div>
                    <span>
                      Save All
                    </span>

                    <kbd>
                      Ctrl+Shift+S
                    </kbd>
                  </div>

                  <div>
                    <span>
                      Close Tab
                    </span>

                    <kbd>
                      Ctrl+W
                    </kbd>
                  </div>
                </div>
              </div>
            ) : activeTab.isLoading ? (
              <div className="welcome">
                <h2>
                  Loading file...
                </h2>
              </div>
            ) : activeTab.error ? (
              <div className="welcome editor-error">
                <h2>
                  Unable to open
                  file
                </h2>

                <p>
                  {
                    activeTab.error
                  }
                </p>
              </div>
            ) : (
              <Editor
                key={
                  activeTab.file.path
                }
                height="100%"
                path={
                  activeTab.file.path
                }
                language={
                  editorLanguage
                }
                value={
                  activeTab.content
                }
                theme="vs-dark"
                onChange={(
                  value,
                ) => {
                  updateActiveTabContent(
                    value ?? "",
                  );
                }}
                options={{
                  automaticLayout:
                    true,

                  minimap: {
                    enabled: true,
                  },

                  fontSize: 14,

                  lineNumbers:
                    "on",

                  wordWrap: "off",

                  scrollBeyondLastLine:
                    false,

                  padding: {
                    top: 12,
                    bottom: 12,
                  },

                  tabSize: 2,

                  insertSpaces:
                    true,

                  renderWhitespace:
                    "selection",

                  smoothScrolling:
                    true,

                  cursorBlinking:
                    "smooth",

                  folding: true,

                  bracketPairColorization:
                    {
                      enabled:
                        true,
                    },

                  suggestOnTriggerCharacters:
                    true,

                  quickSuggestions:
                    true,

                  formatOnPaste:
                    true,

                  formatOnType:
                    true,

                  detectIndentation:
                    true,

                  stickyScroll: {
                    enabled:
                      true,
                  },
                }}
              />
            )}
          </div>
        </section>

        {/* =================================================
         * PROJECT INTELLIGENCE
         * =============================================== */}

        <aside className="planner">
          <div className="panel-title">
            PROJECT INTELLIGENCE
          </div>

          <div className="planner-section">
            <h3>
              Project Plan
            </h3>

            <button
              type="button"
              className={`plan-item ${
                intelligenceSection ===
                "requirements"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setIntelligenceSection(
                  "requirements",
                )
              }
            >
              ○ Requirements
            </button>

            <button
              type="button"
              className={`plan-item ${
                intelligenceSection ===
                "architecture"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setIntelligenceSection(
                  "architecture",
                )
              }
            >
              ○ Architecture
            </button>

            <button
              type="button"
              className={`plan-item ${
                intelligenceSection ===
                "implementation"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setIntelligenceSection(
                  "implementation",
                )
              }
            >
              ○ Implementation
            </button>

            <button
              type="button"
              className={`plan-item ${
                intelligenceSection ===
                "testing"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setIntelligenceSection(
                  "testing",
                )
              }
            >
              ○ Testing
            </button>

            <button
              type="button"
              className={`plan-item ${
                intelligenceSection ===
                "deployment"
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setIntelligenceSection(
                  "deployment",
                )
              }
            >
              ○ Deployment
            </button>
          </div>

          <div className="planner-section">
            <h3>
              AI Engine
            </h3>

            <button
              type="button"
              className="ai-button"
              onClick={
                handleGenerateCode
              }
            >
              ✦ Generate Code
            </button>

            <button
              type="button"
              className="ai-button secondary"
              onClick={
                handleAnalyzeProject
              }
            >
              Analyze Project
            </button>
          </div>

          <div className="planner-section">
            <h3>
              Current Stage
            </h3>

            <div className="intelligence-state">
              {
                intelligenceSection
              }
            </div>
          </div>
        </aside>
      </main>

      {/* ===================================================
       * BOTTOM PANEL
       * ================================================= */}

      {activeBottomPanel && (
        <section className="bottom-panel-content">
          <div className="bottom-panel-header">
            <strong>
              {activeBottomPanel.toUpperCase()}
            </strong>

            <button
              type="button"
              onClick={() =>
                setActiveBottomPanel(
                  null,
                )
              }
            >
              ×
            </button>
          </div>

          <div className="bottom-panel-body">
            {activeBottomPanel ===
              "problems" && (
              <div>
                No problems
                detected.
              </div>
            )}

            {activeBottomPanel ===
              "terminal" && (
              <Terminal
              projectPath={projectPath} />
            )}

            {activeBottomPanel ===
              "tests" && (
              <div>
                Test runner output
                will appear here.
              </div>
            )}

            {activeBottomPanel ===
              "git" && (
              <div>
                Git status,
                changes, branch and
                commit actions will
                appear here.
              </div>
            )}

            {activeBottomPanel ===
              "ai" && (
              <div>
                KryomCode AI
                activity will appear
                here.
              </div>
            )}
          </div>
        </section>
      )}

      {/* ===================================================
       * BOTTOM BAR
       * ================================================= */}

      <footer className="bottom-panel">
        <button
          type="button"
          className={
            activeBottomPanel ===
            "problems"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveBottomPanel(
              activeBottomPanel ===
                "problems"
                ? null
                : "problems",
            )
          }
        >
          Problems{" "}
          <strong>0</strong>
        </button>

        <button
          type="button"
          className={
            activeBottomPanel ===
            "terminal"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveBottomPanel(
              activeBottomPanel ===
                "terminal"
                ? null
                : "terminal",
            )
          }
        >
          Terminal
        </button>

        <button
          type="button"
          className={
            activeBottomPanel ===
            "tests"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveBottomPanel(
              activeBottomPanel ===
                "tests"
                ? null
                : "tests",
            )
          }
        >
          Tests
        </button>

        <button
          type="button"
          className={
            activeBottomPanel ===
            "git"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveBottomPanel(
              activeBottomPanel ===
                "git"
                ? null
                : "git",
            )
          }
        >
          Git
        </button>

        <button
          type="button"
          className={
            activeBottomPanel ===
            "ai"
              ? "active"
              : ""
          }
          onClick={() =>
            setActiveBottomPanel(
              activeBottomPanel ===
                "ai"
                ? null
                : "ai",
            )
          }
        >
          AI Activity
        </button>
      </footer>
    </div>
  );
}

export default App;