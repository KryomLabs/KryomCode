import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import Editor, { type OnMount } from "@monaco-editor/react";

import ProjectExplorer from "./components/ProjectExplorer/ProjectExplorer";
import Problems from "./components/Problems/Problems";
import Terminal from "./components/Terminal/Terminal";

import "./App.css";

type Problem = Parameters<typeof Problems>[0]["problems"][number];

type BottomPanel = "problems" | "terminal" | "tests" | "git" | "ai";

type IntelligenceSection =
  | "requirements"
  | "architecture"
  | "implementation"
  | "testing"
  | "deployment";

type MaximizedPanel =
  | "explorer"
  | "editor"
  | "intelligence"
  | BottomPanel
  | null;

type ResizeTarget = "explorer" | "intelligence" | "bottom" | null;

type EditorTab = {
  path: string;
  name: string;
  content: string;
  savedContent: string;
};

type ProblemLocation = {
  path: string;
  line: number;
  column: number;
};

type ProjectEntry = Awaited<
  ReturnType<typeof window.kryomcode.readDirectory>
>[number];

const MIN_EXPLORER_WIDTH = 170;
const MAX_EXPLORER_WIDTH = 480;

const MIN_INTELLIGENCE_WIDTH = 250;
const MAX_INTELLIGENCE_WIDTH = 560;

const MIN_BOTTOM_HEIGHT = 150;
const MAX_BOTTOM_HEIGHT = 650;

const DEFAULT_EXPLORER_WIDTH = 250;
const DEFAULT_INTELLIGENCE_WIDTH = 340;
const DEFAULT_BOTTOM_HEIGHT = 245;

const INTELLIGENCE_SECTIONS: {
  id: IntelligenceSection;
  label: string;
  icon: string;
}[] = [
  { id: "requirements", label: "Requirements", icon: "◈" },
  { id: "architecture", label: "Architecture", icon: "⌘" },
  { id: "implementation", label: "Implementation", icon: "⌁" },
  { id: "testing", label: "Testing", icon: "✓" },
  { id: "deployment", label: "Deployment", icon: "⇧" },
];

function getFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function getLanguage(path: string): string {
  const fileName = getFileName(path);
  const extension = fileName.includes(".")
    ? fileName.split(".").pop()?.toLowerCase()
    : "";

  const languages: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    jsonc: "json",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    less: "less",
    md: "markdown",
    mdx: "markdown",
    py: "python",
    java: "java",
    c: "c",
    h: "cpp",
    cc: "cpp",
    cpp: "cpp",
    hpp: "cpp",
    cs: "csharp",
    go: "go",
    rs: "rust",
    php: "php",
    rb: "ruby",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yml: "yaml",
    yaml: "yaml",
    xml: "xml",
    svg: "xml",
    toml: "ini",
    ini: "ini",
    env: "ini",
    dockerfile: "dockerfile",
    graphql: "graphql",
    gql: "graphql",
    kt: "kotlin",
    swift: "swift",
    dart: "dart",
    lua: "lua",
    r: "r",
    ipynb: "json",
  };

  if (fileName.toLowerCase() === "dockerfile") {
    return "dockerfile";
  }

  return languages[extension ?? ""] ?? "plaintext";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function App() {
  const [projectPath, setProjectPath] = useState("");

  const [entries, setEntries] = useState<ProjectEntry[]>([]);

  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState("");

  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState("");

  const [saveStatus, setSaveStatus] = useState("Ready");

  // Keep Monaco's cursor position in React state so the status bar does not
  // read a mutable ref during render.
  const [cursorPosition, setCursorPosition] = useState({
    lineNumber: 1,
    column: 1,
  });

  const [activeBottomPanel, setActiveBottomPanel] =
    useState<BottomPanel>("terminal");

  const [bottomPanelVisible, setBottomPanelVisible] = useState(true);

  const [problems] = useState<Problem[]>([]);

  const [pendingProblemLocation, setPendingProblemLocation] =
    useState<ProblemLocation | null>(null);

  const [intelligenceSection, setIntelligenceSection] =
    useState<IntelligenceSection>("requirements");

  const [explorerWidth, setExplorerWidth] = useState(
    DEFAULT_EXPLORER_WIDTH,
  );

  const [intelligenceWidth, setIntelligenceWidth] = useState(
    DEFAULT_INTELLIGENCE_WIDTH,
  );

  const [bottomPanelHeight, setBottomPanelHeight] = useState(
    DEFAULT_BOTTOM_HEIGHT,
  );

  const [resizeTarget, setResizeTarget] = useState<ResizeTarget>(null);

  const [maximizedPanel, setMaximizedPanel] =
    useState<MaximizedPanel>(null);

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const openRequestsRef = useRef(new Map<string, Promise<void>>());

  const mountedRef = useRef(true);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activeTabPath) ?? null,
    [tabs, activeTabPath],
  );

  const dirtyTabCount = useMemo(
    () => tabs.filter((tab) => tab.content !== tab.savedContent).length,
    [tabs],
  );

  const isDirty = useCallback((tab: EditorTab) => {
    return tab.content !== tab.savedContent;
  }, []);

  const confirmDiscardChanges = useCallback(() => {
    if (tabs.every((tab) => !isDirty(tab))) {
      return true;
    }

    return window.confirm(
      "You have unsaved changes. Continue and discard those changes?",
    );
  }, [tabs, isDirty]);

  // ---------------------------------------------------------
  // Project operations
  // ---------------------------------------------------------

  const refreshProject = useCallback(async () => {
    if (!projectPath) {
      setProjectError("Open a project before refreshing the workspace.");
      return;
    }

    try {
      setProjectLoading(true);
      setProjectError("");

      const result = await window.kryomcode.readDirectory(projectPath);

      if (!mountedRef.current) return;

      setEntries(result);
      setSaveStatus("Workspace refreshed");
    } catch (error) {
      if (!mountedRef.current) return;

      setProjectError(
        `Could not refresh project: ${getErrorMessage(error)}`,
      );

      setSaveStatus("Refresh failed");
    } finally {
      if (mountedRef.current) {
        setProjectLoading(false);
      }
    }
  }, [projectPath]);

  const openProject = useCallback(async () => {
    try {
      setProjectError("");

      const selectedPath = await window.kryomcode.selectProject();

      if (!selectedPath) {
        return;
      }

      if (!confirmDiscardChanges()) {
        return;
      }

      setProjectLoading(true);
      setSaveStatus("Opening project…");

      const result = await window.kryomcode.readDirectory(selectedPath);

      if (!mountedRef.current) return;

      setProjectPath(selectedPath);
      setEntries(result);
      setTabs([]);
      setActiveTabPath("");
      setPendingProblemLocation(null);
      setMaximizedPanel(null);

      setSaveStatus("Project opened");
    } catch (error) {
      if (!mountedRef.current) return;

      setProjectError(
        `Could not open project: ${getErrorMessage(error)}`,
      );

      setSaveStatus("Open failed");
    } finally {
      if (mountedRef.current) {
        setProjectLoading(false);
      }
    }
  }, [confirmDiscardChanges]);

  // ---------------------------------------------------------
  // File operations
  // ---------------------------------------------------------

  const openFile = useCallback(
    async (path: string) => {
      if (!path) return;

      const existingTab = tabs.find((tab) => tab.path === path);

      if (existingTab) {
        setActiveTabPath(path);
        setProjectError("");
        return;
      }

      const existingRequest = openRequestsRef.current.get(path);

      if (existingRequest) {
        await existingRequest;
        setActiveTabPath(path);
        return;
      }

      setSaveStatus("Opening file…");
      setProjectError("");

      const request = (async () => {
        try {
          const content = await window.kryomcode.readFile(path);

          if (!mountedRef.current) return;

          const newTab: EditorTab = {
            path,
            name: getFileName(path),
            content,
            savedContent: content,
          };

          setTabs((currentTabs) => {
            const alreadyOpen = currentTabs.some(
              (tab) => tab.path === path,
            );

            if (alreadyOpen) {
              return currentTabs;
            }

            return [...currentTabs, newTab];
          });

          setActiveTabPath(path);
          setSaveStatus("Ready");
        } catch (error) {
          if (!mountedRef.current) return;

          setSaveStatus("Open failed");

          setProjectError(
            `Could not open file: ${getErrorMessage(error)}`,
          );
        } finally {
          openRequestsRef.current.delete(path);
        }
      })();

      openRequestsRef.current.set(path, request);

      await request;
    },
    [tabs],
  );

  const updateActiveContent = useCallback(
    (content: string | undefined) => {
      if (!activeTabPath) return;

      const nextContent = content ?? "";

      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.path === activeTabPath
            ? { ...tab, content: nextContent }
            : tab,
        ),
      );

      setSaveStatus("Unsaved changes");
    },
    [activeTabPath],
  );

  const saveTab = useCallback(
    async (path: string) => {
      const tab = tabs.find((item) => item.path === path);

      if (!tab) return;

      if (!isDirty(tab)) {
        setSaveStatus("All changes saved");
        return;
      }

      // Capture the exact content being written.
      // If the user keeps typing while saving, newer edits remain unsaved.
      const contentBeingSaved = tab.content;

      try {
        setProjectError("");
        setSaveStatus("Saving…");

        await window.kryomcode.writeFile(path, contentBeingSaved);

        if (!mountedRef.current) return;

        setTabs((currentTabs) =>
          currentTabs.map((item) => {
            if (item.path !== path) {
              return item;
            }

            return {
              ...item,
              savedContent: contentBeingSaved,
            };
          }),
        );

        setSaveStatus("Saved");
      } catch (error) {
        if (!mountedRef.current) return;

        setSaveStatus("Save failed");

        setProjectError(
          `Could not save file: ${getErrorMessage(error)}`,
        );
      }
    },
    [tabs, isDirty],
  );

  const saveAll = useCallback(async () => {
    const unsavedPaths = tabs
      .filter(isDirty)
      .map((tab) => tab.path);

    if (unsavedPaths.length === 0) {
      setSaveStatus("All changes saved");
      return;
    }

    setSaveStatus("Saving all files…");

    for (const path of unsavedPaths) {
      if (!mountedRef.current) return;

      await saveTab(path);
    }

    if (!mountedRef.current) return;

    setTabs((currentTabs) => {
      const hasUnsavedChanges = currentTabs.some(
        (tab) => tab.content !== tab.savedContent,
      );

      if (!hasUnsavedChanges) {
        setSaveStatus("All changes saved");
      }

      return currentTabs;
    });
  }, [tabs, isDirty, saveTab]);

  const closeTab = useCallback(
    (path: string) => {
      const tab = tabs.find((item) => item.path === path);

      if (!tab) return;

      if (isDirty(tab)) {
        const shouldClose = window.confirm(
          `${tab.name} has unsaved changes. Close without saving?`,
        );

        if (!shouldClose) return;
      }

      const currentIndex = tabs.findIndex((item) => item.path === path);

      const remainingTabs = tabs.filter((item) => item.path !== path);

      setTabs(remainingTabs);

      if (activeTabPath === path) {
        const nextIndex = Math.min(
          currentIndex,
          remainingTabs.length - 1,
        );

        const nextTab = remainingTabs[nextIndex];

        setActiveTabPath(nextTab?.path ?? "");
      }
    },
    [tabs, activeTabPath, isDirty],
  );

  const closeActiveTab = useCallback(() => {
    if (activeTabPath) {
      closeTab(activeTabPath);
    }
  }, [activeTabPath, closeTab]);

  // ---------------------------------------------------------
  // Editor operations
  // ---------------------------------------------------------

  const handleProblemClick = useCallback(
    (problem: Problem) => {
      const item = problem as Problem & {
        filePath?: string;
        path?: string;
        file?: string;
        line?: number;
        column?: number;
      };

      const path = item.filePath ?? item.path ?? item.file;

      if (!path) return;

      const location: ProblemLocation = {
        path,
        line: Math.max(1, item.line ?? 1),
        column: Math.max(1, item.column ?? 1),
      };

      setPendingProblemLocation(location);

      void openFile(path);
    },
    [openFile],
  );

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;

    const updateCursorPosition = () => {
      const position = editor.getPosition();

      if (!position) return;

      setCursorPosition({
        lineNumber: position.lineNumber,
        column: position.column,
      });
    };

    // Initialize the status bar and keep it synchronized with cursor movement.
    updateCursorPosition();
    editor.onDidChangeCursorPosition(updateCursorPosition);
  }, []);

  useEffect(() => {
    if (!pendingProblemLocation || !activeTab) return;

    if (activeTab.path !== pendingProblemLocation.path) return;

    const editor = editorRef.current;

    if (!editor) return;

    editor.revealLineInCenter(pendingProblemLocation.line);

    editor.setPosition({
      lineNumber: pendingProblemLocation.line,
      column: pendingProblemLocation.column,
    });

    editor.focus();

    setPendingProblemLocation(null);
  }, [pendingProblemLocation, activeTab]);

  // ---------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");

      const modifier = isMac ? event.metaKey : event.ctrlKey;

      if (!modifier) return;

      const key = event.key.toLowerCase();

      if (key === "s") {
        event.preventDefault();

        if (event.shiftKey) {
          void saveAll();
        } else if (activeTabPath) {
          void saveTab(activeTabPath);
        }

        return;
      }

      if (key === "w") {
        event.preventDefault();
        closeActiveTab();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTabPath, saveTab, saveAll, closeActiveTab]);

  // Warn before leaving the application with unsaved changes.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasUnsavedChanges = tabs.some(
        (tab) => tab.content !== tab.savedContent,
      );

      if (!hasUnsavedChanges) return;

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [tabs]);

  // ---------------------------------------------------------
  // Resizable panels
  // ---------------------------------------------------------

  useEffect(() => {
    if (!resizeTarget) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (resizeTarget === "explorer") {
        setExplorerWidth(
          clamp(
            event.clientX,
            MIN_EXPLORER_WIDTH,
            MAX_EXPLORER_WIDTH,
          ),
        );
      }

      if (resizeTarget === "intelligence") {
        setIntelligenceWidth(
          clamp(
            window.innerWidth - event.clientX,
            MIN_INTELLIGENCE_WIDTH,
            MAX_INTELLIGENCE_WIDTH,
          ),
        );
      }

      if (resizeTarget === "bottom") {
        setBottomPanelHeight(
          clamp(
            window.innerHeight - event.clientY - 34,
            MIN_BOTTOM_HEIGHT,
            MAX_BOTTOM_HEIGHT,
          ),
        );
      }
    };

    const handlePointerUp = () => {
      setResizeTarget(null);
    };

    document.body.classList.add("kryomcode-resizing");

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.classList.remove("kryomcode-resizing");

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizeTarget]);

  useEffect(() => {
    if (!maximizedPanel) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMaximizedPanel(null);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [maximizedPanel]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 600) {
        setExplorerWidth((width) =>
          Math.min(width, MIN_EXPLORER_WIDTH),
        );

        setIntelligenceWidth((width) =>
          Math.min(width, MIN_INTELLIGENCE_WIDTH),
        );
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const beginResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    target: Exclude<ResizeTarget, null>,
  ) => {
    event.preventDefault();
    setResizeTarget(target);
  };

  const toggleMaximize = (panel: Exclude<MaximizedPanel, null>) => {
    setMaximizedPanel((current) =>
      current === panel ? null : panel,
    );
  };

  const showBottomPanel = (panel: BottomPanel) => {
    setActiveBottomPanel(panel);
    setBottomPanelVisible(true);

    setMaximizedPanel((current) =>
      current === panel ? null : current,
    );
  };

  const handleAiAction = (message: string) => {
    setActiveBottomPanel("ai");
    setBottomPanelVisible(true);
    setSaveStatus(message);
  };

  // ---------------------------------------------------------
  // Derived UI state
  // ---------------------------------------------------------

  const activeSection = INTELLIGENCE_SECTIONS.find(
    (section) => section.id === intelligenceSection,
  );

  const isExplorerMaximized = maximizedPanel === "explorer";
  const isEditorMaximized = maximizedPanel === "editor";

  const isIntelligenceMaximized =
    maximizedPanel === "intelligence";

  const isBottomMaximized =
    maximizedPanel === "problems" ||
    maximizedPanel === "terminal" ||
    maximizedPanel === "tests" ||
    maximizedPanel === "git" ||
    maximizedPanel === "ai";

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------

  return (
    <div
      className={`kryomcode ${
        maximizedPanel ? "has-maximized-panel" : ""
      }`}
      style={
        {
          "--explorer-width": `${explorerWidth}px`,
          "--intelligence-width": `${intelligenceWidth}px`,
          "--bottom-panel-height": `${bottomPanelHeight}px`,
        } as CSSProperties
      }
    >
      {/* Top application bar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span>⬡</span>
          </div>

          <span className="brand-name">KryomCode</span>
        </div>

        <nav className="menubar" aria-label="Main menu">
          <button type="button" onClick={() => void openProject()}>
            File
          </button>

          <button
            type="button"
            onClick={() => setSaveStatus("Edit menu")}
          >
            Edit
          </button>

          <button
            type="button"
            onClick={() => setSaveStatus("Selection menu")}
          >
            Selection
          </button>

          <button
            type="button"
            onClick={() => setSaveStatus("View menu")}
          >
            View
          </button>

          <button
            type="button"
            onClick={() => setSaveStatus("Go menu")}
          >
            Go
          </button>

          <button
            type="button"
            onClick={() => setSaveStatus("Run configuration not set")}
          >
            Run
          </button>

          <button
            type="button"
            onClick={() => showBottomPanel("terminal")}
          >
            Terminal
          </button>

          <button
            type="button"
            onClick={() => setSaveStatus("Help menu")}
          >
            Help
          </button>
        </nav>

        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Restore panel layout"
            title="Restore panels"
            onClick={() => setMaximizedPanel(null)}
          >
            −
          </button>

          <button
            type="button"
            className="icon-button"
            aria-label="Restore panels"
            title="Restore panels"
            onClick={() => setMaximizedPanel(null)}
          >
            □
          </button>
        </div>
      </header>

      {/* Activity bar */}
      <div className="activity-bar" aria-label="Activity bar">
        <button
          type="button"
          className={`activity-icon ${
            isExplorerMaximized ? "active" : ""
          }`}
          title="Explorer"
          aria-label="Explorer"
          onClick={() => toggleMaximize("explorer")}
        >
          ◫
        </button>

        <button
          type="button"
          className={`activity-icon ${
            isEditorMaximized ? "active" : ""
          }`}
          title="Editor"
          aria-label="Editor"
          onClick={() => toggleMaximize("editor")}
        >
          ⬡
        </button>

        <button
          type="button"
          className="activity-icon"
          title="Open project"
          aria-label="Open project"
          onClick={() => void openProject()}
        >
          ▰
        </button>

        <button
          type="button"
          className={`activity-icon ${
            activeBottomPanel === "git" && bottomPanelVisible
              ? "active"
              : ""
          }`}
          title="Git"
          aria-label="Git"
          onClick={() => showBottomPanel("git")}
        >
          ⑂
        </button>

        <button
          type="button"
          className={`activity-icon ${
            activeBottomPanel === "ai" && bottomPanelVisible
              ? "active"
              : ""
          }`}
          title="AI Activity"
          aria-label="AI Activity"
          onClick={() => showBottomPanel("ai")}
        >
          ✧
        </button>

        <button
          type="button"
          className={`activity-icon ${
            activeBottomPanel === "tests" && bottomPanelVisible
              ? "active"
              : ""
          }`}
          title="Tests"
          aria-label="Tests"
          onClick={() => showBottomPanel("tests")}
        >
          ✓
        </button>

        <div className="activity-spacer" />

        <button
          type="button"
          className="activity-icon"
          title="Settings"
          aria-label="Settings"
          onClick={() => setSaveStatus("Settings")}
        >
          ⚙
        </button>
      </div>

      {/* Main workspace */}
      <main
        className={`workspace ${
          bottomPanelVisible
            ? "bottom-panel-open"
            : "bottom-panel-closed"
        }`}
      >
        {/* Project Explorer */}
        <aside
          className={`explorer-shell ${
            isExplorerMaximized ? "panel-maximized" : ""
          }`}
          style={{
            width: isExplorerMaximized
              ? undefined
              : explorerWidth,
          }}
        >
          <div className="panel-floating-actions">
            <button
              type="button"
              className="panel-action-button"
              title={
                isExplorerMaximized
                  ? "Restore Explorer"
                  : "Maximize Explorer"
              }
              aria-label={
                isExplorerMaximized
                  ? "Restore Explorer"
                  : "Maximize Explorer"
              }
              onClick={() => toggleMaximize("explorer")}
            >
              {isExplorerMaximized ? "❐" : "□"}
            </button>
          </div>

          <ProjectExplorer
            projectPath={projectPath}
            entries={entries}
            onFileSelect={(file) => {
              void openFile(file.path);
            }}
            onRefresh={() => void refreshProject()}
          />
        </aside>

        {!isExplorerMaximized && !isEditorMaximized && (
          <div
            className="resize-handle resize-handle-vertical explorer-resize-handle"
            role="separator"
            aria-label="Resize Project Explorer"
            aria-orientation="vertical"
            onPointerDown={(event) =>
              beginResize(event, "explorer")
            }
          />
        )}

        {/* Code Editor */}
        <section
          className={`editor ${
            isEditorMaximized ? "panel-maximized" : ""
          }`}
        >
          <div className="editor-tabs">
            <button
              type="button"
              className={`editor-tab welcome-tab ${
                !activeTab ? "active" : ""
              }`}
              onClick={() => setActiveTabPath("")}
            >
              Welcome
            </button>

            {tabs.map((tab) => (
              <div
                className={`editor-tab ${
                  activeTabPath === tab.path ? "active" : ""
                }`}
                key={tab.path}
              >
                <button
                  type="button"
                  className="editor-tab-select"
                  onClick={() => setActiveTabPath(tab.path)}
                  title={tab.path}
                >
                  {isDirty(tab) && (
                    <span className="dirty-indicator">●</span>
                  )}

                  <span>{tab.name}</span>
                </button>

                <button
                  type="button"
                  className="editor-tab-close"
                  aria-label={`Close ${tab.name}`}
                  title="Close tab"
                  onClick={() => closeTab(tab.path)}
                >
                  ×
                </button>
              </div>
            ))}

            <div className="editor-tabs-spacer" />

            <button
              type="button"
              className="panel-action-button"
              title={
                isEditorMaximized
                  ? "Restore Editor"
                  : "Maximize Editor"
              }
              aria-label={
                isEditorMaximized
                  ? "Restore Editor"
                  : "Maximize Editor"
              }
              onClick={() => toggleMaximize("editor")}
            >
              {isEditorMaximized ? "❐" : "□"}
            </button>
          </div>

          {projectError && (
            <div className="app-notice error-notice" role="alert">
              <span>{projectError}</span>

              <button
                type="button"
                onClick={() => setProjectError("")}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {activeTab ? (
            <div className="monaco-container">
              <div className="editor-breadcrumb">
                <span>
                  {projectPath
                    ? getFileName(projectPath)
                    : "Project"}
                </span>

                <span className="breadcrumb-separator">›</span>

                <span>{activeTab.name}</span>

                {isDirty(activeTab) && (
                  <span className="unsaved-label">Unsaved</span>
                )}
              </div>

              <Editor
                height="100%"
                path={activeTab.path}
                language={getLanguage(activeTab.path)}
                value={activeTab.content}
                onChange={updateActiveContent}
                onMount={handleEditorMount}
                theme="vs-dark"
                options={{
                  automaticLayout: true,
                  minimap: { enabled: true },
                  fontSize: 13,
                  fontFamily: 'Consolas, "Courier New", monospace',
                  fontLigatures: true,
                  tabSize: 2,
                  wordWrap: "off",
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  cursorBlinking: "smooth",
                  padding: { top: 12 },
                  renderLineHighlight: "all",
                  bracketPairColorization: { enabled: true },
                  guides: {
                    indentation: true,
                    bracketPairs: true,
                  },
                }}
              />
            </div>
          ) : (
            <div className="welcome-screen">
              <div className="welcome-content">
                <div className="welcome-eyebrow">
                  <span className="welcome-dot" />
                  YOUR AI-POWERED WORKSPACE
                </div>

                <h1>From Idea to Working Software</h1>

                <p className="welcome-description">
                  KryomCode helps you build, iterate, and ship — guided
                  by your AI engineering partner.
                </p>

                {!projectPath && (
                  <div className="welcome-project-prompt">
                    Open an existing project to get started, or choose a
                    folder from your computer.
                  </div>
                )}

                <div className="welcome-actions">
                  <button
                    type="button"
                    className="welcome-card"
                    onClick={() => void openProject()}
                  >
                    <span className="welcome-card-icon">✧</span>

                    <span className="welcome-card-copy">
                      <strong>Open Project</strong>
                      <small>Open a local project folder</small>
                    </span>

                    <span className="welcome-card-arrow">↗</span>
                  </button>

                  <button
                    type="button"
                    className="welcome-card"
                    onClick={() =>
                      handleAiAction(
                        "Describe the project you want to create",
                      )
                    }
                  >
                    <span className="welcome-card-icon">◈</span>

                    <span className="welcome-card-copy">
                      <strong>Create New Project</strong>
                      <small>Start planning a new application</small>
                    </span>

                    <span className="welcome-card-arrow">↗</span>
                  </button>

                  <button
                    type="button"
                    className="welcome-card"
                    onClick={() =>
                      setSaveStatus(
                        "Select a project folder before creating files",
                      )
                    }
                  >
                    <span className="welcome-card-icon">＋</span>

                    <span className="welcome-card-copy">
                      <strong>New File</strong>
                      <small>Create a file in your project</small>
                    </span>

                    <span className="welcome-card-arrow">↗</span>
                  </button>

                  <button
                    type="button"
                    className="welcome-card"
                    onClick={() => showBottomPanel("terminal")}
                  >
                    <span className="welcome-card-icon">ϟ</span>

                    <span className="welcome-card-copy">
                      <strong>Run &amp; Debug</strong>
                      <small>Open your integrated terminal</small>
                    </span>

                    <span className="welcome-card-arrow">↗</span>
                  </button>
                </div>

                <div className="recent-projects">
                  <div className="section-heading">
                    <span>Workspace</span>

                    <button
                      type="button"
                      onClick={() => void openProject()}
                    >
                      Open folder
                    </button>
                  </div>

                  {projectPath ? (
                    <button
                      type="button"
                      className="recent-project-row"
                      onClick={() => void refreshProject()}
                    >
                      <span className="recent-project-icon">▰</span>

                      <span className="recent-project-copy">
                        <strong>{getFileName(projectPath)}</strong>
                        <small>{projectPath}</small>
                      </span>

                      <span className="recent-project-open">↗</span>
                    </button>
                  ) : (
                    <div className="empty-workspace">
                      <span className="empty-workspace-icon">▱</span>
                      <span>No project is open yet</span>
                    </div>
                  )}

                  {projectLoading && (
                    <div className="loading-message">
                      Loading project…
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {!isExplorerMaximized && !isEditorMaximized && (
          <div
            className="resize-handle resize-handle-vertical intelligence-resize-handle"
            role="separator"
            aria-label="Resize Project Intelligence"
            aria-orientation="vertical"
            onPointerDown={(event) =>
              beginResize(event, "intelligence")
            }
          />
        )}

        {/* Project Intelligence */}
        <aside
          className={`planner ${
            isIntelligenceMaximized ? "panel-maximized" : ""
          }`}
          style={{
            width: isIntelligenceMaximized
              ? undefined
              : intelligenceWidth,
          }}
        >
          <div className="planner-header">
            <div className="planner-title">
              <span className="ai-logo">✧</span>

              <div>
                <strong>Project Intelligence</strong>
                <small>AI engineering partner</small>
              </div>
            </div>

            <div className="planner-header-actions">
              <button
                type="button"
                className="panel-action-button"
                title={
                  isIntelligenceMaximized
                    ? "Restore Project Intelligence"
                    : "Maximize Project Intelligence"
                }
                aria-label={
                  isIntelligenceMaximized
                    ? "Restore Project Intelligence"
                    : "Maximize Project Intelligence"
                }
                onClick={() => toggleMaximize("intelligence")}
              >
                {isIntelligenceMaximized ? "❐" : "□"}
              </button>

              <button
                type="button"
                className="panel-action-button"
                title="Open AI Activity"
                aria-label="Open AI Activity"
                onClick={() => showBottomPanel("ai")}
              >
                ⋯
              </button>
            </div>
          </div>

          <div className="planner-content">
            <section className="intelligence-summary">
              <div className="intelligence-status">
                <span className="status-pulse" />
                PROJECT OVERVIEW
              </div>

              <h2>
                {projectPath
                  ? getFileName(projectPath)
                  : "Your project"}
              </h2>

              <p>
                {projectPath
                  ? "Your workspace is ready. Explore your files, review project structure, and use AI Activity to plan your next implementation step."
                  : "Open a project to start exploring its structure and planning implementation with your AI engineering partner."}
              </p>
            </section>

            <section className="planner-section">
              <div className="planner-section-heading">
                <span className="section-heading-icon">☷</span>
                <strong>Engineering Plan</strong>
              </div>

              <div className="intelligence-navigation">
                {INTELLIGENCE_SECTIONS.map((section, index) => (
                  <button
                    type="button"
                    key={section.id}
                    className={`intelligence-nav-item ${
                      intelligenceSection === section.id
                        ? "active"
                        : ""
                    }`}
                    onClick={() =>
                      setIntelligenceSection(section.id)
                    }
                  >
                    <span className="intelligence-nav-icon">
                      {section.icon}
                    </span>

                    <span className="intelligence-nav-label">
                      <span className="intelligence-nav-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>

                      {section.label}
                    </span>

                    <span className="intelligence-nav-chevron">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="planner-section">
              <div className="planner-section-heading">
                <span className="section-heading-icon">▤</span>
                <strong>Current Focus</strong>
              </div>

              <div className="focus-card">
                <span className="focus-card-icon">
                  {activeSection?.icon ?? "◈"}
                </span>

                <div>
                  <strong>
                    {activeSection?.label ?? "Requirements"}
                  </strong>

                  <p>
                    {projectPath
                      ? "Review your project and choose the next engineering task."
                      : "Open a project to start building an engineering plan."}
                  </p>
                </div>
              </div>
            </section>

            <section className="planner-section">
              <div className="planner-section-heading">
                <span className="section-heading-icon">▣</span>
                <strong>Quick Actions</strong>
              </div>

              <button
                type="button"
                className="planner-action"
                onClick={() =>
                  handleAiAction("Analyze the current project structure")
                }
              >
                <span>⌕</span>
                Analyze project structure
                <span className="planner-action-arrow">↗</span>
              </button>

              <button
                type="button"
                className="planner-action"
                onClick={() =>
                  handleAiAction(
                    "Review project implementation and problems",
                  )
                }
              >
                <span>✓</span>
                Review implementation
                <span className="planner-action-arrow">↗</span>
              </button>

              <button
                type="button"
                className="planner-action"
                onClick={() => showBottomPanel("tests")}
              >
                <span>▷</span>
                Open tests
                <span className="planner-action-arrow">↗</span>
              </button>
            </section>
          </div>

          <div className="planner-footer">
            <button
              type="button"
              className="ai-chat-prompt"
              onClick={() => showBottomPanel("ai")}
            >
              <span>Ask AI to explain, plan, or write code…</span>
              <span className="ai-chat-arrow">↑</span>
            </button>
          </div>
        </aside>

        {/* Bottom panel */}
        {bottomPanelVisible && (
          <div
            className={`bottom-panel-content ${
              isBottomMaximized ? "panel-maximized" : ""
            }`}
            style={
              isBottomMaximized
                ? undefined
                : { height: bottomPanelHeight }
            }
          >
            <div
              className="resize-handle resize-handle-horizontal bottom-resize-handle"
              role="separator"
              aria-label="Resize bottom panel"
              aria-orientation="horizontal"
              onPointerDown={(event) =>
                beginResize(event, "bottom")
              }
            />

            <div className="bottom-panel-header">
              <div className="bottom-panel-tabs">
                <button
                  type="button"
                  className={
                    activeBottomPanel === "terminal" ? "active" : ""
                  }
                  onClick={() => setActiveBottomPanel("terminal")}
                >
                  TERMINAL
                </button>

                <button
                  type="button"
                  className={
                    activeBottomPanel === "problems" ? "active" : ""
                  }
                  onClick={() => setActiveBottomPanel("problems")}
                >
                  PROBLEMS

                  {problems.length > 0 && (
                    <span className="panel-count">
                      {problems.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  className={
                    activeBottomPanel === "tests" ? "active" : ""
                  }
                  onClick={() => setActiveBottomPanel("tests")}
                >
                  TESTS
                </button>

                <button
                  type="button"
                  className={
                    activeBottomPanel === "git" ? "active" : ""
                  }
                  onClick={() => setActiveBottomPanel("git")}
                >
                  GIT
                </button>

                <button
                  type="button"
                  className={
                    activeBottomPanel === "ai" ? "active" : ""
                  }
                  onClick={() => setActiveBottomPanel("ai")}
                >
                  AI ACTIVITY
                </button>
              </div>

              <div className="bottom-panel-actions">
                <button
                  type="button"
                  className="panel-action-button"
                  title={
                    isBottomMaximized
                      ? "Restore panel"
                      : "Maximize panel"
                  }
                  aria-label={
                    isBottomMaximized
                      ? "Restore panel"
                      : "Maximize panel"
                  }
                  onClick={() => toggleMaximize(activeBottomPanel)}
                >
                  {isBottomMaximized ? "❐" : "□"}
                </button>

                <button
                  type="button"
                  className="panel-action-button"
                  title="Hide bottom panel"
                  aria-label="Hide bottom panel"
                  onClick={() => {
                    setBottomPanelVisible(false);
                    setMaximizedPanel(null);
                  }}
                >
                  ⌄
                </button>
              </div>
            </div>

            <div className="bottom-panel-body">
              {activeBottomPanel === "terminal" && (
                <Terminal projectPath={projectPath} />
              )}

              {activeBottomPanel === "problems" && (
                <Problems
                  problems={problems}
                  onProblemClick={handleProblemClick}
                />
              )}

              {activeBottomPanel === "tests" && (
                <div className="utility-panel">
                  <div className="utility-panel-heading">
                    <span className="utility-panel-icon">✓</span>

                    <div>
                      <strong>Tests</strong>
                      <p>
                        Review and run your project's test suite.
                      </p>
                    </div>
                  </div>

                  <div className="utility-empty-state">
                    <span className="utility-empty-icon">◉</span>

                    <strong>Test runner</strong>

                    <p>
                      Open the terminal and run your project's test
                      command. Test discovery and result integration
                      can be connected here next.
                    </p>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={() =>
                        setActiveBottomPanel("terminal")
                      }
                    >
                      Open Terminal
                    </button>
                  </div>
                </div>
              )}

              {activeBottomPanel === "git" && (
                <div className="utility-panel">
                  <div className="utility-panel-heading">
                    <span className="utility-panel-icon">⑂</span>

                    <div>
                      <strong>Source Control</strong>
                      <p>Git workspace</p>
                    </div>
                  </div>

                  <div className="utility-empty-state">
                    <span className="utility-empty-icon">⑂</span>

                    <strong>Source control</strong>

                    <p>
                      {projectPath
                        ? "Use the terminal to inspect branches, changes, and repository status. Git integration can be connected to the source-control API next."
                        : "Open a project folder to start working with source control."}
                    </p>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={() =>
                        setActiveBottomPanel("terminal")
                      }
                    >
                      Open Terminal
                    </button>
                  </div>
                </div>
              )}

              {activeBottomPanel === "ai" && (
                <div className="utility-panel ai-activity-panel">
                  <div className="utility-panel-heading">
                    <span className="utility-panel-icon ai-logo">
                      ✧
                    </span>

                    <div>
                      <strong>AI Activity</strong>
                      <p>
                        Project assistant and engineering tasks
                      </p>
                    </div>
                  </div>

                  <div className="ai-activity-content">
                    <div className="ai-activity-message">
                      <span className="ai-activity-avatar">✧</span>

                      <div>
                        <strong>KryomCode Assistant</strong>

                        <p>
                          {projectPath
                            ? `Workspace selected: ${projectPath}. Choose a task to continue.`
                            : "Open a project to begin project-aware assistance."}
                        </p>
                      </div>
                    </div>

                    <div className="ai-activity-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setSaveStatus("Project analysis requested")
                        }
                      >
                        Analyze project
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setSaveStatus(
                            "Implementation plan requested",
                          )
                        }
                      >
                        Create implementation plan
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setActiveBottomPanel("problems")
                        }
                      >
                        Review problems
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Status bar */}
      <footer className="statusbar">
        <div className="statusbar-left">
          <button
            type="button"
            className="statusbar-item"
            title="Source control"
            onClick={() => showBottomPanel("git")}
          >
            <span>⑂</span>
            <strong>main*</strong>
          </button>

          <span className="statusbar-item status-success">
            <span>✓</span>
            {projectPath ? "Workspace ready" : "Ready"}
          </span>

          <button
            type="button"
            className="statusbar-item"
            onClick={() => showBottomPanel("problems")}
          >
            <span className="status-warning">⚠</span>
            Problems
            <span className="status-number">
              {problems.length}
            </span>
          </button>
        </div>

        <div className="statusbar-right">
          {activeTab && (
            <>
              <span className="statusbar-item">
                Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}
              </span>

              <span className="statusbar-item">Spaces: 2</span>

              <span className="statusbar-item">
                {getLanguage(activeTab.path)}
              </span>
            </>
          )}

          <span className="statusbar-item">UTF-8</span>

          <button
            type="button"
            className="statusbar-item status-save"
            onClick={() => void saveAll()}
            title="Save all files"
          >
            <span>▣</span>

            {saveStatus}

            {dirtyTabCount > 0 && (
              <span className="status-number">
                {dirtyTabCount} unsaved
              </span>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}

export default App;