import "./editor-tabs.css";

export interface EditorTab {
  path: string;
  name: string;
  isDirty: boolean;
}

interface EditorTabsProps {
  tabs: EditorTab[];
  activeTabPath: string | null;
  onTabSelect: (path: string) => void;
  onTabClose: (path: string) => void;
}

function EditorTabs({
  tabs,
  activeTabPath,
  onTabSelect,
  onTabClose,
}: EditorTabsProps) {
  function handleClose(
    event: React.MouseEvent<HTMLButtonElement>,
    path: string,
  ) {
    event.stopPropagation();
    onTabClose(path);
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
    path: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onTabSelect(path);
    }
  }

  if (tabs.length === 0) {
    return (
      <div className="editor-tabs editor-tabs-empty">
        <span>No open files</span>
      </div>
    );
  }

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open files">
      {tabs.map((tab) => {
        const isActive = tab.path === activeTabPath;

        return (
          <div
            key={tab.path}
            className={`editor-tab${isActive ? " active" : ""}`}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            title={tab.path}
            onClick={() => onTabSelect(tab.path)}
            onKeyDown={(event) => handleKeyDown(event, tab.path)}
          >
            <span className="editor-tab-name">
              {tab.name}
            </span>

            {tab.isDirty && (
              <span
                className="editor-tab-dirty"
                aria-label="Unsaved changes"
                title="Unsaved changes"
              >
                ●
              </span>
            )}

            <button
              type="button"
              className="editor-tab-close"
              aria-label={`Close ${tab.name}`}
              title={`Close ${tab.name}`}
              onClick={(event) => handleClose(event, tab.path)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default EditorTabs;